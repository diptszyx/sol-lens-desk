import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  onClose: () => void
}

type Stage = 'password' | 'keys'

interface ExportResult {
  address: string
  mnemonic: string | null
  private_key_b58: string
}

export function ExportModal({ onClose }: Props) {
  const [stage, setStage] = useState<Stage>('password')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    if (!password) return
    setLoading(true); setError(null)
    try {
      const data = await invoke<ExportResult>('export_wallet', { password })
      setResult(data)
      setStage('keys')
    } catch (e) {
      setError(String(e))
      setPassword('')
      setTimeout(() => inputRef.current?.focus(), 50)
    } finally {
      setLoading(false)
    }
  }

  function copy(text: string, field: string) {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm mx-4 rounded-2xl bg-[var(--bg-base)] border border-[var(--border-strong)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <span className="text-sm font-bold text-[var(--text-1)]">Export Wallet</span>
          <button
            onClick={onClose}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          {stage === 'password' && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-3)]">
                Enter your password to reveal your seed phrase and private key.
              </p>
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExport()}
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
                onClick={handleExport}
                disabled={loading || !password}
                className="w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-bold text-black hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {loading ? 'Decrypting…' : 'Reveal keys'}
              </button>
            </div>
          )}

          {stage === 'keys' && result && (
            <div className="space-y-4">
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                ⚠ Never share these with anyone. Store offline.
              </div>

              {result.mnemonic && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest">
                      Seed Phrase
                    </span>
                    <button
                      onClick={() => copy(result.mnemonic!, 'mnemonic')}
                      className="text-[10px] text-[var(--accent)] hover:opacity-80"
                    >
                      {copiedField === 'mnemonic' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] p-3">
                    <div className="grid grid-cols-3 gap-1.5">
                      {result.mnemonic.split(' ').map((word, i) => (
                        <div key={i} className="flex items-center gap-1 rounded bg-[var(--bg-deep)] px-1.5 py-1">
                          <span className="text-[9px] text-[var(--text-3)] w-3 text-right">{i + 1}</span>
                          <span className="text-[10px] font-mono font-semibold text-[var(--text-1)]">{word}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest">
                    Private Key (base58)
                  </span>
                  <button
                    onClick={() => copy(result.private_key_b58, 'privkey')}
                    className="text-[10px] text-[var(--accent)] hover:opacity-80"
                  >
                    {copiedField === 'privkey' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2">
                  <p className="font-mono text-[10px] text-[var(--text-2)] break-all select-all leading-relaxed">
                    {result.private_key_b58}
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-full rounded-xl border border-[var(--border)] py-2.5 text-sm text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)] transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
