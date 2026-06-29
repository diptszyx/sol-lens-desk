import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  onSuccess: (address: string) => void
  onReset?: () => void
}

export function WalletUnlock({ onSuccess, onReset }: Props) {
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
    <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute rounded-full"
          style={{ width: 520, height: 520, background: 'radial-gradient(circle, rgba(153,69,255,0.08) 0%, transparent 65%)', top: '40%', left: '50%', transform: 'translate(-50%,-50%)' }}
        />
        <div
          className="absolute rounded-full"
          style={{ width: 260, height: 260, background: 'radial-gradient(circle, rgba(0,255,136,0.06) 0%, transparent 65%)', top: '58%', left: '44%', transform: 'translate(-50%,-50%)' }}
        />
      </div>

      <div className="relative w-full max-w-xs px-4 animate-fadeIn">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(153,69,255,0.18) 0%, rgba(0,255,136,0.12) 100%)', border: '1px solid var(--border)' }}
          >
            <span
              className="text-2xl select-none"
              style={{ color: 'var(--accent)', filter: 'drop-shadow(0 0 8px var(--glow-purple))' }}
            >
              ◎
            </span>
          </div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ backgroundImage: 'var(--brand-gradient)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
          >
            Sol Lens
          </h1>
          <p className="text-xs text-[var(--text-2)]">Enter your password to unlock</p>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-2)] select-none">🔒</span>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              placeholder="Password"
              autoFocus
              className={`w-full rounded-xl bg-[var(--bg-surface)] border pl-9 pr-3 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-2)] outline-none transition-all ${
                error ? 'border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500/20' : 'border-[var(--border)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20'
              } ${error ? 'animate-shake' : ''}`}
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/5 border border-red-500/15 px-4 py-3 text-xs text-red-400 flex items-start gap-2.5 animate-fadeIn">
              <span className="text-sm flex-shrink-0 mt-px">!</span>
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleUnlock}
            disabled={loading || !password}
            className="w-full rounded-xl py-3.5 text-sm font-bold text-black transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            style={{ background: 'var(--brand-gradient)' }}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                Unlocking…
              </span>
            ) : (
              'Unlock'
            )}
          </button>

          {onReset && (
            <div className="pt-2">
              <button
                onClick={onReset}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] py-2.5 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)] transition-all"
              >
                Use a different wallet
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%      { transform: translateX(-4px); }
          40%      { transform: translateX(4px); }
          60%      { transform: translateX(-3px); }
          80%      { transform: translateX(2px); }
        }
        .animate-fadeIn { animation: fadeIn 300ms ease-out; }
        .animate-shake   { animation: shake 400ms ease-out; }
      `}</style>
    </div>
  )
}
