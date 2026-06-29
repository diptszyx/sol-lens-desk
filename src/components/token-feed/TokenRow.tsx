import { useState } from 'react'
import type { DetectedToken } from '../../types'
import { formatAge, formatSol, formatPrice, formatUsd } from '../../lib/format'

interface Props {
  token: DetectedToken
  onClick: () => void
  isSelected: boolean
}

export function TokenRow({ token, onClick, isSelected }: Props) {
  const [hover, setHover] = useState(false)
  const displaySymbol = token.symbol ?? token.mint.slice(0, 6)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`w-full px-3 py-2.5 text-left transition-all border-b border-[var(--border)] ${
        isSelected
          ? 'bg-[var(--bg-surface)] border-l-2 border-l-[var(--accent)]'
          : 'border-l-2 border-l-transparent hover:bg-[var(--bg-surface)] hover:border-l-[var(--border-strong)]'
      }`}
    >
      {/* Row 1: symbol + score badge + age */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              token.source === 'pump_fun' ? 'bg-green-400' : 'bg-blue-400'
            }`}
          />
          <span className="font-mono font-bold text-[var(--text-1)] text-sm truncate">
            ${displaySymbol}
          </span>
          <span className={`text-[10px] font-bold tabular-nums ${scoreColor(token.score)}`}>
            {token.score}
          </span>
        </div>
        <span className="text-[10px] text-[var(--text-3)] flex-shrink-0 tabular-nums">
          {formatAge(Math.floor((Date.now() - token.detected_at) / 1000))}
        </span>
      </div>

      {/* Row 2: price + mcap/buy + liquidity */}
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {token.price_usd != null && (
          <span className="text-xs font-semibold text-[var(--text-2)] tabular-nums">
            {formatPrice(token.price_usd)}
          </span>
        )}
        {token.market_cap_usd != null && (
          <span className="relative inline-flex items-center">
            <span
              className="text-[10px] tabular-nums text-[var(--text-3)]"
              style={{ opacity: hover ? 0 : 1, transition: 'opacity 150ms ease-out' }}
            >
              MC {formatUsd(token.market_cap_usd)}
            </span>
            <span
              className="absolute inset-0 flex items-center"
              style={{ opacity: hover ? 1 : 0, transition: 'opacity 150ms ease-out', pointerEvents: 'none' }}
            >
              <span className="font-mono font-bold text-[10px] bg-[var(--accent)] text-black px-3 py-1 rounded">
                BUY
              </span>
            </span>
          </span>
        )}
        <span className="text-[10px] text-[var(--text-3)] tabular-nums">
          {formatSol(token.liquidity_sol)}◎ liq
        </span>
      </div>

      {/* Row 3: signal badges */}
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        {token.dev_hold_pct != null && (
          <Badge color={devHoldColor(token.dev_hold_pct)}>
            dev {token.dev_hold_pct.toFixed(1)}%
          </Badge>
        )}
        {token.bonding_curve_pct != null && (
          <Badge color="neutral">
            curve {token.bonding_curve_pct.toFixed(0)}%
          </Badge>
        )}
        {token.dev_buy_sol != null && token.dev_buy_sol > 0 && (
          <Badge color="neutral">
            buy {token.dev_buy_sol.toFixed(2)}◎
          </Badge>
        )}
        {token.has_socials === true && (
          <Badge color="blue">socials</Badge>
        )}
      </div>
    </button>
  )
}

function Badge({ color, children }: { color: 'green' | 'yellow' | 'red' | 'blue' | 'neutral'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-green-500/15 text-green-400 border-green-500/20',
    yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
    red: 'bg-red-500/15 text-red-400 border-red-500/20',
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    neutral: 'bg-[var(--bg-elevated)] text-[var(--text-2)] border-[var(--border)]',
  }[color]

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>
      {children}
    </span>
  )
}

function devHoldColor(pct: number): 'green' | 'yellow' | 'red' {
  if (pct < 10) return 'green'
  if (pct < 25) return 'yellow'
  return 'red'
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}
