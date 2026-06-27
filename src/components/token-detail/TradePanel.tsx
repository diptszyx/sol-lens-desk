import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import type { DetectedToken, TxResult } from '../../types'
import { usePortfolioStore } from '../../store/portfolio'
import { useWalletStore } from '../../store/wallet'

interface Props {
  token: DetectedToken
}

type TradeState =
  | { tag: 'idle' }
  | { tag: 'quoting' }
  | { tag: 'ready'; serializedTx: string; outAmountUi: number; priceImpact: number; provider: string }
  | { tag: 'signing' }
  | { tag: 'done'; result: TxResult }
  | { tag: 'error'; message: string }

const SLIPPAGE_OPTIONS = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 200, label: '2%' },
]

const SOL_PRESETS = ['0.1', '0.5', '1', '2']
const QUOTE_DEBOUNCE_MS = 600

export function TradePanel({ token }: Props) {
  const address = useWalletStore((s) => s.address)

  const [amount, setAmount] = useState('0.1')
  const [slippageBps, setSlippageBps] = useState(100)
  const [state, setState] = useState<TradeState>({ tag: 'idle' })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quoteAbortRef = useRef(0)

  const displaySymbol = token.symbol ?? token.mint.slice(0, 6)
  const amountNum = parseFloat(amount)
  const canTrade = !!address && amountNum > 0

  // Auto-quote whenever amount, slippage, or token changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!canTrade) {
      setState({ tag: 'idle' })
      return
    }

    setState({ tag: 'quoting' })
    const id = ++quoteAbortRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await invoke<{
          serialized_tx: string
          out_amount: number
          out_amount_ui: number
          price_impact_pct: number
          provider: string
        }>('build_swap_transaction', {
          params: {
            output_mint: token.mint,
            amount_lamports: Math.floor(amountNum * 1e9),
            slippage_bps: slippageBps,
            user_public_key: address!,
            output_decimals: token.decimals,
          },
        })
        if (id !== quoteAbortRef.current) return // stale
        setState({
          tag: 'ready',
          serializedTx: res.serialized_tx,
          outAmountUi: res.out_amount_ui,
          priceImpact: res.price_impact_pct,
          provider: res.provider,
        })
      } catch (err) {
        if (id !== quoteAbortRef.current) return
        setState({ tag: 'error', message: String(err) })
      }
    }, QUOTE_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, slippageBps, token.mint, canTrade])

  // Reset when switching tokens.
  useEffect(() => {
    quoteAbortRef.current++
    setState({ tag: 'idle' })
    setAmount('0.1')
    setSlippageBps(100)
  }, [token.mint])

  async function handleBuy() {
    if (state.tag !== 'ready' || !address) return
    const { serializedTx, outAmountUi } = state
    setState({ tag: 'signing' })

    try {
      const signedTxBase64 = await invoke<string>('sign_transaction', {
        txBase64: serializedTx,
      })
      const txResult = await invoke<TxResult>('send_transaction', {
        signedTxBase64,
      })
      setState({ tag: 'done', result: txResult })

      if (txResult.status === 'confirmed' && token.price_usd != null) {
        const slPct = usePortfolioStore.getState().globalStopLossPct

        // Position creation is owned by the `buy_confirmed` listener in the store.
        emit('buy_confirmed', {
          mint: token.mint,
          symbol: displaySymbol,
          decimals: token.decimals,
          amount_sol: amountNum,
          amount_tokens: outAmountUi,
          entry_price_usd: token.price_usd,
          tx_signature: txResult.signature,
        })

        invoke('start_price_tracking', {
          mint: token.mint,
          entryPriceUsd: token.price_usd,
          stopLossPct: slPct,
        }).catch(console.error)
      }
    } catch (err) {
      setState({ tag: 'error', message: String(err) })
    }
  }

  const isHighImpact = state.tag === 'ready' && state.priceImpact > 5

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto">
      {/* Wallet missing warning */}
      {!address && (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
          Wallet locked — unlock first
        </div>
      )}

      {/* FROM */}
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] p-3 space-y-2">
        <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest">You pay</span>
        <div className="flex items-center gap-2">
          <div className="bg-[var(--bg-elevated)] rounded-lg px-2.5 py-1.5 flex-shrink-0">
            <span className="text-sm font-bold text-[var(--text-1)]">SOL</span>
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={state.tag === 'signing'}
            placeholder="0"
            min="0"
            step="any"
            className="flex-1 bg-transparent text-right text-xl font-bold text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)] disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <div className="flex gap-1.5">
          {SOL_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(p)}
              disabled={state.tag === 'signing'}
              className={`flex-1 rounded-md border py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                amount === p
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Arrow + route info */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          {state.tag === 'quoting' && (
            <span className="text-[10px] text-[var(--text-3)] animate-pulse">Fetching route…</span>
          )}
          {state.tag === 'ready' && (
            <span className="text-[10px] text-[var(--text-3)]">
              via <span className="text-[var(--accent)] font-medium capitalize">{state.provider}</span>
            </span>
          )}
        </div>
        <span className="text-[var(--text-3)] text-sm select-none">↓</span>
      </div>

      {/* TO */}
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] p-3 space-y-1">
        <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest">You receive</span>
        <div className="flex items-center gap-2">
          <div className="bg-[var(--bg-elevated)] rounded-lg px-2.5 py-1.5 flex-shrink-0">
            <span className="text-sm font-bold text-[var(--text-1)]">${displaySymbol}</span>
          </div>
          <div className="flex-1 text-right">
            {state.tag === 'quoting' && (
              <span className="text-xl text-[var(--text-3)] animate-pulse">⋯</span>
            )}
            {state.tag === 'ready' && (
              <span className="text-xl font-bold text-[var(--text-1)]">
                ≈ {state.outAmountUi >= 1e6
                  ? state.outAmountUi.toLocaleString(undefined, { maximumFractionDigits: 0 })
                  : state.outAmountUi >= 1
                    ? state.outAmountUi.toFixed(2)
                    : state.outAmountUi.toPrecision(4)}
              </span>
            )}
            {(state.tag === 'idle' || state.tag === 'signing' || state.tag === 'done' || state.tag === 'error') && (
              <span className="text-xl text-[var(--text-3)]">—</span>
            )}
          </div>
        </div>
        {state.tag === 'ready' && state.priceImpact > 1 && (
          <p className={`text-[10px] text-right ${isHighImpact ? 'text-red-400' : 'text-yellow-400'}`}>
            {isHighImpact ? '⚠ ' : ''}Price impact {state.priceImpact.toFixed(2)}%
          </p>
        )}
      </div>

      {/* Slippage */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest flex-shrink-0">
          Slippage
        </span>
        <div className="flex gap-1">
          {SLIPPAGE_OPTIONS.map((opt) => (
            <button
              key={opt.bps}
              onClick={() => setSlippageBps(opt.bps)}
              disabled={state.tag === 'signing'}
              className={`rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
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

      {/* Error */}
      {state.tag === 'error' && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
          ✗ {state.message}
        </div>
      )}

      {/* CTA */}
      {state.tag !== 'done' && (
        <button
          onClick={state.tag === 'error' ? () => setState({ tag: 'idle' }) : handleBuy}
          disabled={state.tag !== 'ready' && state.tag !== 'error'}
          className={`w-full rounded-xl py-3 text-sm font-bold transition-all ${
            state.tag === 'ready'
              ? isHighImpact
                ? 'bg-red-500 text-white hover:opacity-90'
                : 'bg-[var(--accent)] text-black hover:opacity-90 hover:scale-[1.01] active:scale-[0.99]'
              : 'bg-[var(--bg-surface)] text-[var(--text-3)] cursor-not-allowed border border-[var(--border)]'
          }`}
        >
          {state.tag === 'signing'
            ? 'Approving in wallet…'
            : state.tag === 'quoting'
              ? 'Getting best route…'
              : state.tag === 'ready'
                ? isHighImpact
                  ? `Buy ${amount} ◎ — high impact!`
                  : `Buy ${amount} ◎`
                : state.tag === 'error'
                  ? 'Retry'
                  : !address
                    ? 'Wallet locked'
                    : 'Enter amount'}
        </button>
      )}

      {/* Done */}
      {state.tag === 'done' && (
        <div className="space-y-2">
          <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
            state.result.status === 'confirmed'
              ? 'bg-green-500/10 border border-green-500/20 text-green-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            {state.result.status === 'confirmed'
              ? `✓ Bought ${displaySymbol} — ${state.result.signature?.slice(0, 12)}…`
              : `✗ ${state.result.error ?? 'Transaction failed'}`}
          </div>
          <button
            onClick={() => setState({ tag: 'idle' })}
            className="w-full rounded-xl border border-[var(--border)] py-2.5 text-sm text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)] transition-colors"
          >
            Trade again
          </button>
        </div>
      )}
    </div>
  )
}
