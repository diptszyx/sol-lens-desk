import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { formatUsd } from '../../lib/format'

interface ClosedPosition {
  id: number | null
  mint: string
  symbol: string
  entry_price_usd: number
  exit_price_usd: number
  amount_sol_spent: number
  amount_sol_received: number
  realized_pnl_usd: number
  realized_pnl_pct: number
  opened_at: number
  closed_at: number
  close_reason: string
}

function PnlBadge({ pct }: { pct: number }) {
  const color = pct >= 0 ? 'text-green-400' : 'text-red-400'
  return (
    <span className={`text-xs font-bold tabular-nums ${color}`}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function ReasonBadge({ reason }: { reason: string }) {
  const label = reason === 'stop_loss' ? 'SL' : reason === 'manual' ? 'Manual' : reason
  const style = reason === 'stop_loss'
    ? 'bg-red-500/10 text-red-400 border-red-500/20'
    : 'bg-[var(--bg-deep)] text-[var(--text-3)] border-[var(--border)]'
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide ${style}`}>
      {label}
    </span>
  )
}

function formatTs(ms: number) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function HistoryPanel({ compact }: { compact?: boolean }) {
  const [history, setHistory] = useState<ClosedPosition[]>([])

  async function load() {
    try {
      const data = await invoke<ClosedPosition[]>('get_closed_positions')
      setHistory(data.slice().reverse())
    } catch {
      // silently ignore — DB may be empty
    }
  }

  useEffect(() => {
    load()
    const unsub = listen('position_closed', () => { load() })
    return () => { unsub.then((fn) => fn()) }
  }, [])

  const totalPnlUsd = history.reduce((sum, p) => sum + p.realized_pnl_usd, 0)
  const winCount = history.filter((p) => p.realized_pnl_pct >= 0).length

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-[var(--text-2)]">No closed trades yet</p>
          <p className="text-xs text-[var(--text-3)]">Trades will appear here after you close a position</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary */}
      <div className={`border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-base)] ${compact ? 'px-3 py-2.5' : 'px-5 py-4'}`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)] mb-2.5">
          {compact ? `HISTORY ${history.length}W/${history.length - winCount}L` : 'Trade History'}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-lg bg-[var(--bg-deep)] ${compact ? 'px-2 py-1.5' : 'px-3 py-2.5'}`}>
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wide mb-0.5">Closed</p>
            <p className={`font-bold text-[var(--text-1)] ${compact ? 'text-xs' : 'text-sm'}`}>{history.length}</p>
          </div>
          <div className={`rounded-lg bg-[var(--bg-deep)] ${compact ? 'px-2 py-1.5' : 'px-3 py-2.5'}`}>
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wide mb-0.5">Win rate</p>
            <p className={`font-bold text-[var(--text-1)] ${compact ? 'text-xs' : 'text-sm'}`}>
              {history.length > 0 ? Math.round((winCount / history.length) * 100) : 0}%
            </p>
          </div>
          <div className={`rounded-lg bg-[var(--bg-deep)] ${compact ? 'px-2 py-1.5' : 'px-3 py-2.5'}`}>
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wide mb-0.5">PnL</p>
            <p className={`font-bold ${totalPnlUsd >= 0 ? 'text-green-400' : 'text-red-400'} ${compact ? 'text-xs' : 'text-sm'}`}>
              {totalPnlUsd >= 0 ? '+' : ''}{formatUsd(totalPnlUsd)}
            </p>
          </div>
        </div>
      </div>

      {/* Position list */}
      <div className="flex-1 overflow-y-auto">
        {history.map((p, i) => (
          <div
            key={p.id ?? i}
            className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition-colors ${compact ? 'px-3 py-2' : 'px-5 py-3'}`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-mono text-sm font-bold text-[var(--text-1)]">${p.symbol}</span>
              <div className="flex items-center gap-2">
                <ReasonBadge reason={p.close_reason} />
                <PnlBadge pct={p.realized_pnl_pct} />
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--text-3)]">
              <span className="tabular-nums">
                {p.amount_sol_spent.toFixed(3)} → {p.amount_sol_received.toFixed(3)} SOL
              </span>
              <span>{formatTs(p.closed_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
