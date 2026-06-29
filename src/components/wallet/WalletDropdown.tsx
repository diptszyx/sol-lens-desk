import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWalletStore } from '../../store/wallet'
import { useWallet } from '../../hooks/useWallet'
import { truncateAddress } from '../../lib/utils'

function useSwitchWallet() {
  const setStage = useWalletStore((s) => s.setStage)
  const setAddress = useWalletStore((s) => s.setAddress)
  return async function switchWallet() {
    await invoke('lock_wallet').catch(() => {})
    setAddress(null)
    setStage('no-wallet')
  }
}

interface Props {
  onExport: () => void
}

export function WalletDropdown({ onExport }: Props) {
  const address = useWalletStore((s) => s.address)
  const { logout } = useWallet()
  const switchWallet = useSwitchWallet()
  const [confirmSwitch, setConfirmSwitch] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!address) return
    invoke<number>('get_sol_balance', { address }).then(setBalance).catch(() => {})
    const id = setInterval(() => {
      invoke<number>('get_sol_balance', { address }).then(setBalance).catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [address])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmSwitch(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function copyAddress() {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
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
        <div className="absolute right-0 top-full mt-1.5 w-60 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg z-50 overflow-hidden">
          {/* Address + copy icon inline */}
          <div className="px-3.5 py-3 border-b border-[var(--border)]">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-mono text-[11px] text-[var(--text-2)] truncate flex-1">
                {address ? truncateAddress(address, 6, 6) : '—'}
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

          {/* Actions */}
          <div className="py-1">
            <button
              onClick={() => { onExport(); setOpen(false) }}
              className="w-full text-left px-3.5 py-2 text-xs text-[var(--text-2)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-1)] transition-colors"
            >
              Export wallet
            </button>
          </div>

          <div className="border-t border-[var(--border)] py-1">
            {confirmSwitch ? (
              <div className="px-3.5 py-2 space-y-2">
                <p className="text-[11px] text-[var(--text-2)]">
                  This device supports 1 wallet. Export first — switching replaces the current wallet.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { void switchWallet(); setOpen(false) }}
                    className="flex-1 py-1 rounded text-[11px] font-semibold bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20 transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmSwitch(false)}
                    className="flex-1 py-1 rounded text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] border border-[var(--border)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmSwitch(true)}
                className="w-full text-left px-3.5 py-2 text-xs text-[var(--text-2)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-1)] transition-colors"
              >
                Switch wallet
              </button>
            )}
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
  )
}
