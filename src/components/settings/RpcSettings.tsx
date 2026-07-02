import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type TestState = { tag: 'idle' } | { tag: 'testing' } | { tag: 'ok'; latencyMs: number } | { tag: 'error'; message: string }

export function RpcSettings() {
  const [url, setUrl] = useState('')
  const [maskedUrl, setMaskedUrl] = useState('')
  const [test, setTest] = useState<TestState>({ tag: 'idle' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    invoke<string>('get_rpc_url').then((masked) => {
      setMaskedUrl(masked)
    }).catch(console.error)
  }, [])

  async function handleTest() {
    setTest({ tag: 'testing' })
    setSaved(false)
    try {
      const latencyMs = await invoke<number>('test_rpc_connection', { url })
      setTest({ tag: 'ok', latencyMs })
    } catch (err) {
      setTest({ tag: 'error', message: String(err) })
    }
  }

  async function handleSave() {
    try {
      await invoke('set_rpc_url', { url })
      setSaved(true)
      setTest({ tag: 'idle' })
      setMaskedUrl(url.replace(/([?&]api-key=)([^&]{4})[^&]*/, '$1$2***'))
      setUrl('')
    } catch (err) {
      setTest({ tag: 'error', message: String(err) })
    }
  }

  async function handleReset() {
    try {
      await invoke('set_rpc_url', { url: '' })
    } catch { /* ignore */ }
    setUrl('')
    setSaved(true)
    setTest({ tag: 'idle' })
    invoke<string>('get_rpc_url').then(setMaskedUrl).catch(console.error)
  }

  const testStyle = test.tag === 'ok'
    ? 'text-green-400'
    : test.tag === 'error'
      ? 'text-red-400'
      : test.tag === 'testing'
        ? 'text-yellow-400'
        : 'text-[var(--text-3)]'

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-3)]">
          RPC Endpoint
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Current URL display (masked) */}
        {maskedUrl && (
          <div className="text-[10px] text-[var(--text-3)] leading-relaxed break-all">
            <span className="uppercase tracking-wider text-[var(--text-3)]/60">Current: </span>
            <code className="text-[var(--text-2)] font-mono">{maskedUrl}</code>
          </div>
        )}

        {/* Input */}
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); if (test.tag !== 'idle') setTest({ tag: 'idle' }) }}
          placeholder="https://mainnet.helius-rpc.com/?api-key=..."
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-1)] outline-none focus:border-[var(--border-strong)] placeholder:text-[var(--text-3)]/40 transition-colors"
        />

        {/* Status line */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            test.tag === 'ok' ? 'bg-green-400' : test.tag === 'error' ? 'bg-red-400' : test.tag === 'testing' ? 'bg-yellow-400 animate-pulse' : 'bg-[var(--border-strong)]'
          }`} />
          <span className={testStyle}>
            {test.tag === 'testing' && 'Testing…'}
            {test.tag === 'ok' && `Connected (${test.latencyMs}ms)`}
            {test.tag === 'error' && test.message}
            {test.tag === 'idle' && (saved ? 'Saved' : 'Enter URL and test')}
          </span>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={!url || test.tag === 'testing'}
            className="flex-1 px-3 py-2 rounded-lg text-[11px] font-semibold border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)] disabled:opacity-40 transition-colors"
          >
            Test Connection
          </button>
          <button
            onClick={handleSave}
            disabled={!url || test.tag !== 'ok'}
            className="px-4 py-2 rounded-lg text-[11px] font-bold bg-[var(--accent)] text-black hover:opacity-90 disabled:opacity-30 transition-colors"
          >
            Save
          </button>
        </div>

        <button
          onClick={handleReset}
          className="w-full text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] underline underline-offset-2 transition-colors"
        >
          Reset to default
        </button>
      </div>
    </div>
  )
}
