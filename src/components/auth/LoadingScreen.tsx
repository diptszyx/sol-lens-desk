export function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-deep)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute rounded-full"
          style={{ width: 400, height: 400, background: 'radial-gradient(circle, rgba(153,69,255,0.06) 0%, transparent 65%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
        />
      </div>
      <div className="relative flex flex-col items-center gap-4">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center animate-pulse"
          style={{ background: 'linear-gradient(135deg, rgba(153,69,255,0.18) 0%, rgba(0,255,136,0.12) 100%)', border: '1px solid var(--border)' }}
        >
          <span className="text-xl" style={{ color: 'var(--accent)' }}>◎</span>
        </div>
        <p className="text-xs text-[var(--text-3)]">Loading…</p>
      </div>
    </div>
  )
}
