import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { usePortfolioStore } from '../../store/portfolio'
import { useWalletStore } from '../../store/wallet'
import { useHandleSell } from '../../hooks/useHandleSell'
import { HistoryPanel } from '../wallet/HistoryPanel'
import { RpcSettings } from '../settings/RpcSettings'
import { formatPrice } from '../../lib/format'
import { loadTradeDefaults as loadDefaults, saveTradeDefaults as saveDefaults } from '../../lib/tradeDefaults'

function openUrl(url: string) {
  invoke('open_url', { url }).catch(() => {})
}

function useSolBalance(address: string | null) {
  const [sol, setSol] = useState<number | null>(null)

  useEffect(() => {
    if (!address) return
    invoke<number>('get_sol_balance', { address }).then(setSol).catch(console.error)
    const id = setInterval(() => {
      invoke<number>('get_sol_balance', { address }).then(setSol).catch(console.error)
    }, 30000)
    return () => clearInterval(id)
  }, [address])

  return sol
}

// Pay-with token selection was removed — bonding curves detected fresh are quote_mint=SOL
// in practice, and TradePanel now always pays with SOL (see plan/19-pumpfun-direct-trade.md).

export function PortfolioSurface() {
  const address = useWalletStore((s) => s.address)
  const positions = usePortfolioStore((s) => s.positions)
  const globalStopLossPct = usePortfolioStore((s) => s.globalStopLossPct)
  const setGlobalStopLoss = usePortfolioStore((s) => s.setGlobalStopLoss)
  const setPositionStopLoss = usePortfolioStore((s) => s.setPositionStopLoss)
  const { handleSell, selling, errors: sellErrors } = useHandleSell()
  const [editingSl, setEditingSl] = useState<string | null>(null)
  const [defaults, setDefaults] = useState(loadDefaults)

  const sol = useSolBalance(address)

  const SL_OPTIONS = [10, 20, 30, 50, 70]
  const SLIPPAGE_OPTIONS = [
    { label: '0.5%', value: '50' },
    { label: '1%', value: '100' },
    { label: '2%', value: '200' },
    { label: '5%', value: '500' },
  ]

  const totalPnlUsd = positions.reduce((sum, p) => {
    if (p.pnl_pct == null || p.current_price_usd == null) return sum
    return sum + p.amount_tokens * (p.current_price_usd - p.entry_price_usd)
  }, 0)

  const hasPnl = positions.some((p) => p.pnl_pct != null)

  function confirmSl(mint: string) {
    setEditingSl(null)
    const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)
    if (!pos) return
    invoke('start_price_tracking', { mint, entry_price_usd: pos.entry_price_usd, stop_loss_pct: pos.stop_loss_pct }).catch(console.error)
  }

  function updateDefault(patch: Partial<typeof defaults>) {
    const next = { ...defaults, ...patch }
    setDefaults(next)
    saveDefaults(next)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-2)]">Portfolio</h2>
        <div className="flex items-center gap-3 text-xs font-mono">
          {sol != null ? (
            <span className="text-[var(--text-2)] tabular-nums">
              <span className="text-[var(--text-1)] font-semibold">{sol.toFixed(4)}</span> ◎
            </span>
          ) : (
            <span className="text-[var(--text-3)] text-[10px]">
              {address ? 'Loading balance…' : 'Wallet locked'}
            </span>
          )}
          {hasPnl && (
            <span className={`tabular-nums font-semibold ${totalPnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnlUsd >= 0 ? '+' : ''}{totalPnlUsd.toFixed(2)} USD
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_268px] gap-5 items-start">
        {/* ─── Left ─── */}
        <div className="space-y-5">
          {/* Open positions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="block w-0.5 h-3.5 rounded-full bg-[var(--accent)]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-2)]">
                  Open Positions
                </span>
                <span className="text-[10px] text-[var(--text-3)] font-mono">({positions.length})</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
                Global SL
                <select
                  value={globalStopLossPct}
                  onChange={(e) => setGlobalStopLoss(Number(e.target.value))}
                  className="bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-1)] text-[11px] rounded px-1.5 py-0.5 outline-none"
                >
                  {SL_OPTIONS.map((opt) => <option key={opt} value={opt}>-{opt}%</option>)}
                </select>
              </div>
            </div>

            {positions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)]/30 py-10 text-center">
                <p className="text-xs text-[var(--text-3)]">No open positions</p>
                <p className="text-[10px] text-[var(--text-3)]/50 mt-1">Buy from the token feed to open one</p>
              </div>
            ) : (
              <div className="space-y-2">
                {positions.map((p) => {
                  // On app restart, current_price_usd is seeded from entry_price_usd as a
                  // placeholder until the WS delivers a real trade for this mint — treat
                  // that the same as "no reading yet", not a confirmed 0% change.
                  const hasPriceReading = p.pnl_pct != null && p.priceLoaded !== false
                  const isProfit = hasPriceReading && p.pnl_pct! >= 0
                  const pnlColor = !hasPriceReading
                    ? 'text-[var(--text-3)]'
                    : isProfit ? 'text-green-400' : 'text-red-400'
                  const accentBorder = !hasPriceReading
                    ? 'border-l-[var(--border-strong)]'
                    : isProfit ? 'border-l-green-500/50' : 'border-l-red-500/50'
                  const slPct = p.stop_loss_pct ?? globalStopLossPct
                  const pnlUsd = hasPriceReading && p.current_price_usd != null
                    ? p.amount_tokens * (p.current_price_usd - p.entry_price_usd)
                    : null

                  return (
                    <div
                      key={p.mint}
                      className={`rounded-xl border border-[var(--border)] border-l-2 ${accentBorder} bg-[var(--bg-surface)] px-4 py-3`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-2">
                            <span
                              onClick={() => openUrl(`https://pump.fun/coin/${p.mint}`)}
                              className="font-mono text-sm font-bold text-[var(--text-1)] cursor-pointer hover:text-[var(--accent)] transition-colors"
                              title="Open on pump.fun"
                            >
                              ${p.symbol}
                            </span>
                            <span className={`text-sm font-bold tabular-nums ${pnlColor}`} title={hasPriceReading ? undefined : 'Waiting for a live price'}>
                              {hasPriceReading ? `${p.pnl_pct! >= 0 ? '+' : ''}${p.pnl_pct!.toFixed(2)}%` : '…'}
                            </span>
                            {pnlUsd != null && (
                              <span className={`text-[10px] tabular-nums font-mono ${pnlColor} opacity-70`}>
                                {pnlUsd >= 0 ? '+' : ''}{pnlUsd.toFixed(3)} USD
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-x-4">
                            <StatCell label="Entry" value={formatPrice(p.entry_price_usd)} />
                            <StatCell
                              label="Current"
                              value={p.current_price_usd != null ? formatPrice(p.current_price_usd) : '—'}
                              muted={!p.priceLoaded}
                              title={p.priceLoaded ? undefined : 'Waiting for a live trade on this token — showing entry price until then'}
                            />
                            <StatCell label="Spent" value={`${p.amount_sol_spent?.toFixed(3) ?? '—'} ◎`} />
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleSell(p.mint, p.amount_tokens, p.decimals)}
                            disabled={selling === p.mint || !address}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-500/8 text-red-400 hover:bg-red-500/15 border border-red-500/20 disabled:opacity-40 transition-colors"
                          >
                            {selling === p.mint ? 'Selling…' : 'SELL'}
                          </button>
                          <div className="flex items-center gap-1 text-[10px] text-[var(--text-3)]">
                            SL:&nbsp;
                            {editingSl === p.mint ? (
                              <input
                                type="number" value={slPct}
                                onChange={(e) => setPositionStopLoss(p.mint, Number(e.target.value))}
                                onBlur={() => confirmSl(p.mint)}
                                onKeyDown={(e) => e.key === 'Enter' && confirmSl(p.mint)}
                                autoFocus
                                className="w-12 text-right bg-[var(--bg-elevated)] border border-[var(--accent)] rounded px-1 py-0.5 text-[var(--text-1)] outline-none text-[10px]"
                              />
                            ) : (
                              <button
                                onClick={() => setEditingSl(p.mint)}
                                className="hover:text-[var(--text-1)] underline underline-offset-2 tabular-nums"
                              >
                                -{slPct}%
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {sellErrors[p.mint] && (
                        <div className="mt-2.5 rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-red-400 leading-snug">{sellErrors[p.mint]}</p>
                          <button
                            onClick={() => handleSell(p.mint, p.amount_tokens, p.decimals, { force: true })}
                            disabled={selling === p.mint || !address}
                            className="flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-bold bg-red-500 text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                          >
                            Force Sell
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Trade history */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="block w-0.5 h-3.5 rounded-full bg-[var(--border-strong)]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-3)]">
                Trade History
              </span>
            </div>
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              <HistoryPanel />
            </div>
          </section>
        </div>

        {/* ─── Right: Trade defaults ─── */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-3)]">
              Trade Defaults
            </span>
          </div>

          <div className="p-4 space-y-4">
            {/* Amount */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Amount</label>
              <input
                type="text"
                value={defaults.defaultAmount}
                onChange={(e) => updateDefault({ defaultAmount: e.target.value })}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-1)] outline-none focus:border-[var(--border-strong)] hover:border-[var(--border-strong)] transition-colors"
                placeholder="0.1"
              />
            </div>

            {/* Slippage */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Slippage</label>
              <div className="grid grid-cols-4 gap-1.5">
                {SLIPPAGE_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => updateDefault({ defaultSlippage: s.value })}
                    className={`py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      defaults.defaultSlippage === s.value
                        ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg-elevated)]/50">
            <p className="text-[10px] text-[var(--text-3)]/60">Saved locally · defaults for TradePanel</p>
          </div>
        </div>

        <div className="mt-4">
          <RpcSettings />
        </div>
      </div>
    </div>
  )
}

function StatCell({ label, value, muted, title }: { label: string; value: string; muted?: boolean; title?: string }) {
  return (
    <div title={title}>
      <p className="text-[9px] text-[var(--text-3)] uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-[11px] font-mono tabular-nums ${muted ? 'text-[var(--text-2)] opacity-70' : 'text-[var(--text-1)]'}`}>{value}</p>
    </div>
  )
}
