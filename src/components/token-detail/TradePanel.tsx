import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import type { DetectedToken, TxResult } from '../../types'
import { useWalletStore } from '../../store/wallet'
import { loadTradeDefaults as loadSharedTradeDefaults } from '../../lib/tradeDefaults'

interface Props {
  token: DetectedToken
}

interface Quote {
  serializedTx: string
  outAmountUi: number
  priceImpact: number
  provider: string
}

type TradeState =
  | { tag: 'idle' }
  | { tag: 'quoting' }
  | { tag: 'ready'; quote: Quote }
  | { tag: 'signing' }
  | { tag: 'done'; result: TxResult }
  | { tag: 'error'; message: string }

const SLIPPAGE_OPTIONS = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 200, label: '2%' },
]

const SOL_PRESETS = ['0.1', '0.5', '1', '2']
// Wait this long after the user stops typing before fetching the first quote.
const QUOTE_DEBOUNCE_MS = 400
// A built tx carries a blockhash valid for ~60-90s, so a held quote is safe to sign
// and send for well over a minute. Refresh the estimate on a calm cadence in the
// background — NOT an aggressive expiry that discards the quote and rebuilds every
// second (that caused the constant "Getting route…" flicker and a running countdown).
const QUOTE_REFRESH_MS = 10_000

// Bonding curves detected fresh (this app's target) are quote_mint=SOL in practice.
// USDC/other quote curves exist on pump.fun but are rare for newly-minted tokens, and
// paying with an unrelated wallet token would need a swap step first (out of scope here)
// — see plan/19-pumpfun-direct-trade.md. Keep this SOL-only until that's actually needed.
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const SOL_DECIMALS = 9

function loadTradeDefaults() {
  const d = loadSharedTradeDefaults()
  return {
    amount: d.defaultAmount,
    slippageBps: parseInt(d.defaultSlippage, 10) || 100,
  }
}

function formatTokenOut(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(4)
}

export function TradePanel({ token }: Props) {
  const address = useWalletStore((s) => s.address)

  const defaults = loadTradeDefaults()
  const [amount, setAmount] = useState(defaults.amount)
  const [slippageBps, setSlippageBps] = useState(defaults.slippageBps)
  const [state, setState] = useState<TradeState>({ tag: 'idle' })
  const isBuyingRef = useRef(false)

  const displaySymbol = token.symbol ?? token.mint.slice(0, 6)
  const amountNum = parseFloat(amount)
  const canTrade = !!address && amountNum > 0

  // Single source of truth for fetching a quote. `silent` refreshes the held quote
  // in the background without flipping the UI to a loading state — used by the periodic
  // refresh so the estimate stays live without any flicker.
  const fetchQuote = useCallback(
    async (silent: boolean): Promise<void> => {
      if (!address || !(amountNum > 0)) return
      if (!silent) setState({ tag: 'quoting' })
      try {
        const amountLamports = Math.floor(amountNum * Math.pow(10, SOL_DECIMALS))
        const res = await invoke<{
          serialized_tx: string; out_amount_ui: number; price_impact_pct: number; provider: string
        }>('build_swap_transaction', {
          params: {
            input_mint: SOL_MINT, output_mint: token.mint,
            amount_lamports: amountLamports, slippage_bps: slippageBps,
            user_public_key: address, output_decimals: token.decimals,
          },
        })
        const quote: Quote = {
          serializedTx: res.serialized_tx,
          outAmountUi: res.out_amount_ui,
          priceImpact: res.price_impact_pct,
          provider: res.provider,
        }
        // Never clobber an in-progress sign/confirm with a stray refresh result.
        setState((prev) => (prev.tag === 'signing' || prev.tag === 'done' ? prev : { tag: 'ready', quote }))
      } catch (err) {
        // A silent background refresh that fails just keeps the previous quote — the
        // held tx is still valid, no reason to disrupt the user with an error.
        if (!silent) setState({ tag: 'error', message: String(err) })
        else console.error('[TradePanel] background quote refresh failed', err)
      }
    },
    [address, amountNum, slippageBps, token.mint, token.decimals],
  )

  // Reset inputs from saved defaults whenever the selected token changes.
  useEffect(() => {
    const d = loadTradeDefaults()
    setAmount(d.amount)
    setSlippageBps(d.slippageBps)
    setState({ tag: 'idle' })
  }, [token.mint])

  // Debounced initial/interactive quote: refires when the user changes amount or
  // slippage. Cancels a pending fetch on change via the cleanup so we never stack
  // requests.
  useEffect(() => {
    if (!canTrade) {
      setState((prev) => (prev.tag === 'signing' || prev.tag === 'done' ? prev : { tag: 'idle' }))
      return
    }
    const handle = setTimeout(() => { void fetchQuote(false) }, QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [canTrade, fetchQuote])

  // Background refresh: keeps the estimate and the held tx (blockhash) fresh without
  // touching the UI state, only while a quote is actually on screen and ready.
  useEffect(() => {
    if (state.tag !== 'ready') return
    const handle = setInterval(() => { void fetchQuote(true) }, QUOTE_REFRESH_MS)
    return () => clearInterval(handle)
  }, [state.tag, fetchQuote])

  async function handleBuy() {
    if (state.tag !== 'ready' || !address || isBuyingRef.current) return
    const { serializedTx, outAmountUi } = state.quote

    isBuyingRef.current = true
    setState({ tag: 'signing' })
    try {
      const signedTxBase64 = await invoke<string>('sign_transaction', { txBase64: serializedTx })
      const txResult = await invoke<TxResult>('send_transaction', { signedTxBase64 })
      setState({ tag: 'done', result: txResult })

      if (txResult.status === 'confirmed' && outAmountUi > 0) {
        // BuyV2 locks in an exact token amount and lets the SOL side float with
        // curve movement between quote and confirmation — amountNum (what the user
        // typed) is only a request, not what actually left the wallet. Read the
        // confirmed tx back to get the real figure instead of guessing from it.
        const realAmountSol = await invoke<number>('get_actual_swap_sol', {
          mint: token.mint, signature: txResult.signature,
        }).catch(() => amountNum)

        const solPriceUsd = await invoke<number | null>('get_sol_price_usd').catch(() => null)
        const entryPriceUsd = solPriceUsd != null ? (realAmountSol * solPriceUsd) / outAmountUi : token.price_usd

        if (entryPriceUsd != null) {
          // Position creation AND price-tracking subscription are both owned by the
          // `buy_confirmed` listener in the store, so the tracker's entry always
          // matches the (possibly DCA-blended) position. Don't subscribe here.
          emit('buy_confirmed', {
            mint: token.mint, symbol: displaySymbol, decimals: token.decimals,
            amount_sol: realAmountSol,
            amount_tokens: outAmountUi, entry_price_usd: entryPriceUsd,
            tx_signature: txResult.signature,
          })
        }
      }
    } catch (err) {
      setState({ tag: 'error', message: String(err) })
    } finally {
      isBuyingRef.current = false
    }
  }

  const readyQuote = state.tag === 'ready' ? state.quote : null
  const isHighImpact = readyQuote != null && readyQuote.priceImpact > 5
  const isSigning = state.tag === 'signing'
  const isQuoting = state.tag === 'quoting'
  const isReady = state.tag === 'ready'
  const isDone = state.tag === 'done'

  if (isDone && state.tag === 'done') {
    const ok = state.result.status === 'confirmed'
    return (
      <div className="p-3 space-y-2">
        <div className={`rounded-xl px-4 py-3.5 text-sm font-medium border ${
          ok ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {ok
            ? `✓ Bought $${displaySymbol} — ${state.result.signature?.slice(0, 12)}…`
            : `✗ ${state.result.error ?? 'Transaction failed'}`}
        </div>
        <button
          onClick={() => setState({ tag: 'idle' })}
          className="w-full rounded-xl border border-[var(--border)] py-2.5 text-sm text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)] transition-colors"
        >
          Trade again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {!address && (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
          Wallet locked — unlock first
        </div>
      )}

      {/* Pay row: SOL (fixed — bonding curves detected fresh are quote_mint=SOL) + editable amount */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] px-2.5 py-2 text-sm font-bold text-[var(--text-1)]">
            SOL
          </div>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSigning}
            placeholder="Amount"
            className="flex-1 min-w-0 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-sm font-mono font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)] disabled:opacity-50 transition-colors"
          />
        </div>

        {/* Quick-fill presets — overwrite the amount above, not a separate selection step */}
        <div className="flex gap-1">
          {SOL_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(p)}
              disabled={isSigning}
              className={`flex-1 rounded-md py-1 text-xs font-semibold border transition-all disabled:opacity-50 ${
                amount === p
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] text-[var(--text-3)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Quote block — prominent */}
      <div className={`rounded-xl border px-3 py-2.5 transition-colors ${
        isReady
          ? isHighImpact
            ? 'border-red-500/30 bg-red-500/5'
            : 'border-[var(--border-strong)] bg-[var(--bg-elevated)]'
          : 'border-[var(--border)] bg-[var(--bg-elevated)]/50'
      }`}>
        <p className="text-[9px] text-[var(--text-3)] uppercase tracking-widest mb-1">You receive</p>
        {readyQuote != null ? (
          <>
            <p className={`text-base font-black font-mono tabular-nums ${isHighImpact ? 'text-red-400' : 'text-[var(--text-1)]'}`}>
              ≈ {formatTokenOut(readyQuote.outAmountUi)}{' '}
              <span className="text-[var(--accent)]">${displaySymbol}</span>
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-[var(--text-3)]">
                via <span className="text-[var(--text-2)] capitalize">{readyQuote.provider}</span>
              </span>
              {readyQuote.priceImpact > 1 && (
                <span className={`text-[10px] ${isHighImpact ? 'text-red-400' : 'text-yellow-400'}`}>
                  · {isHighImpact ? '⚠ ' : ''}{readyQuote.priceImpact.toFixed(1)}% impact
                </span>
              )}
            </div>
          </>
        ) : isQuoting ? (
          <p className="text-base font-bold font-mono text-[var(--text-3)] animate-pulse">…</p>
        ) : (
          <p className="text-base font-bold font-mono text-[var(--text-3)]/40">—</p>
        )}
      </div>

      {/* Slippage */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--text-3)] uppercase tracking-widest font-semibold">
          Slip
        </span>
        <div className="flex gap-1">
          {SLIPPAGE_OPTIONS.map((opt) => (
            <button
              key={opt.bps}
              onClick={() => setSlippageBps(opt.bps)}
              disabled={isSigning}
              className={`rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                slippageBps === opt.bps
                  ? 'bg-[var(--accent)] text-black'
                  : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {state.tag === 'error' && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
          ✗ {state.message}
        </div>
      )}

      {/* BUY button — stays on "Buy X SOL" once a quote is ready; the estimate refreshes
          silently in the background, so the button never flickers or counts down. */}
      <button
        onClick={state.tag === 'error' ? () => void fetchQuote(false) : handleBuy}
        disabled={!isReady && state.tag !== 'error'}
        className={`w-full rounded-xl py-4 text-sm font-black tracking-wide transition-all ${
          isSigning
            ? 'bg-[var(--bg-surface)] text-[var(--text-3)] border border-[var(--border)] cursor-wait'
            : isReady
              ? isHighImpact
                ? 'bg-red-500 text-white hover:opacity-90 active:scale-[0.99]'
                : 'bg-[var(--accent)] text-black hover:opacity-90 hover:scale-[1.01] active:scale-[0.99]'
              : state.tag === 'error'
                ? 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]'
                : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-3)] cursor-not-allowed'
        }`}
      >
        {isSigning
          ? 'Approving in wallet…'
          : isReady
            ? isHighImpact
              ? `⚠ Buy with ${amount} SOL — high impact`
              : `Buy with ${amount} SOL`
            : isQuoting
              ? 'Getting route…'
              : state.tag === 'error'
                ? 'Retry'
                : !address
                  ? 'Wallet locked'
                  : 'Enter amount'}
      </button>
    </div>
  )
}
