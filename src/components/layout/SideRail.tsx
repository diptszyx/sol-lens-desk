export type ActiveSurface = 'trading' | 'portfolio' | 'pet'

interface Props {
  activeSurface: ActiveSurface
  onSwitch: (surface: ActiveSurface) => void
}

export function SideRail({ activeSurface, onSwitch }: Props) {
  return (
    <nav className="w-11 flex-shrink-0 border-r border-[var(--border)] bg-[var(--bg-deep)] flex flex-col items-center pt-3 pb-4 gap-1">
      <div
        className="mb-4 flex items-center justify-center select-none"
        style={{ color: 'var(--accent)', filter: 'drop-shadow(0 0 8px var(--glow-purple))', fontSize: '17px' }}
      >
        ◎
      </div>

      <RailButton active={activeSurface === 'trading'} label="Trade" onClick={() => onSwitch('trading')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      </RailButton>

      <RailButton active={activeSurface === 'portfolio'} label="Portfolio" onClick={() => onSwitch('portfolio')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <line x1="12" y1="12" x2="12" y2="16" />
          <line x1="10" y1="14" x2="14" y2="14" />
        </svg>
      </RailButton>

      <RailButton active={activeSurface === 'pet'} label="Pet" onClick={() => onSwitch('pet')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <ellipse cx="7" cy="5" rx="2" ry="3" />
          <ellipse cx="17" cy="5" rx="2" ry="3" />
          <ellipse cx="4" cy="11" rx="1.8" ry="2.6" />
          <ellipse cx="20" cy="11" rx="1.8" ry="2.6" />
          <path d="M12 9c-3.5 0-7 2-7 5.5 0 2.5 2 4.5 4 4.5.8 0 1.5-.3 2-.6.3-.2.7-.4 1-.4s.7.2 1 .4c.5.3 1.2.6 2 .6 2 0 4-2 4-4.5C19 11 15.5 9 12 9z" />
        </svg>
      </RailButton>
    </nav>
  )
}

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
        active
          ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-surface)]'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[var(--accent)] rounded-r" />
      )}
      {children}
    </button>
  )
}
