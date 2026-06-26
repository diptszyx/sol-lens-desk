import { useEffect } from 'react'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { WalletGate } from './components/auth/WalletGate'
import { useWallet } from './hooks/useWallet'
import { usePetTradeBridge } from './hooks/usePetTradeBridge'
import { TokenFeed } from './components/token-feed/TokenFeed'
import { TradePanel } from './components/token-detail/TradePanel'
import { PortfolioPanel } from './components/portfolio/PortfolioPanel'
import { useTokenFeedStore } from './store/tokenFeed'
import { formatAge, formatSol, formatPrice, formatUsd } from './lib/format'
import { truncateAddress } from '@shared/utils'

function Header() {
  const { address, logout } = useWallet()

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-base)] px-5 py-3 flex-shrink-0">
      <div className="flex items-center gap-2.5">
        <span className="text-[var(--accent)] text-base select-none">◎</span>
        <h1 className="text-sm font-bold tracking-wide text-[var(--text-1)]">
          Sol Lens
        </h1>
        <span className="text-[9px] font-semibold text-[var(--text-3)] bg-[var(--bg-surface)] border border-[var(--border)] px-1.5 py-0.5 rounded tracking-widest">
          ALPHA
        </span>
      </div>
      <div className="flex items-center gap-3">
        {address && (
          <span className="font-mono text-xs text-[var(--text-2)] bg-[var(--bg-surface)] px-2.5 py-1 rounded-md border border-[var(--border)]">
            {truncateAddress(address, 4, 4)}
          </span>
        )}
        <button
          onClick={logout}
          className="text-xs text-[var(--text-3)] hover:text-[var(--negative)] transition-colors px-2 py-1"
        >
          Disconnect
        </button>
      </div>
    </header>
  )
}

function TokenDetail() {
  const selected = useTokenFeedStore((s) => s.selected)

  if (!selected) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <span className="text-4xl select-none block">◎</span>
          <p className="text-sm font-medium text-[var(--text-2)]">Select a token</p>
          <p className="text-xs text-[var(--text-3)]">
            Click any token from the feed to view details and trade
          </p>
        </div>
      </div>
    )
  }

  const displaySymbol = selected.symbol ?? selected.mint.slice(0, 8)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Token header */}
      <div className="px-5 py-4 border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-base)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  selected.source === 'pump_fun' ? 'bg-green-400' : 'bg-blue-400'
                }`}
              />
              <h2 className="font-mono font-bold text-xl text-[var(--text-1)] truncate">
                ${displaySymbol}
              </h2>
              <span className="text-xs text-[var(--text-3)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded flex-shrink-0">
                {selected.source}
              </span>
            </div>
            {selected.name && (
              <p className="text-xs text-[var(--text-2)] pl-4">{selected.name}</p>
            )}
          </div>
          <span className="text-xs text-[var(--text-3)] flex-shrink-0 mt-1">
            {formatAge(selected.age_seconds)}
          </span>
        </div>
        {selected.price_usd != null && (
          <p className="text-3xl font-bold text-[var(--text-1)] mt-3 tracking-tight font-mono">
            {formatPrice(selected.price_usd)}
          </p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 border-b border-[var(--border)] flex-shrink-0">
        {[
          { label: 'Liquidity', value: `${formatSol(selected.liquidity_sol)} SOL` },
          { label: 'Market Cap', value: selected.market_cap_usd != null ? formatUsd(selected.market_cap_usd) : '—' },
          { label: 'Volume 24h', value: selected.volume_24h != null ? formatUsd(selected.volume_24h) : '—' },
          { label: 'Holders', value: selected.holder_count != null ? selected.holder_count.toLocaleString() : '—' },
        ].map(({ label, value }, i) => (
          <div key={label} className={`px-5 py-3 ${i % 2 === 0 ? 'border-r' : ''} ${i >= 2 ? 'border-t' : ''} border-[var(--border)]`}>
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-widest font-semibold mb-1">{label}</p>
            <p className="text-sm font-bold text-[var(--text-1)]">{value}</p>
          </div>
        ))}
      </div>

      {/* Mint address */}
      <div className="px-5 py-2.5 border-b border-[var(--border)] flex-shrink-0">
        <p className="text-[10px] text-[var(--text-3)] uppercase tracking-widest font-medium mb-1">
          Mint
        </p>
        <p className="font-mono text-xs text-[var(--text-2)] break-all select-all">
          {selected.mint}
        </p>
      </div>

      {/* Trade panel */}
      <TradePanel token={selected} />
    </div>
  )
}

function Dashboard() {
  // Bridge buy requests coming from the capybara overlay window.
  usePetTradeBridge()

  // Show the capybara overlay once the dashboard mounts (i.e. after login);
  // hide it again on logout (unmount).
  useEffect(() => {
    let cancelled = false
    WebviewWindow.getByLabel('pet').then((w) => {
      if (w && !cancelled) w.show()
    })
    return () => {
      cancelled = true
      WebviewWindow.getByLabel('pet').then((w) => w?.hide())
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-deep)]">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Token Feed (left) */}
        <div className="w-[380px] flex-shrink-0 border-r border-[var(--border)]">
          <TokenFeed />
        </div>

        {/* Detail + Portfolio (right) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <TokenDetail />
          </div>
          <PortfolioPanel />
        </div>
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
