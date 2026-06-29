import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { usePortfolioStore } from '../../store/portfolio'
import { useWalletStore } from '../../store/wallet'
import { HistoryPanel } from '../wallet/HistoryPanel'
import { formatPrice } from '../../lib/format'
import { truncateAddress } from '../../lib/utils'

type SplBalance = { mint: string; symbol: string; amount_ui: number }

function useWalletBalances(address: string | null) {
  const [sol, setSol] = useState<number | null>(null)
  const [spl, setSpl] = useState<SplBalance[]>([])
  const positions = usePortfolioStore((s) => s.positions)

  useEffect(() => {
    if (!address) return
    invoke<number>('get_sol_balance', { address }).then(setSol).catch(() => {})
    invoke<SplBalance[]>('get_spl_balances', { address })
      .then((list) => {
        // Resolve symbols: positions store first, then truncated mint
        const resolved = list.map((t) => {
          if (t.symbol) return t
          const pos = positions.find((p) => p.mint === t.mint)
          return { ...t, symbol: pos?.symbol ?? truncateAddress(t.mint, 4, 4) }
        })
        setSpl(resolved)
      })
      .catch(() => {})
    const id = setInterval(() => {
      invoke<number>('get_sol_balance', { address }).then(setSol).catch(() => {})
      invoke<SplBalance[]>('get_spl_balances', { address })
        .then((list) => {
          const resolved = list.map((t) => {
            if (t.symbol) return t
            const pos = positions.find((p) => p.mint === t.mint)
            return { ...t, symbol: pos?.symbol ?? truncateAddress(t.mint, 4, 4) }
          })
          setSpl(resolved)
        })
        .catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  return { sol, spl }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

const TRADE_TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL' },
  { mint: USDC_MINT, symbol: 'USDC' },
  { mint: USDT_MINT, symbol: 'USDT' },
]

const SETTINGS_KEY = 'trade_defaults'

function loadDefaults(): { defaultMint: string; defaultAmount: string; defaultSlippage: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { defaultMint: SOL_MINT, defaultAmount: '0.1', defaultSlippage: '100' }
}

function saveDefaults(v: { defaultMint: string; defaultAmount: string; defaultSlippage: string }) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(v))
}

export function PortfolioSurface() {
  const address = useWalletStore((s) => s.address)
  const positions = usePortfolioStore((s) => s.positions)
  const globalStopLossPct = usePortfolioStore((s) => s.globalStopLossPct)
  const setGlobalStopLoss = usePortfolioStore((s) => s.setGlobalStopLoss)
  const setPositionStopLoss = usePortfolioStore((s) => s.setPositionStopLoss)
  const [selling, setSelling] = useState<string | null>(null)
  const [editingSl, setEditingSl] = useState<string | null>(null)
  const [defaults, setDefaults] = useState(loadDefaults)

  const { sol, spl } = useWalletBalances(address)
  const SL_OPTIONS = [10, 20, 30, 50, 70]
  const SLIPPAGE_OPTIONS = [
    { label: '0.5%', value: '50' },
    { label: '1%', value: '100' },
    { label: '2%', value: '200' },
    { label: '5%', value: '500' },
  ]

  const totalPnl = positions.reduce((sum, p) => {
    if (p.pnl_pct == null || p.current_price_usd == null) return sum
    return sum + p.amount_tokens * (p.current_price_usd - p.entry_price_usd)
  }, 0)

  async function handleSell(mint: string, amountTokens: number, decimals: number) {
    if (!address || selling) return
    setSelling(mint)
    try {
      const amountRaw = Math.floor(amountTokens * Math.pow(10, decimals))
      const quote = await invoke<{ serialized_tx: string; out_amount_ui: number }>('build_sell_transaction', {
        params: { input_mint: mint, amount_tokens: amountRaw, slippage_bps: 100, user_public_key: address, input_decimals: decimals },
      })
      const signedTxBase64 = await invoke<string>('sign_transaction', { txBase64: quote.serialized_tx })
      const txResult = await invoke<{ signature: string; status: string }>('send_sell_transaction', { signedTxBase64 })
      if (txResult.status === 'confirmed') {
        const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)
        invoke('log_trade', {
          mint, symbol: pos?.symbol ?? mint.slice(0, 6), side: 'sell',
          amountSol: quote.out_amount_ui, amountTokens, priceUsd: pos?.current_price_usd ?? null,
          txSignature: txResult.signature, status: 'confirmed', createdAt: Date.now(),
        }).catch(console.error)
        invoke('stop_price_tracking', { mint }).catch(console.error)
        const { emit } = await import('@tauri-apps/api/event')
        emit('position_closed', { mint, close_reason: 'manual', exit_price_usd: pos?.current_price_usd ?? 0, realized_pnl_pct: pos?.pnl_pct ?? 0 })
      }
    } catch (err) {
      console.error('Sell failed:', err)
    } finally {
      setSelling(null)
    }
  }

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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-[var(--text-1)] tracking-wide">Portfolio</h2>
        {totalPnl !== 0 && (
          <span className={`text-sm font-bold tabular-nums font-mono ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USD total PnL
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-6">
        {/* Left: positions + history */}
        <div className="space-y-5">
          {/* Open positions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                Open Positions ({positions.length})
              </p>
              {positions.length > 0 && (
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-3)]">
                  Global SL:
                  <select
                    value={globalStopLossPct}
                    onChange={(e) => setGlobalStopLoss(Number(e.target.value))}
                    className="bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-1)] text-[11px] rounded px-1.5 py-0.5 outline-none"
                  >
                    {SL_OPTIONS.map((opt) => <option key={opt} value={opt}>-{opt}%</option>)}
                  </select>
                </div>
              )}
            </div>

            {positions.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-8 text-center">
                <p className="text-sm text-[var(--text-3)]">No open positions</p>
              </div>
            ) : (
              <div className="space-y-2">
                {positions.map((p) => {
                  const pnlColor = p.pnl_pct == null ? 'text-[var(--text-3)]' : p.pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'
                  const slPct = p.stop_loss_pct ?? globalStopLossPct
                  const pnlUsd = p.pnl_pct != null && p.current_price_usd != null
                    ? p.amount_tokens * (p.current_price_usd - p.entry_price_usd)
                    : null

                  return (
                    <div key={p.mint} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="font-mono text-sm font-bold text-[var(--text-1)]">${p.symbol}</span>
                            <span className={`text-sm font-bold tabular-nums ${pnlColor}`}>
                              {p.pnl_pct != null ? `${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(2)}%` : '—'}
                            </span>
                            {pnlUsd != null && (
                              <span className={`text-xs tabular-nums font-mono ${pnlColor}`}>
                                ({pnlUsd >= 0 ? '+' : ''}{pnlUsd.toFixed(3)} USD)
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
                            <StatCell label="Entry" value={formatPrice(p.entry_price_usd)} />
                            <StatCell label="Current" value={p.current_price_usd != null ? formatPrice(p.current_price_usd) : '—'} />
                            <StatCell label="Spent" value={`${p.amount_sol_spent?.toFixed(3) ?? '—'} ◎`} />
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <button
                            onClick={() => handleSell(p.mint, p.amount_tokens, p.decimals)}
                            disabled={selling === p.mint || !address}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50 transition-colors"
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
                              <button onClick={() => setEditingSl(p.mint)} className="hover:text-[var(--text-1)] underline underline-offset-2">
                                -{slPct}%
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* History */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-3)] mb-3">
              Trade History
            </p>
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              <HistoryPanel />
            </div>
          </section>
        </div>

        {/* Right: trade defaults */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-3)] mb-3">
            Trade Defaults
          </p>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-4">
            {/* Token dropdown + balance — shows all tokens user holds */}
            {(() => {
              const allTokens = [
                { mint: SOL_MINT, symbol: 'SOL', balance: sol != null ? sol.toFixed(4) : '—' },
                ...spl.map((t) => ({
                  mint: t.mint,
                  symbol: t.symbol || t.mint.slice(0, 4) + '…' + t.mint.slice(-4),
                  balance: t.amount_ui.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                })),
              ]
              const selected = allTokens.find((t) => t.mint === defaults.defaultMint) ?? allTokens[0]!
              return (
                <div className="space-y-1.5">
                  <label className="text-[11px] text-[var(--text-2)]">Pay with</label>
                  <div className="relative">
                    <select
                      value={defaults.defaultMint}
                      onChange={(e) => updateDefault({ defaultMint: e.target.value })}
                      className="w-full appearance-none bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-1)] text-sm font-mono font-bold rounded-lg px-3 py-2.5 pr-8 outline-none focus:border-[var(--border-strong)] cursor-pointer"
                    >
                      {allTokens.map((t) => (
                        <option key={t.mint} value={t.mint}>{t.symbol}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-3)]">▾</span>
                  </div>
                  <p className="text-[11px] font-mono text-[var(--text-3)] tabular-nums pl-0.5">
                    Balance: {selected.balance} {selected.symbol}
                  </p>
                </div>
              )
            })()}

            <div className="space-y-1">
              <label className="text-[11px] text-[var(--text-2)]">Default amount</label>
              <input
                type="text"
                value={defaults.defaultAmount}
                onChange={(e) => updateDefault({ defaultAmount: e.target.value })}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-1)] outline-none focus:border-[var(--border-strong)]"
                placeholder="0.1"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-[var(--text-2)]">Default slippage</label>
              <div className="flex gap-2 flex-wrap">
                {SLIPPAGE_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => updateDefault({ defaultSlippage: s.value })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
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

            <p className="text-[10px] text-[var(--text-3)]">
              Saved locally. TradePanel uses these as initial values.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-[var(--text-3)] uppercase tracking-wider">{label}</p>
      <p className="text-[11px] font-mono text-[var(--text-2)] tabular-nums">{value}</p>
    </div>
  )
}
