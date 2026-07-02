import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { WalletInfo } from '../../store/wallet'

interface Props {
  onSuccess: (address: string, wallets?: WalletInfo[]) => void
  isUnlocked?: boolean
  onClose?: () => void
}

type Tab = 'create' | 'import'
type Stage = 'form' | 'mnemonic'

export function WalletSetup({ onSuccess, isUnlocked, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('create')
  const [stage, setStage] = useState<Stage>('form')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [secret, setSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [pendingAddress, setPendingAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const needsPassword = !isUnlocked

  async function handleCreate() {
    if (needsPassword) {
      if (password.length < 6) { setError('Password must be at least 6 characters'); return }
      if (password !== confirm) { setError('Passwords do not match'); return }
    }
    setLoading(true); setError(null)
    try {
      const result = await invoke<{ address: string; mnemonic: string; wallets: WalletInfo[] }>('create_wallet', {
        password: needsPassword ? password : null,
      })
      setMnemonic(result.mnemonic)
      setPendingAddress(result.address)
      setStage('mnemonic')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!secret.trim()) { setError('Enter your private key or seed phrase'); return }
    if (needsPassword) {
      if (password.length < 6) { setError('Password must be at least 6 characters'); return }
      if (password !== confirm) { setError('Passwords do not match'); return }
    }
    setLoading(true); setError(null)
    try {
      const result = await invoke<{ address: string; wallets: WalletInfo[] }>('import_wallet', {
        secret: secret.trim(),
        password: needsPassword ? password : null,
      })
      onSuccess(result.address, result.wallets)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function copyMnemonic() {
    if (!mnemonic) return
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (stage === 'mnemonic' && mnemonic && pendingAddress) {
    const words = mnemonic.split(' ')
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)] overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute rounded-full"
            style={{ width: 560, height: 560, background: 'radial-gradient(circle, rgba(153,69,255,0.08) 0%, transparent 65%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: 320, height: 320, background: 'radial-gradient(circle, rgba(0,255,136,0.06) 0%, transparent 65%)', top: '62%', left: '48%', transform: 'translate(-50%,-50%)' }}
          />
        </div>

        <div className="relative w-full max-w-md px-4 animate-fadeIn">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(153,69,255,0.18) 0%, rgba(0,255,136,0.12) 100%)', border: '1px solid var(--border)' }}
            >
              <span className="text-2xl">🔑</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-1)] tracking-tight">Your recovery phrase</h1>
            <p className="text-xs text-[var(--text-2)] text-center max-w-xs leading-relaxed">
              Write these words in order on paper. <span className="text-[var(--text-2)]">Don't screenshot.</span>{' '}
              This is the only way to recover your wallet.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 mb-4">
            <div className="grid grid-cols-4 gap-x-3 gap-y-2.5">
              {words.map((word, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg bg-[var(--bg-deep)] border border-[var(--border)] px-2.5 py-2 transition-colors hover:border-[var(--border-strong)]"
                >
                  <span className="text-[10px] font-mono text-[var(--text-2)] w-4 text-right select-none">{i + 1}</span>
                  <span className="text-sm font-mono font-semibold text-[var(--text-1)]">{word}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={copyMnemonic}
            className="w-full mb-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] py-2.5 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-all"
          >
            {copied ? '✓ Copied to clipboard' : '📋 Copy to clipboard'}
          </button>

          <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 px-4 py-3 text-xs text-amber-400/90 mb-6 flex items-start gap-2.5">
            <span className="text-sm flex-shrink-0 mt-px">⚠</span>
            <span>Never share this phrase with anyone. Anyone with these words can access your funds.</span>
          </div>

          <button
            onClick={() => onSuccess(pendingAddress)}
            className="w-full rounded-xl py-3.5 text-sm font-bold text-black transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'var(--brand-gradient)' }}
          >
            I've saved it securely — Enter Sol Lens
          </button>
        </div>

        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .animate-fadeIn { animation: fadeIn 400ms ease-out; }
        `}</style>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute rounded-full"
          style={{ width: 560, height: 560, background: 'radial-gradient(circle, rgba(153,69,255,0.08) 0%, transparent 65%)', top: '38%', left: '52%', transform: 'translate(-50%,-50%)' }}
        />
        <div
          className="absolute rounded-full"
          style={{ width: 320, height: 320, background: 'radial-gradient(circle, rgba(0,255,136,0.06) 0%, transparent 65%)', top: '60%', left: '40%', transform: 'translate(-50%,-50%)' }}
        />
      </div>

      <div className="relative w-full max-w-sm px-4 animate-fadeIn">
        <div className="flex items-center justify-between mb-8">
          <div className="flex flex-col items-start gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(153,69,255,0.18) 0%, rgba(0,255,136,0.12) 100%)', border: '1px solid var(--border)' }}
            >
              <span className="text-2xl" style={{ color: 'var(--accent)' }}>◎</span>
            </div>
            <div>
              <h1
                className="text-2xl font-bold tracking-tight"
                style={{ backgroundImage: 'var(--brand-gradient)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
              >
                Sol Lens
              </h1>
              <p className="text-xs text-[var(--text-3)] mt-1">
                {isUnlocked ? 'Add a wallet to your vault' : 'Set up your wallet to get started'}
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-1.5 mb-5">
          <div className="relative flex">
            <div
              className="absolute top-0 h-full rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] transition-all duration-200 ease-out"
              style={{ width: 'calc(50% - 3px)', left: tab === 'create' ? '3px' : 'calc(50%)', transitionProperty: 'left' }}
            />
            {(['create', 'import'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null) }}
                className="relative flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors z-10"
                style={{ color: tab === t ? 'var(--text-1)' : 'var(--text-3)' }}
              >
                <span className="text-sm">{t === 'create' ? '✦' : '↗'}</span>
                {t === 'create' ? 'Create' : 'Import'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {tab === 'import' && (
            <div>
              <label className="text-[11px] font-semibold text-[var(--text-2)] uppercase tracking-widest mb-1.5 block">
                Seed phrase or private key
              </label>
              <div className="relative">
                <span className="absolute left-3 top-3 text-xs text-[var(--text-2)] select-none">🔑</span>
                <textarea
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="12-word seed phrase, or base58 private key…"
                  rows={3}
                  className="w-full rounded-xl bg-[var(--bg-deep)] border border-[var(--border)] pl-9 pr-3 py-2.5 text-xs font-mono text-[var(--text-1)] placeholder:text-[var(--text-2)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20 resize-none transition-all"
                />
              </div>
              <p className="text-[10px] text-[var(--text-3)] mt-1.5 ml-1">
                12-word BIP39 phrase, or 64-byte keypair / 32-byte seed in base58
              </p>
            </div>
          )}

          {needsPassword && (
            <>
              <div>
                <label className="text-[11px] font-semibold text-[var(--text-2)] uppercase tracking-widest mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-2)] select-none">🔒</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full rounded-xl bg-[var(--bg-deep)] border border-[var(--border)] pl-9 pr-3 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-2)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20 transition-all"
                  />
                </div>
                {password.length > 0 && password.length < 6 && (
                  <p className="text-[10px] text-amber-400 mt-1 ml-1">At least 6 characters required</p>
                )}
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--text-2)] uppercase tracking-widest mb-1.5 block">
                  Confirm password
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-2)] select-none">✓</span>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleImport())}
                    placeholder="Re-enter your password"
                    className="w-full rounded-xl bg-[var(--bg-deep)] border border-[var(--border)] pl-9 pr-3 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-2)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20 transition-all"
                  />
                </div>
                {confirm.length > 0 && password !== confirm && (
                  <p className="text-[10px] text-red-400 mt-1 ml-1">Passwords don't match</p>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="rounded-xl bg-red-500/5 border border-red-500/15 px-4 py-3 text-xs text-red-400 flex items-start gap-2.5">
              <span className="text-sm flex-shrink-0 mt-px">!</span>
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={tab === 'create' ? handleCreate : handleImport}
            disabled={loading}
            className="w-full rounded-xl py-3.5 text-sm font-bold text-black transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            style={{ background: 'var(--brand-gradient)' }}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                Creating…
              </span>
            ) : tab === 'create' ? (
              'Create wallet'
            ) : (
              'Import wallet'
            )}
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-3)] text-center mt-5 leading-relaxed">
          Encrypted with AES-256-GCM · Stored locally · Never sent anywhere
        </p>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 400ms ease-out; }
      `}</style>
    </div>
  )
}
