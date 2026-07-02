import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Position } from '../types'
import { DEFAULT_SL_PCT } from '../types'

const SL_SETTINGS_FILE = 'sol-lens.settings.json'
const SL_SETTINGS_KEY = 'globalStopLossPct'

async function persistGlobalSl(pct: number): Promise<void> {
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const s = await load(SL_SETTINGS_FILE, { autoSave: false, defaults: {} })
    await s.set(SL_SETTINGS_KEY, pct)
    await s.save()
  } catch (e) {
    console.error('[portfolio] Failed to persist globalStopLossPct:', e)
  }
}

export async function loadGlobalSl(): Promise<number> {
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const s = await load(SL_SETTINGS_FILE, { autoSave: false, defaults: {} })
    const v = await s.get<number>(SL_SETTINGS_KEY)
    return typeof v === 'number' ? v : DEFAULT_SL_PCT
  } catch {
    return DEFAULT_SL_PCT
  }
}

interface PortfolioState {
  positions: Position[]
  globalStopLossPct: number
  addPosition: (p: Position) => void
  updatePrices: (prices: Record<string, number>) => void
  updatePositionPrice: (mint: string, priceUsd: number) => void
  closePosition: (mint: string) => void
  setGlobalStopLoss: (pct: number) => void
  hydrateGlobalSl: (pct: number) => void
  setPositionStopLoss: (mint: string, pct: number) => void
  removePosition: (mint: string) => void
}

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  positions: [],
  globalStopLossPct: DEFAULT_SL_PCT,

  addPosition: (position) =>
    set((state) => ({
      positions: [...state.positions, position],
    })),

  updatePrices: (prices) =>
    set((state) => ({
      positions: state.positions.map((p) => {
        const current = prices[p.mint]
        if (!current) return p
        const pnl = ((current - p.entry_price_usd) / p.entry_price_usd) * 100
        return { ...p, current_price_usd: current, pnl_pct: pnl }
      }),
    })),

  updatePositionPrice: (mint, priceUsd) =>
    set((state) => ({
      positions: state.positions.map((p) => {
        if (p.mint !== mint) return p
        const pnl = ((priceUsd - p.entry_price_usd) / p.entry_price_usd) * 100
        return { ...p, current_price_usd: priceUsd, pnl_pct: pnl, priceLoaded: true }
      }),
    })),

  closePosition: (mint) =>
    set((state) => ({
      positions: state.positions.filter((p) => p.mint !== mint),
    })),

  setGlobalStopLoss: (pct) => {
    set({ globalStopLossPct: pct })
    void persistGlobalSl(pct)
  },

  hydrateGlobalSl: (pct) => set({ globalStopLossPct: pct }),

  setPositionStopLoss: (mint, pct) =>
    set((state) => ({
      positions: state.positions.map((p) =>
        p.mint === mint ? { ...p, stop_loss_pct: pct } : p,
      ),
    })),

  removePosition: (mint) =>
    set((state) => ({
      positions: state.positions.filter((p) => p.mint !== mint),
    })),
}))

let eventListenersSetup = false

export function setupPortfolioEventListeners() {
  if (eventListenersSetup) return
  eventListenersSetup = true

  listen<{
    mint: string
    symbol: string
    decimals: number
    amount_sol: number
    amount_tokens: number
    entry_price_usd: number
    tx_signature: string
  }>('buy_confirmed', (e) => {
    const { mint, symbol, decimals, amount_sol, amount_tokens, entry_price_usd, tx_signature } = e.payload
    const state = usePortfolioStore.getState()
    const openedAt = Date.now()
    const existing = state.positions.find((p) => p.mint === mint)

    if (existing) {
      // DCA: merge vào position hiện có với blended entry price
      const totalSol = existing.amount_sol_spent + amount_sol
      const totalTokens = existing.amount_tokens + amount_tokens
      const blendedEntryUsd = ((existing.entry_price_usd * existing.amount_tokens) + (entry_price_usd * amount_tokens)) / totalTokens

      usePortfolioStore.setState((s) => ({
        positions: s.positions.map((p) =>
          p.mint === mint
            ? { ...p, amount_tokens: totalTokens, amount_sol_spent: totalSol, entry_price_usd: blendedEntryUsd }
            : p
        ),
      }))

      invoke('log_trade', {
        mint, symbol, side: 'buy',
        amountSol: amount_sol, amountTokens: amount_tokens,
        priceUsd: entry_price_usd, txSignature: tx_signature,
        status: 'confirmed', createdAt: openedAt,
      }).catch(console.error)

      invoke('save_open_position', {
        position: {
          mint, symbol, decimals,
          entry_price_usd: blendedEntryUsd,
          amount_tokens: totalTokens,
          amount_sol_spent: totalSol,
          stop_loss_pct: existing.stop_loss_pct,
          opened_at: existing.opened_at,
          tx_signature: existing.tx_signature,
        },
      }).catch(console.error)

      // Re-subscribe with the BLENDED entry so the Rust SL tracker computes its
      // threshold from the averaged cost basis, not just the latest buy's price.
      invoke('start_price_tracking', {
        mint, entry_price_usd: blendedEntryUsd, stop_loss_pct: existing.stop_loss_pct,
      }).catch(console.error)

      return
    }

    // First buy — logic cũ giữ nguyên
    const stopLoss = state.globalStopLossPct

    state.addPosition({
      mint,
      symbol,
      decimals,
      entry_price_usd,
      amount_tokens,
      amount_sol_spent: amount_sol,
      current_price_usd: entry_price_usd,
      pnl_pct: 0,
      opened_at: openedAt,
      tx_signature,
      stop_loss_pct: stopLoss,
      priceLoaded: true,
    })

    invoke('log_trade', {
      mint, symbol, side: 'buy',
      amountSol: amount_sol, amountTokens: amount_tokens,
      priceUsd: entry_price_usd, txSignature: tx_signature,
      status: 'confirmed', createdAt: openedAt,
    }).catch(console.error)

    invoke('save_open_position', {
      position: {
        mint, symbol, decimals,
        entry_price_usd, amount_tokens,
        amount_sol_spent: amount_sol,
        stop_loss_pct: stopLoss,
        opened_at: openedAt,
        tx_signature,
      },
    }).catch(console.error)

    // Subscribe price tracking here — the single owner of position lifecycle — so the
    // entry the tracker uses always matches the position that was just created. The
    // buy call sites (TradePanel, pet bridge) intentionally no longer do this
    // themselves, which previously let a raced individual-entry subscribe overwrite
    // the blended one on DCA.
    invoke('start_price_tracking', {
      mint, entry_price_usd, stop_loss_pct: stopLoss,
    }).catch(console.error)
  })

  listen<{ mint: string; price_usd: number }>('price_updated', (e) => {
    usePortfolioStore.getState().updatePositionPrice(e.payload.mint, e.payload.price_usd)
  })

  listen<{
    mint: string
    close_reason: string
    exit_price_usd: number
    realized_pnl_pct: number
    amount_sol_received?: number
    recorded?: boolean
  }>('position_closed', (e) => {
    const { mint, close_reason, exit_price_usd, realized_pnl_pct, amount_sol_received, recorded } = e.payload

    // Backend stop-loss auto-sell already wrote the trade + closed position to the
    // DB under the owner wallet. Re-recording here would double-count and would use
    // the wrong (active) wallet — so just drop the position from the UI store and
    // let HistoryPanel refetch via its own position_closed listener.
    if (recorded) {
      usePortfolioStore.getState().removePosition(mint)
      return
    }

    const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)

    if (pos) {
      // Prefer the real SOL amount from the sell tx quote — falling back to a
      // pnl_pct-based estimate silently hid losses whenever the live price feed
      // never delivered a fresh trade for the mint (pnl_pct stuck at 0%, so the
      // estimate always came out as "received == spent").
      const amountSolReceived = amount_sol_received ?? pos.amount_sol_spent * (1 + realized_pnl_pct / 100)
      const realizedPnlPct = amount_sol_received != null && pos.amount_sol_spent > 0
        ? ((amountSolReceived - pos.amount_sol_spent) / pos.amount_sol_spent) * 100
        : realized_pnl_pct
      // No live SOL/USD rate here — approximate it from the entry snapshot
      // (usd spent implied by entry_price_usd, divided by sol spent) rather
      // than trusting exit_price_usd, which shares the same staleness issue.
      const impliedUsdPerSol = pos.amount_sol_spent > 0
        ? (pos.amount_tokens * pos.entry_price_usd) / pos.amount_sol_spent
        : 0
      const realizedPnlUsd = amount_sol_received != null
        ? (amountSolReceived - pos.amount_sol_spent) * impliedUsdPerSol
        : pos.amount_tokens * (exit_price_usd - pos.entry_price_usd)

      invoke('record_closed_position', {
        mint,
        symbol: pos.symbol,
        entryPriceUsd: pos.entry_price_usd,
        exitPriceUsd: exit_price_usd,
        amountSolSpent: pos.amount_sol_spent,
        amountSolReceived: amountSolReceived,
        realizedPnlUsd: realizedPnlUsd,
        realizedPnlPct: realizedPnlPct,
        openedAt: pos.opened_at,
        closedAt: Date.now(),
        closeReason: close_reason,
      }).catch(console.error)
    }

    usePortfolioStore.getState().removePosition(mint)

    invoke('remove_open_position', { mint }).catch(console.error)
  })

  // Stop-loss auto-sell now runs entirely in the Rust price tracker (signs as the
  // position owner, works for every wallet in the vault even when the UI is on a
  // different one). It writes the DB directly and emits `position_closed` with
  // `recorded: true`. No `sl_triggered` frontend handler is needed anymore.
}

export async function restoreOpenPositions() {
  try {
    const positions = await invoke<Array<{
      mint: string
      symbol: string
      decimals: number
      entry_price_usd: number
      amount_tokens: number
      amount_sol_spent: number
      stop_loss_pct: number
      opened_at: number
      tx_signature: string
    }>>('get_open_positions')

    if (positions.length === 0) return

    const state = usePortfolioStore.getState()
    for (const p of positions) {
      if (state.positions.some((pos) => pos.mint === p.mint)) continue

      state.addPosition({
        mint: p.mint,
        symbol: p.symbol,
        decimals: p.decimals,
        entry_price_usd: p.entry_price_usd,
        amount_tokens: p.amount_tokens,
        amount_sol_spent: p.amount_sol_spent,
        current_price_usd: p.entry_price_usd,
        pnl_pct: 0,
        opened_at: p.opened_at,
        tx_signature: p.tx_signature,
        stop_loss_pct: p.stop_loss_pct,
        priceLoaded: false,
      })

      invoke('start_price_tracking', {
        mint: p.mint,
        entry_price_usd: p.entry_price_usd,
        stop_loss_pct: p.stop_loss_pct,
      }).catch(console.error)
    }
  } catch (err) {
    console.error('[Portfolio] Failed to restore open positions:', err)
  }
}
