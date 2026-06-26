import { usePortfolioStore } from '../../store/portfolio'
import { usePricePoll } from '../../hooks/usePricePoll'
import { formatSol } from '../../lib/format'

export function PortfolioPanel() {
  usePricePoll()
  const positions = usePortfolioStore((s) => s.positions)

  if (positions.length === 0) return null

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-base)]">
      <div className="px-4 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide">
          Portfolio ({positions.length})
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[var(--text-3)] border-b border-[var(--border)]">
              <th className="text-left px-3 py-2 font-medium">Token</th>
              <th className="text-right px-3 py-2 font-medium">Spent</th>
              <th className="text-right px-3 py-2 font-medium">Entry</th>
              <th className="text-right px-3 py-2 font-medium">Current</th>
              <th className="text-right px-3 py-2 font-medium">PnL</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const pnlColor =
                p.pnl_pct == null
                  ? 'text-[var(--text-3)]'
                  : p.pnl_pct >= 0
                    ? 'text-green-400'
                    : 'text-red-400'

              return (
                <tr
                  key={p.mint}
                  className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]"
                >
                  <td className="px-3 py-2 font-mono text-[var(--text-1)]">
                    ${p.symbol}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-2)]">
                    {formatSol(p.amount_sol_spent)} SOL
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-3)] font-mono">
                    {p.entry_price_usd < 0.0001
                      ? p.entry_price_usd.toExponential(2)
                      : p.entry_price_usd.toFixed(
                          p.entry_price_usd >= 1 ? 4 : 8,
                        )}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-2)] font-mono">
                    {p.current_price_usd != null
                      ? p.current_price_usd < 0.0001
                        ? p.current_price_usd.toExponential(2)
                        : p.current_price_usd.toFixed(
                            p.current_price_usd >= 1 ? 4 : 8,
                          )
                      : '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${pnlColor}`}
                  >
                    {p.pnl_pct != null
                      ? `${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
