import { useState } from 'react'
import type { ScoreBreakdown as ScoreBreakdownType } from '../../types'

function Row({ label, points, max, detail, satisfied }: {
  label: string
  points: number
  max: number
  detail: string
  satisfied: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-1.5 px-2 rounded ${satisfied ? 'text-[var(--text-1)]' : 'text-[var(--text-3)]'}`}>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs ${satisfied ? 'text-green-400' : 'text-red-400/60'}`}>
            {satisfied ? '✓' : '✗'}
          </span>
          <span className="text-[11px] truncate">{label}</span>
        </div>
        <span className="text-[10px] text-[var(--text-3)] pl-4 truncate">{detail}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
        <span className={`text-[11px] font-semibold tabular-nums ${satisfied ? 'text-green-400' : 'text-[var(--text-3)]'}`}>
          +{points}
        </span>
        <span className="text-[10px] text-[var(--text-3)]">/ {max}</span>
      </div>
    </div>
  )
}

interface Props {
  breakdown: ScoreBreakdownType
  devHoldPct: number | null
  bondingCurvePct: number | null
  devBuySol: number | null
  hasSocials: boolean | null
  twitterUrl: string | null
  telegramUrl: string | null
  websiteUrl: string | null
  score: number
}

export function ScoreBreakdownPanel({ breakdown, devHoldPct, bondingCurvePct, devBuySol, hasSocials, twitterUrl, telegramUrl, websiteUrl, score }: Props) {
  const [open, setOpen] = useState(false)

  const socialLinks = [
    twitterUrl && { label: 'Twitter', url: twitterUrl },
    telegramUrl && { label: 'Telegram', url: telegramUrl },
    websiteUrl && { label: 'Website', url: websiteUrl },
  ].filter(Boolean) as { label: string; url: string }[]

  const socialsDetail = socialLinks.length > 0
    ? socialLinks.map((s) => s.label).join(' · ')
    : hasSocials === false ? 'no socials' : 'unknown'

  const items = [
    {
      label: 'Dev hold < 5%',
      points: breakdown.dev_hold_safety,
      max: 40,
      detail: devHoldPct != null ? `dev holds ${devHoldPct.toFixed(1)}%` : 'unknown',
      satisfied: breakdown.dev_hold_safety > 0,
    },
    {
      label: 'Bonding curve signal',
      points: breakdown.bonding_curve_signal,
      max: 30,
      detail: bondingCurvePct != null ? `curve at ${bondingCurvePct.toFixed(0)}%` : 'unknown',
      satisfied: breakdown.bonding_curve_signal > 0,
    },
    {
      label: 'Dev buy ≥ 1 SOL',
      points: breakdown.dev_buy_signal,
      max: 20,
      detail: devBuySol != null ? `dev bought ${devBuySol.toFixed(2)} SOL` : 'unknown',
      satisfied: breakdown.dev_buy_signal > 0,
    },
    {
      label: 'Has socials',
      points: breakdown.socials_signal,
      max: 10,
      detail: socialsDetail,
      satisfied: breakdown.socials_signal > 0,
    },
  ]

  function scoreColor(s: number): string {
    if (s >= 70) return 'text-green-400'
    if (s >= 40) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-base)]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--bg-surface)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-3)]">Score</span>
          <span className={`text-sm font-bold ${scoreColor(score)}`}>{score}</span>
        </div>
        <span className="text-xs text-[var(--text-3)] transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▸
        </span>
      </button>

      {open && (
        <div className="px-2 pb-2">
          {items.map((item) => (
            <Row key={item.label} {...item} />
          ))}
          {socialLinks.length > 0 && (
            <div className="flex gap-1.5 mt-1.5 px-2">
              {socialLinks.map(({ label, url }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
                >
                  {label} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
