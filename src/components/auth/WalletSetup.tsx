import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  onSuccess: (address: string) => void
}

type Tab = 'create' | 'import'
type Stage = 'form' | 'mnemonic'

export function WalletSetup({ onSuccess }: Props) {
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

  async function handleCreate() {
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true); setError(null)
    try {
      const result = await invoke<{ address: string; mnemonic: string }>('create_wallet', { password })
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
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true); setError(null)
    try {
      const address = await invoke<string>('import_wallet', { secret: secret.trim(), password })
      onSuccess(address)
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
      <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)]">
        <div
          style={{
            position: 'absolute', width: 480, height: 480, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(200,241,53,0.05) 0%, transparent 70%)',
            top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
          }}
        />
        <div className="relative w-full max-w-sm px-4">
          <div className="flex flex-col items-center gap-2 mb-6">
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] flex items-center justify-center">
              <span className="text-2xl">🔑</span>
            </div>
            <h1 className="text-xl font-bold text-[var(--text-1)]">Save your seed phrase</h1>
            <p className="text-xs text-[var(--text-3)] text-center">
              Write these 12 words down. They're the only way to recover your wallet.
            </p>
          </div>

          <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] p-4 mb-4">
            <div className="grid grid-cols-3 gap-2">
              {words.map((word, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-deep)] px-2 py-1.5">
                  <span className="text-[10px] text-[var(--text-3)] w-4 text-right select-none">{i + 1}</span>
                  <span className="text-xs font-mono font-semibold text-[var(--text-1)]">{word}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={copyMnemonic}
            className="w-full mb-3 rounded-lg border border-[var(--border)] py-2 text-xs text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)] transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy to clipboard'}
          </button>

          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400 mb-4">
            ⚠ Never share this phrase. Anyone with it controls your funds.
          </div>

          <button
            onClick={() => onSuccess(pendingAddress)}
            className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-bold text-black hover:opacity-90 transition-all"
          >
            I've saved it — Enter Sol Lens
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)]">
      <div
        style={{
          position: 'absolute', width: 480, height: 480, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(200,241,53,0.05) 0%, transparent 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
        }}
      />
      <div className="relative w-full max-w-sm px-4">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] flex items-center justify-center">
            <span className="text-2xl text-[var(--accent)]">◎</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-1)]">Sol Lens</h1>
          <p className="text-xs text-[var(--text-3)]">Set up your wallet to get started</p>
        </div>

        <div className="flex rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] p-1 mb-5">
          {(['create', 'import'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null) }}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                tab === t
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-1)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
              }`}
            >
              {t === 'create' ? 'Create wallet' : 'Import wallet'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {tab === 'import' && (
            <div>
              <label className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-1 block">
                Seed Phrase or Private Key
              </label>
              <textarea
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="12-word seed phrase, or base58 private key…"
                rows={3}
                className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-xs font-mono text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-strong)] resize-none"
              />
              <p className="text-[10px] text-[var(--text-3)] mt-1">
                12-word BIP39 phrase, or 64-byte keypair / 32-byte seed in base58
              </p>
            </div>
          )}

          <div>
            <label className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-1 block">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-1 block">
              Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleImport())}
              placeholder="Re-enter password"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={tab === 'create' ? handleCreate : handleImport}
            disabled={loading}
            className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-bold text-black transition-all hover:opacity-90 disabled:opacity-50 mt-1"
          >
            {loading ? 'Working…' : tab === 'create' ? 'Create wallet' : 'Import wallet'}
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-3)] text-center mt-4">
          Key encrypted with AES-256-GCM and stored locally. Never sent anywhere.
        </p>
      </div>
    </div>
  )
}
