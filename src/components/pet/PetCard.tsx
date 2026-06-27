import { useEffect, useState } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import type { DetectedToken, PetBuyResult } from '../../types'
import { PET_BUY_REQUEST, PET_BUY_RESULT } from '../../types'
import { formatAge, formatSol } from '../../lib/format'

const SOL_PRESETS = [0.1, 0.5, 1]
const SLIPPAGE_BPS = 100 // 1% — sane default for fast meme entries

type BuyState =
  | { tag: 'idle' }
  | { tag: 'pending' }
  | { tag: 'done'; result: PetBuyResult }

function fmtPrice(p: number | null): string {
  if (p == null) return '—'
  if (p < 0.0001) return `$${p.toExponential(2)}`
  return `$${p.toFixed(p >= 1 ? 4 : 8)}`
}

function fmtUsd(v: number | null): string {
  if (v == null) return '—'
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-deep)] px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-[var(--text-3)]">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-[var(--text-1)]">{value}</p>
    </div>
  )
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

export function PetCard({ token }: { token: DetectedToken }) {
  const [amount, setAmount] = useState(0.1)
  const [state, setState] = useState<BuyState>({ tag: 'idle' })

  const displaySymbol = token.symbol ?? token.mint.slice(0, 6)

  // Reset when a new token flows into the card.
  useEffect(() => {
    setState({ tag: 'idle' })
    setAmount(0.1)
  }, [token.mint])

  // Listen for the dashboard's reply to our buy request.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<PetBuyResult>(PET_BUY_RESULT, (e) => {
      if (e.payload.mint === token.mint) setState({ tag: 'done', result: e.payload })
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [token.mint])

  function handleBuy() {
    setState({ tag: 'pending' })
    emitTo('main', PET_BUY_REQUEST, {
      token,
      amountSol: amount,
      slippageBps: SLIPPAGE_BPS,
    }).catch((err) => {
      setState({
        tag: 'done',
        result: { mint: token.mint, status: 'failed', signature: null, error: String(err) },
      })
    })
  }

  return (
    <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-2xl">
      {/* Header */}
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="truncate font-mono text-base font-bold text-[var(--text-1)]">
          ${displaySymbol}
        </h2>
        <span className="text-[10px] text-[var(--text-3)]">
          {token.source === 'pump_fun' ? 'pump.fun' : token.source}
        </span>
      </div>

      {/* Score line */}
      <div className="mb-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-2)]">Score:</span>
          <span className={`text-base font-bold ${scoreColor(token.score)}`}>
            {token.score}/100
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-3)] flex-wrap">
          {token.dev_hold_pct != null && <span>Dev: {token.dev_hold_pct.toFixed(1)}%</span>}
          {token.bonding_curve_pct != null && <span>· Curve: {token.bonding_curve_pct.toFixed(0)}%</span>}
          {token.dev_buy_sol != null && token.dev_buy_sol > 0 && <span>· Buy: {token.dev_buy_sol.toFixed(2)}◎</span>}
        </div>
      </div>

      {/* 4 stats — price, mcap, liquidity, age */}
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Price" value={fmtPrice(token.price_usd)} />
        <Stat label="Mkt Cap" value={fmtUsd(token.market_cap_usd)} />
        <Stat label="Liquidity" value={`${formatSol(token.liquidity_sol)} ◎`} />
        <Stat label="Age" value={formatAge(token.age_seconds)} />
      </div>

      {/* Trade */}
      {state.tag !== 'done' && (
        <>
          <div className="mt-2.5 flex gap-1.5">
            {SOL_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(p)}
                disabled={state.tag === 'pending'}
                className={`flex-1 rounded-md border py-1 text-xs transition-colors disabled:opacity-50 ${
                  amount === p
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-2)]'
                }`}
              >
                {p} ◎
              </button>
            ))}
          </div>

          <button
            onClick={handleBuy}
            disabled={state.tag === 'pending'}
            className="mt-2 w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {state.tag === 'pending' ? 'Buying…' : `Buy ${amount} ◎`}
          </button>
        </>
      )}

      {/* Result */}
      {state.tag === 'done' && (
        <div className="mt-2.5 space-y-2">
          <div
            className={`rounded-lg px-3 py-2 text-xs ${
              state.result.status === 'confirmed'
                ? 'bg-green-400/10 text-green-400'
                : 'bg-red-400/10 text-red-400'
            }`}
          >
            {state.result.status === 'confirmed'
              ? `✓ Bought — ${state.result.signature?.slice(0, 10)}…`
              : `✗ ${state.result.error ?? 'Failed'}`}
          </div>
          <button
            onClick={() => setState({ tag: 'idle' })}
            className="w-full rounded-lg border border-[var(--border)] py-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text-1)]"
          >
            Trade again
          </button>
        </div>
      )}
    </div>
  )
}
