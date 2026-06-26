import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  onSuccess: (address: string) => void
}

type Tab = 'create' | 'import'

export function WalletSetup({ onSuccess }: Props) {
  const [tab, setTab] = useState<Tab>('create')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true); setError(null)
    try {
      const address = await invoke<string>('create_wallet', { password })
      onSuccess(address)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!privateKey.trim()) { setError('Enter your private key'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true); setError(null)
    try {
      const address = await invoke<string>('import_wallet', {
        privateKey: privateKey.trim(),
        password,
      })
      onSuccess(address)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
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
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] flex items-center justify-center">
            <span className="text-2xl text-[var(--accent)]">◎</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-1)]">Sol Lens</h1>
          <p className="text-xs text-[var(--text-3)]">Set up your wallet to get started</p>
        </div>

        {/* Tab switcher */}
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
                Private Key (base58)
              </label>
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Paste your base58-encoded private key…"
                rows={3}
                className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-xs font-mono text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-strong)] resize-none"
              />
              <p className="text-[10px] text-[var(--text-3)] mt-1">
                64-byte keypair from Phantom/Solflare, or 32-byte seed
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
