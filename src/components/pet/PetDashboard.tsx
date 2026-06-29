import { usePetStore } from '../../store/pet'
import { CapybaraSvg } from '../notifications/CapybaraSvg'

const LEVEL_THRESHOLDS = [0, 500, 2000]
const LEVEL_NAMES = ['', 'Rookie', 'Veteran', 'Legend']

function xpForLevel(level: number): { current: number; max: number } {
  if (level === 1) return { current: 0, max: 500 }
  if (level === 2) return { current: 500, max: 2000 }
  return { current: 2000, max: 2000 }
}

// Placeholder pet card — replace with real art later
function PetPlaceholder({ index, active }: { index: number; active: boolean }) {
  const colors = ['#9945FF', '#00ff88', '#f59e0b']
  const color = colors[index % colors.length]
  const labels = ['Mechanic', 'Mechanic', 'Mechanic']

  return (
    <div
      className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
          : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]'
      }`}
    >
      {active && (
        <span className="absolute top-1.5 right-1.5 text-[9px] font-bold text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded uppercase tracking-widest">
          Active
        </span>
      )}
      <div
        className="w-20 h-20 rounded-lg flex items-center justify-center"
        style={{ background: `${color}18`, border: `1px solid ${color}40` }}
      >
        <CapybaraSvg size={56} emotion="idle" />
      </div>
      <div className="text-center">
        <p className="text-[11px] font-semibold text-[var(--text-1)]">{labels[index]}</p>
        <p className="text-[10px] text-[var(--text-3)]">#{index + 1}</p>
      </div>
    </div>
  )
}

const ACCESSORIES = [
  { label: 'Hat', options: ['None', 'Cap', 'Helmet', 'Crown'] },
  { label: 'Outfit', options: ['None', 'Mechanic', 'Suit', 'Hoodie'] },
  { label: 'Badge', options: ['None', 'Bronze', 'Silver', 'Gold'] },
]

export function PetDashboard() {
  const { xp, level, totalTokensSeen, totalTrades } = usePetStore()
  const { current, max } = xpForLevel(level)
  const xpInLevel = xp - current
  const xpNeeded = max - current
  const progress = level >= 3 ? 100 : Math.min(100, Math.round((xpInLevel / xpNeeded) * 100))

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header: level + XP */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-bold text-[var(--text-1)] tracking-wide">Pet System</h2>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {totalTokensSeen} tokens seen · {totalTrades} trades
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest">
            Lv.{level} {LEVEL_NAMES[level]}
          </span>
          <div className="flex flex-col gap-1 items-end">
            <div className="w-40 h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, background: 'var(--accent)' }}
              />
            </div>
            <span className="text-[9px] text-[var(--text-3)] font-mono">
              {level >= 3 ? 'MAX' : `${xpInLevel} / ${xpNeeded} XP`}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-6">
        {/* Left: pet collection */}
        <div>
          <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-3">
            My Pets (3)
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <PetPlaceholder key={i} index={i} active={i === 0} />
            ))}
          </div>

          <p className="text-[10px] text-[var(--text-3)] mt-4">
            Earn new pets by leveling up. Real art coming soon.
          </p>
        </div>

        {/* Right: accessories */}
        <div>
          <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-3">
            Accessories
          </p>
          <div className="flex flex-col gap-3">
            {ACCESSORIES.map(({ label, options }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-2)]">{label}</span>
                <select
                  className="bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-1)] text-xs rounded px-2 py-1 outline-none focus:border-[var(--border-strong)] cursor-pointer"
                  defaultValue={options[0]}
                >
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            <button
              className="mt-3 w-full py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: 'var(--accent)',
                color: '#000',
              }}
            >
              Equip to Active Pet
            </button>
          </div>

          {/* Stats mini */}
          <div className="mt-6 border-t border-[var(--border)] pt-4 flex flex-col gap-2">
            <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-1">
              Stats
            </p>
            <StatRow label="Total XP" value={xp.toString()} />
            <StatRow label="Level" value={`${level} / 3`} />
            <StatRow label="Tokens seen" value={totalTokensSeen.toString()} />
            <StatRow label="Trades made" value={totalTrades.toString()} />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-[var(--text-3)]">{label}</span>
      <span className="text-[11px] font-mono text-[var(--text-1)]">{value}</span>
    </div>
  )
}
