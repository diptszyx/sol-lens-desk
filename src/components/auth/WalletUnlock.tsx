import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  onSuccess: (address: string) => void
}

export function WalletUnlock({ onSuccess }: Props) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleUnlock() {
    if (!password) return
    setLoading(true); setError(null)
    try {
      const address = await invoke<string>('unlock_wallet', { password })
      onSuccess(address)
    } catch (e) {
      setError(String(e))
      setPassword('')
      setTimeout(() => inputRef.current?.focus(), 50)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)]">
      <div
        style={{
          position: 'absolute', width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(200,241,53,0.05) 0%, transparent 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
        }}
      />
      <div className="relative w-full max-w-xs px-4">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] flex items-center justify-center">
            <span className="text-2xl text-[var(--accent)]">◎</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-1)]">Sol Lens</h1>
          <p className="text-xs text-[var(--text-3)]">Enter password to unlock wallet</p>
        </div>

        <div className="space-y-3">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            placeholder="Password"
            autoFocus
            className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-strong)]"
          />

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={handleUnlock}
            disabled={loading || !password}
            className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-bold text-black transition-all hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}
