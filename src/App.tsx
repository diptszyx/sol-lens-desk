import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { WalletGate } from './components/auth/WalletGate'
import { TokenFeed } from './components/token-feed/TokenFeed'
import { TradePanel } from './components/token-detail/TradePanel'
import { ScoreBreakdownPanel } from './components/token-detail/ScoreBreakdown'
import { MiniPet } from './components/pet/MiniPet'
import { WalletDropdown } from './components/wallet/WalletDropdown'
import { ExportModal } from './components/wallet/ExportModal'
import { HistoryPanel } from './components/wallet/HistoryPanel'
import { SideRail } from './components/layout/SideRail'
import type { ActiveSurface } from './components/layout/SideRail'
import { PetDashboard } from './components/pet/PetDashboard'
import { PortfolioSurface } from './components/portfolio/PortfolioSurface'
import { useTokenFeedStore } from './store/tokenFeed'
import { usePetStore } from './store/pet'
import { usePetTradeBridge } from './hooks/usePetTradeBridge'
import { useHandleSell } from './hooks/useHandleSell'
import { usePortfolioStore } from './store/portfolio'
import { setupPortfolioEventListeners, restoreOpenPositions, loadGlobalSl } from './store/portfolio'
import { setupPetEventListeners } from './store/pet'
import { useWalletStore } from './store/wallet'
import { formatAge, formatSol, formatPrice, formatUsd } from './lib/format'

function Header({ onExport }: { onExport: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-base)] px-4 py-2.5 flex-shrink-0">
      <div className="flex items-center gap-2.5">
        <span
          className="text-base select-none"
          style={{ color: 'var(--accent)', filter: 'drop-shadow(0 0 6px var(--glow-purple))' }}
        >
          ◎
        </span>
        <h1
          className="text-sm font-bold tracking-wide"
          style={{
            backgroundImage: 'var(--brand-gradient)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Sol Lens
        </h1>
        <span className="text-[9px] font-semibold text-[var(--text-3)] bg-[var(--bg-surface)] border border-[var(--border)] px-1.5 py-0.5 rounded tracking-widest">
          ALPHA
        </span>
      </div>
      <div className="flex items-center gap-2">
        <MiniPet />
        <WalletDropdown onExport={onExport} />
      </div>
    </header>
  )
}

function TokenDetail() {
  const selected = useTokenFeedStore((s) => s.selected)
  const [showMint, setShowMint] = useState(false)

  if (!selected) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <span
            className="text-4xl select-none block"
            style={{ color: 'var(--accent)', filter: 'drop-shadow(0 0 12px var(--glow-purple))' }}
          >
            ◎
          </span>
          <p className="text-sm font-medium text-[var(--text-2)]">Select a token</p>
          <p className="text-xs text-[var(--text-3)]">Click any token from the feed to view details and trade</p>
        </div>
      </div>
    )
  }

  const displaySymbol = selected.symbol ?? selected.mint.slice(0, 8)
  const isPumpFun = selected.source === 'pump_fun'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-base)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPumpFun ? 'bg-green-400' : 'bg-blue-400'}`} />
              <h2 className="font-mono font-black text-lg text-[var(--text-1)] truncate leading-none">
                ${displaySymbol}
              </h2>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                isPumpFun
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              }`}>
                {isPumpFun ? 'pump.fun' : selected.source}
              </span>
            </div>
            {selected.name && (
              <p className="text-[11px] text-[var(--text-3)] mt-0.5 pl-3.5 truncate">{selected.name}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[10px] text-[var(--text-3)] tabular-nums">
              {formatAge(Math.floor((Date.now() - selected.detected_at) / 1000))}
            </span>
            {selected.price_usd != null && (
              <span className="text-base font-black text-[var(--text-1)] font-mono tabular-nums tracking-tight">
                {formatPrice(selected.price_usd)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row — compact single line */}
      <div className="flex border-b border-[var(--border)] flex-shrink-0 divide-x divide-[var(--border)]">
        {[
          { label: 'Liq', value: `${formatSol(selected.liquidity_sol)}◎` },
          { label: 'MC', value: selected.market_cap_usd != null ? formatUsd(selected.market_cap_usd) : '—' },
          { label: 'Vol', value: selected.volume_24h != null ? formatUsd(selected.volume_24h) : '—' },
          { label: 'Holders', value: selected.holder_count != null ? selected.holder_count.toLocaleString() : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="flex-1 px-2.5 py-2">
            <p className="text-[9px] text-[var(--text-3)] uppercase tracking-widest font-semibold">{label}</p>
            <p className="text-[11px] font-bold text-[var(--text-1)] font-mono tabular-nums mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Score breakdown */}
      <ScoreBreakdownPanel
        breakdown={selected.score_breakdown}
        devHoldPct={selected.dev_hold_pct}
        bondingCurvePct={selected.bonding_curve_pct}
        devBuySol={selected.dev_buy_sol}
        hasSocials={selected.has_socials}
        twitterUrl={selected.twitter_url}
        telegramUrl={selected.telegram_url}
        websiteUrl={selected.website_url}
        score={selected.score}
      />

      {/* Mint — collapsed by default */}
      <div className="flex-shrink-0 border-b border-[var(--border)]">
        <button
          onClick={() => setShowMint(!showMint)}
          className="w-full px-4 py-1.5 flex items-center justify-between text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
        >
          <span className="uppercase tracking-widest font-semibold">Mint</span>
          <span>{showMint ? '▴' : '▾'}</span>
        </button>
        {showMint && (
          <div className="px-4 pb-2">
            <p
              className="font-mono text-[10px] text-[var(--text-2)] break-all select-all cursor-copy leading-relaxed"
              onClick={() => navigator.clipboard.writeText(selected.mint)}
              title="Click to copy"
            >
              {selected.mint}
            </p>
          </div>
        )}
      </div>

      {/* Trade panel */}
      <div className="flex-1 overflow-y-auto">
        <TradePanel token={selected} />
      </div>
    </div>
  )
}

function PortfolioColumn() {
  const address = useWalletStore((s) => s.address)

  const positions = usePortfolioStore((s) => s.positions)
  const globalStopLossPct = usePortfolioStore((s) => s.globalStopLossPct)
  const setPositionStopLoss = usePortfolioStore((s) => s.setPositionStopLoss)
  const { handleSell, selling, errors: sellErrors } = useHandleSell()
  const [editingSl, setEditingSl] = useState<string | null>(null)

  function confirmSl(mint: string) {
    setEditingSl(null)
    const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)
    if (!pos) return
    invoke('start_price_tracking', { mint, entry_price_usd: pos.entry_price_usd, stop_loss_pct: pos.stop_loss_pct }).catch(console.error)
  }

  // Compute total PnL
  const totalPnl = positions.reduce((sum, p) => {
    if (p.pnl_pct == null || p.current_price_usd == null) return sum
    return sum + p.amount_tokens * (p.current_price_usd - p.entry_price_usd)
  }, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Open positions */}
      <div className="flex-shrink-0 border-b border-[var(--border)]">
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
              Open ({positions.length})
            </p>
            <div className="flex items-center gap-1">
              {totalPnl !== 0 && (
                <span className={`text-xs font-semibold tabular-nums ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USD
                </span>
              )}
            </div>
          </div>

          {positions.length === 0 ? (
            <p className="text-xs text-[var(--text-3)] py-1">No open positions</p>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {positions.map((p) => {
                const pnlColor = p.pnl_pct == null ? 'text-[var(--text-3)]' : p.pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'
                const slPct = p.stop_loss_pct ?? globalStopLossPct
                return (
                  <div key={p.mint} className="rounded-lg bg-[var(--bg-deep)] px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold text-[var(--text-1)] truncate">${p.symbol}</span>
                        <span className={`text-[11px] font-semibold tabular-nums ${pnlColor}`}>
                          {p.pnl_pct != null ? `${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-[var(--text-3)] tabular-nums">
                          {p.current_price_usd != null ? formatPrice(p.current_price_usd) : '—'}
                        </span>
                        <div className="flex items-center gap-1">
                          {editingSl === p.mint ? (
                            <input
                              type="number" value={slPct}
                              onChange={(e) => setPositionStopLoss(p.mint, Number(e.target.value))}
                              onBlur={() => confirmSl(p.mint)}
                              onKeyDown={(e) => e.key === 'Enter' && confirmSl(p.mint)}
                              autoFocus
                              className="w-10 text-right bg-[var(--bg-surface)] border border-[var(--accent)] rounded px-1 py-0.5 text-[var(--text-1)] outline-none text-[10px]"
                            />
                          ) : (
                            <button onClick={() => setEditingSl(p.mint)} className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)]">
                              SL -{slPct}%
                            </button>
                          )}
                          <button
                            onClick={() => handleSell(p.mint, p.amount_tokens, p.decimals)}
                            disabled={selling === p.mint || !address}
                            className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50"
                          >
                            {selling === p.mint ? '…' : 'SELL'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {sellErrors[p.mint] && (
                    <div className="mt-1 flex items-center justify-between gap-1.5 rounded bg-red-500/8 border border-red-500/20 px-1.5 py-1">
                      <p className="text-[9px] text-red-400 leading-tight">{sellErrors[p.mint]}</p>
                      <button
                        onClick={() => handleSell(p.mint, p.amount_tokens, p.decimals, { force: true })}
                        disabled={selling === p.mint || !address}
                        className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500 text-white hover:opacity-90 disabled:opacity-40"
                      >
                        Force
                      </button>
                    </div>
                  )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="flex-1 overflow-hidden">
        <HistoryPanel compact />
      </div>
    </div>
  )
}

function Dashboard() {
  usePetTradeBridge()
  const [showExport, setShowExport] = useState(false)
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>('trading')

  useEffect(() => {
    setupPortfolioEventListeners()
    setupPetEventListeners()
    usePetStore.getState().loadFromDb()
    restoreOpenPositions()
    loadGlobalSl().then((pct) => usePortfolioStore.getState().hydrateGlobalSl(pct))

    // Show the desktop pet overlay window
    import('@tauri-apps/api/webviewWindow').then(async ({ WebviewWindow }) => {
      const pet = await WebviewWindow.getByLabel('pet')
      pet?.show()
    }).catch(() => {})
  }, [])

  return (
    <div className="flex h-screen bg-[var(--bg-deep)]">
      <SideRail activeSurface={activeSurface} onSwitch={setActiveSurface} />

      <div className="flex h-screen flex-col flex-1">
        <Header onExport={() => setShowExport(true)} />

        {activeSurface === 'trading' && (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[280px] flex-shrink-0 border-r border-[var(--border)] flex flex-col">
              <TokenFeed />
            </div>
            <div className="flex-1 overflow-hidden border-r border-[var(--border)]">
              <TokenDetail />
            </div>
            <div className="w-[300px] flex-shrink-0 flex flex-col">
              <PortfolioColumn />
            </div>
          </div>
        )}
        {activeSurface === 'portfolio' && (
          <div className="flex-1 overflow-auto">
            <PortfolioSurface />
          </div>
        )}
        {activeSurface === 'pet' && (
          <div className="flex-1 overflow-auto">
            <PetDashboard />
          </div>
        )}

        {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <WalletGate>
      <Dashboard />
    </WalletGate>
  )
}
