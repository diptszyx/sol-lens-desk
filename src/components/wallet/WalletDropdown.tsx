import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWalletStore, type WalletInfo } from '../../store/wallet'
import { useWallet } from '../../hooks/useWallet'
import { truncateAddress } from '../../lib/utils'
import { WalletSetup } from '../auth/WalletSetup'
import { restoreOpenPositions } from '../../store/portfolio'

interface Props {
  onExport: () => void
}

export function WalletDropdown({ onExport }: Props) {
  const address = useWalletStore((s) => s.address)
  const wallets = useWalletStore((s) => s.wallets)
  const activeAddr = useWalletStore((s) => s.activeAddress)
  const setActiveAddress = useWalletStore((s) => s.setActiveAddress)
  const setAddress = useWalletStore((s) => s.setAddress)
  const setWallets = useWalletStore((s) => s.setWallets)
  const addWalletToStore = useWalletStore((s) => s.addWallet)
  const removeWalletFromStore = useWalletStore((s) => s.removeWallet)
  const renameWalletInStore = useWalletStore((s) => s.renameWallet)
  const { logout } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [removingWallet, setRemovingWallet] = useState<string | null>(null)
  const [renamingWallet, setRenamingWallet] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [switching, setSwitching] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Balance polling
  useEffect(() => {
    if (!address) return
    invoke<number>('get_sol_balance', { address }).then(setBalance).catch(() => {})
    const id = setInterval(() => {
      invoke<number>('get_sol_balance', { address }).then(setBalance).catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [address])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setRemovingWallet(null)
        setRenamingWallet(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingWallet && renameInputRef.current) {
      renameInputRef.current.focus()
    }
  }, [renamingWallet])

  function copyAddress() {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleSwitch(walletAddr: string) {
    if (switching) return
    setSwitching(true)
    try {
      await invoke<{ active_address: string }>('switch_active_wallet', { address: walletAddr })
      setActiveAddress(walletAddr)
      // Clear positions and refetch for the new wallet
      const { usePortfolioStore } = await import('../../store/portfolio')
      usePortfolioStore.setState({ positions: [] })
      restoreOpenPositions()
      setOpen(false)
    } catch (err) {
      console.error('[WalletDropdown] switch failed:', err)
    } finally {
      setSwitching(false)
    }
  }

  async function handleRemove(walletAddr: string) {
    try {
      const result = await invoke<{ active_address: string; wallets: WalletInfo[] }>('remove_wallet', { address: walletAddr })
      removeWalletFromStore(walletAddr)
      if (result.active_address) {
        setActiveAddress(result.active_address)
        const { usePortfolioStore } = await import('../../store/portfolio')
        usePortfolioStore.setState({ positions: [] })
        restoreOpenPositions()
      }
      setRemovingWallet(null)
    } catch (err) {
      console.error('[WalletDropdown] remove failed:', err)
    }
  }

  async function handleRename() {
    if (!renamingWallet || !renameValue.trim()) {
      setRenamingWallet(null)
      return
    }
    try {
      await invoke('rename_wallet', { address: renamingWallet, label: renameValue.trim() })
      renameWalletInStore(renamingWallet, renameValue.trim())
    } catch (err) {
      console.error('[WalletDropdown] rename failed:', err)
    }
    setRenamingWallet(null)
    setRenameValue('')
  }

  function startRename(walletAddr: string, currentLabel: string) {
    setRenamingWallet(walletAddr)
    setRenameValue(currentLabel)
  }

  function handleWalletCreated(address: string, newWallets?: WalletInfo[]) {
    setShowSetup(false)
    if (newWallets) {
      setWallets(newWallets, activeAddr)
    }
    // If this is the first wallet, also set the active address
    if (!activeAddr) {
      setActiveAddress(address)
    }
  }

  const activeLabel = wallets.find((w) => w.address === activeAddr)?.label

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors bg-[var(--bg-surface)]"
        >
          <span className="font-mono text-xs text-[var(--text-1)]">
            {address ? truncateAddress(address, 4, 4) : '—'}
          </span>
          {balance != null && (
            <span className="text-[10px] text-[var(--text-3)] font-mono tabular-nums">
              {balance.toFixed(3)} ◎
            </span>
          )}
          <span className="text-[10px] text-[var(--text-3)]">▾</span>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1.5 w-64 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg z-50 overflow-hidden">
            {/* Active wallet header */}
            <div className="px-3.5 py-3 border-b border-[var(--border)]">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] text-[var(--text-2)] truncate flex-1">
                  {activeLabel ?? (address ? truncateAddress(address, 6, 6) : '—')}
                </span>
                <button
                  onClick={copyAddress}
                  title="Copy address"
                  className="flex-shrink-0 text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
                >
                  {copied ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
              <span className="text-base font-bold text-[var(--text-1)] tabular-nums font-mono">
                {balance != null ? `${balance.toFixed(4)} ◎` : '—'}
              </span>
            </div>

            {/* Wallet list */}
            <div className="border-b border-[var(--border)] py-1 max-h-48 overflow-y-auto">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest">
                Wallets
              </div>
              {wallets.map((wal) => {
                const isActive = wal.address === activeAddr
                if (removingWallet === wal.address) {
                  return (
                    <div key={wal.address} className="px-3.5 py-2.5 space-y-2">
                      <p className="text-[11px] text-[var(--text-2)]">
                        Remove "{wal.label}" from vault? Your keys are preserved.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRemove(wal.address)}
                          className="flex-1 py-1 rounded text-[11px] font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => setRemovingWallet(null)}
                          className="flex-1 py-1 rounded text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] border border-[var(--border)] transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                }

                return (
                  <div
                    key={wal.address}
                    className={`flex items-center gap-2 px-3.5 py-1.5 transition-colors ${
                      isActive ? 'bg-[var(--accent)]/5' : 'hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    {renamingWallet === wal.address ? (
                      <div className="flex-1 flex items-center gap-1">
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename()
                            if (e.key === 'Escape') setRenamingWallet(null)
                          }}
                          onBlur={handleRename}
                          className="flex-1 bg-[var(--bg-deep)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!isActive) handleSwitch(wal.address)
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-[11px] font-medium text-[var(--text-1)] truncate">{wal.label}</div>
                        <div className="text-[9px] text-[var(--text-3)] font-mono truncate">{wal.address}</div>
                      </button>
                    )}
                    {isActive && !renamingWallet && (
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-[var(--accent)]" title="Active" />
                    )}
                    <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100" style={{ opacity: renamingWallet === wal.address ? 1 : 0.4 }}>
                      {!renamingWallet && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); startRename(wal.address, wal.label) }}
                            className="p-0.5 text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
                            title="Rename"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            </svg>
                          </button>
                          {wallets.length > 1 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setRemovingWallet(wal.address) }}
                              className="p-0.5 text-[var(--text-3)] hover:text-red-400 transition-colors"
                              title="Remove"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                              </svg>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div className="py-1">
              <button
                onClick={() => { setShowSetup(true); setOpen(false) }}
                className="w-full text-left px-3.5 py-2 text-xs text-[var(--accent)]/80 hover:bg-[var(--bg-surface)] hover:text-[var(--accent)] transition-colors"
              >
                + Add wallet
              </button>
            </div>

            <div className="border-t border-[var(--border)] py-1">
              <button
                onClick={() => { onExport(); setOpen(false) }}
                className="w-full text-left px-3.5 py-2 text-xs text-[var(--text-2)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-1)] transition-colors"
              >
                Export wallet
              </button>
              <button
                onClick={() => { logout(); setOpen(false) }}
                className="w-full text-left px-3.5 py-2 text-xs text-red-400/80 hover:bg-red-400/5 hover:text-red-400 transition-colors"
              >
                Lock
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add wallet modal */}
      {showSetup && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setShowSetup(false) }}>
          <div className="absolute inset-0" onClick={() => setShowSetup(false)} />
          <WalletSetup onSuccess={handleWalletCreated} isUnlocked onClose={() => setShowSetup(false)} />
        </div>
      )}
    </>
  )
}
