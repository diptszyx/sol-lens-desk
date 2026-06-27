import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import type { Position } from '../types'
import { DEFAULT_SL_PCT } from '../types'

interface PortfolioState {
  positions: Position[]
  globalStopLossPct: number
  addPosition: (p: Position) => void
  updatePrices: (prices: Record<string, number>) => void
  updatePositionPrice: (mint: string, priceUsd: number) => void
  closePosition: (mint: string) => void
  setGlobalStopLoss: (pct: number) => void
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
        return { ...p, current_price_usd: priceUsd, pnl_pct: pnl }
      }),
    })),

  closePosition: (mint) =>
    set((state) => ({
      positions: state.positions.filter((p) => p.mint !== mint),
    })),

  setGlobalStopLoss: (pct) => set({ globalStopLossPct: pct }),

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

// Guard against duplicate SL auto-sell invocations for the same mint
const closingMints = new Set<string>()

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

    // Single source of truth for position creation — buyers only emit this event.
    if (state.positions.some((p) => p.mint === mint)) return

    state.addPosition({
      mint,
      symbol,
      decimals,
      entry_price_usd,
      amount_tokens,
      amount_sol_spent: amount_sol,
      current_price_usd: entry_price_usd,
      pnl_pct: 0,
      opened_at: Date.now(),
      tx_signature,
      stop_loss_pct: state.globalStopLossPct,
    })

    invoke('log_trade', {
      mint,
      symbol,
      side: 'buy',
      amountSol: amount_sol,
      amountTokens: amount_tokens,
      priceUsd: entry_price_usd,
      txSignature: tx_signature,
      status: 'confirmed',
      createdAt: Date.now(),
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
  }>('position_closed', (e) => {
    const { mint, close_reason, exit_price_usd, realized_pnl_pct } = e.payload
    const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)

    if (pos) {
      // amount_sol_received not tracked directly; estimate from realized PnL.
      const amountSolReceived = pos.amount_sol_spent * (1 + realized_pnl_pct / 100)
      const realizedPnlUsd = pos.amount_tokens * (exit_price_usd - pos.entry_price_usd)

      invoke('record_closed_position', {
        mint,
        symbol: pos.symbol,
        entryPriceUsd: pos.entry_price_usd,
        exitPriceUsd: exit_price_usd,
        amountSolSpent: pos.amount_sol_spent,
        amountSolReceived: amountSolReceived,
        realizedPnlUsd: realizedPnlUsd,
        realizedPnlPct: realized_pnl_pct,
        openedAt: pos.opened_at,
        closedAt: Date.now(),
        closeReason: close_reason,
      }).catch(console.error)
    }

    usePortfolioStore.getState().removePosition(mint)
  })

  listen<{
    mint: string
    entry_price_usd: number
    exit_price_usd: number
    realized_pnl_pct: number
  }>('sl_triggered', async (e) => {
    const { mint, exit_price_usd, realized_pnl_pct } = e.payload

    if (closingMints.has(mint)) return
    closingMints.add(mint)

    const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)

    if (pos) {
      // Dynamically import to avoid circular dependency at module load time
      const { useWalletStore } = await import('./wallet')
      const walletAddress = useWalletStore.getState().address

      if (walletAddress) {
        try {
          const amountRaw = Math.floor(pos.amount_tokens * Math.pow(10, pos.decimals))
          const quote = await invoke<{ serialized_tx: string; out_amount_ui: number }>('build_sell_transaction', {
            params: {
              input_mint: mint,
              amount_tokens: amountRaw,
              slippage_bps: 200,
              user_public_key: walletAddress,
              input_decimals: pos.decimals,
            },
          })
          const signed = await invoke<string>('sign_transaction', { txBase64: quote.serialized_tx })
          const txResult = await invoke<{ signature: string; status: string }>('send_sell_transaction', {
            signedTxBase64: signed,
          })

          if (txResult.status === 'confirmed') {
            invoke('log_trade', {
              mint,
              symbol: pos.symbol,
              side: 'sell',
              amountSol: quote.out_amount_ui,
              amountTokens: pos.amount_tokens,
              priceUsd: exit_price_usd,
              txSignature: txResult.signature,
              status: 'confirmed',
              createdAt: Date.now(),
            }).catch(console.error)
          }
        } catch (err) {
          console.error('[SL] Auto-sell failed:', err)
        }
      }
    }

    invoke('stop_price_tracking', { mint }).catch(console.error)
    closingMints.delete(mint)

    emit('position_closed', {
      mint,
      close_reason: 'stop_loss',
      exit_price_usd,
      realized_pnl_pct,
    })
  })
}
