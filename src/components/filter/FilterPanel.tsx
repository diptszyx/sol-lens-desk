import { useFilterStore } from '../../store/filter'
import { SNIPER_PRESET, DEFAULT_FILTER, type FilterConfig } from '../../types'

interface NumFieldProps {
  label: string
  unit?: string
  value: number | null
  onChange: (v: number | null) => void
}

function NumField({ label, unit, value, onChange }: NumFieldProps) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-[var(--text-2)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value ?? ''}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-20 rounded bg-[var(--bg-deep)] border border-[var(--border)] px-2 py-1 text-right font-mono text-[var(--text-1)] focus:border-[var(--accent)] outline-none"
        />
        {unit && <span className="text-[10px] text-[var(--text-3)] w-7">{unit}</span>}
      </span>
    </label>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
      <span className="text-[var(--text-2)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-4 w-7 rounded-full transition-colors ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-deep)] border border-[var(--border)]'}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-deep)] transition-transform ${checked ? 'translate-x-3.5 bg-black' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  )
}

export function FilterPanel({ onClose }: { onClose: () => void }) {
  const filter = useFilterStore((s) => s.filter)
  const set = useFilterStore((s) => s.set)
  const apply = useFilterStore((s) => s.apply)

  const pumpOnly = filter.sources?.includes('pump_fun') ?? false
  const isPreset = (p: FilterConfig) => JSON.stringify(p) === JSON.stringify(filter)

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
          Filters
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => apply(SNIPER_PRESET)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${isPreset(SNIPER_PRESET) ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
          >
            Sniper
          </button>
          <button
            onClick={() => apply(DEFAULT_FILTER)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${isPreset(DEFAULT_FILTER) ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
          >
            All
          </button>
          <button
            onClick={onClose}
            className="ml-1 text-xs text-[var(--text-3)] hover:text-[var(--text-1)] w-5 h-5 flex items-center justify-center"
            aria-label="Close filters"
          >
            ×
          </button>
        </div>
      </div>

      <input
        type="text"
        value={filter.search}
        placeholder="Search symbol / name / mint…"
        onChange={(e) => set({ search: e.target.value })}
        className="w-full rounded bg-[var(--bg-deep)] border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--text-1)] focus:border-[var(--accent)] outline-none"
      />

      <div className="grid gap-2">
        <NumField label="Max age" unit="s" value={filter.maxAgeSec} onChange={(v) => set({ maxAgeSec: v })} />
        <NumField label="Min liquidity" unit="SOL" value={filter.minLiquiditySol} onChange={(v) => set({ minLiquiditySol: v })} />
        <NumField label="Max mcap" unit="$" value={filter.maxMcapUsd} onChange={(v) => set({ maxMcapUsd: v })} />
        <NumField label="Max dev hold" unit="%" value={filter.maxDevHoldPct} onChange={(v) => set({ maxDevHoldPct: v })} />
        <NumField label="Min dev buy" unit="SOL" value={filter.minDevBuySol} onChange={(v) => set({ minDevBuySol: v })} />
        <NumField label="Min curve" unit="%" value={filter.minBondingCurvePct} onChange={(v) => set({ minBondingCurvePct: v })} />
      </div>

      <div className="grid gap-2 pt-1 border-t border-[var(--border)]">
        <Toggle label="Require socials" checked={filter.requireSocials} onChange={(v) => set({ requireSocials: v })} />
        <Toggle label="Hide unnamed / ?" checked={filter.hideUnnamed} onChange={(v) => set({ hideUnnamed: v })} />
        <Toggle label="pump.fun only" checked={pumpOnly} onChange={(v) => set({ sources: v ? ['pump_fun'] : null })} />
      </div>
    </div>
  )
}
