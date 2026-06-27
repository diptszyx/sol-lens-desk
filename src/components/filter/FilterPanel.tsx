import { useFilterStore } from '../../store/filter'
import { DEFAULT_FILTER, SCORE_PRESETS } from '../../types'
import type { FilterConfig } from '../../types'

const PRESET_CONFIGS: Record<keyof typeof SCORE_PRESETS, FilterConfig> = {
  degen: { ...DEFAULT_FILTER, minScoreThreshold: SCORE_PRESETS.degen.threshold },
  balanced: { ...DEFAULT_FILTER, minScoreThreshold: SCORE_PRESETS.balanced.threshold },
  safe: { ...DEFAULT_FILTER, minScoreThreshold: SCORE_PRESETS.safe.threshold },
}

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

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

export function FilterPanel({ onClose }: { onClose: () => void }) {
  const filter = useFilterStore((s) => s.filter)
  const activePreset = useFilterStore((s) => s.activePreset)
  const applyPreset = useFilterStore((s) => s.applyPreset)
  const set = useFilterStore((s) => s.set)

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
          Filters
        </span>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] w-5 h-5 flex items-center justify-center"
          aria-label="Close filters"
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {Object.entries(SCORE_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            onClick={() => applyPreset(key as keyof typeof SCORE_PRESETS, PRESET_CONFIGS[key as keyof typeof SCORE_PRESETS])}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
              activePreset === key
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            {preset.label} · {preset.threshold}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--text-2)] min-w-10">Score</span>
          <input
            type="range"
            min={0}
            max={100}
            value={filter.minScoreThreshold}
            onChange={(e) => set({ minScoreThreshold: Number(e.target.value) })}
            className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--bg-deep)] cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-sm"
            style={{
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${filter.minScoreThreshold}%, var(--bg-deep) ${filter.minScoreThreshold}%, var(--bg-deep) 100%)`,
            }}
          />
          <span className={`text-xs font-bold tabular-nums min-w-[2rem] ${scoreColor(filter.minScoreThreshold)}`}>
            {filter.minScoreThreshold}
          </span>
        </div>
      </div>

      <div className="grid gap-2">
        <NumField label="Max age" unit="s" value={filter.maxAgeSec} onChange={(v) => set({ maxAgeSec: v })} />
        <NumField label="Min liquidity" unit="SOL" value={filter.minLiquiditySol} onChange={(v) => set({ minLiquiditySol: v })} />
      </div>

      <div className="pt-2 border-t border-[var(--border)]">
        <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
          <span className="text-[var(--text-2)]">Hide unnamed / ?</span>
          <button
            type="button"
            role="switch"
            aria-checked={filter.hideUnnamed}
            onClick={() => set({ hideUnnamed: !filter.hideUnnamed })}
            className={`relative h-4 w-7 rounded-full transition-colors ${filter.hideUnnamed ? 'bg-[var(--accent)]' : 'bg-[var(--bg-deep)] border border-[var(--border)]'}`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-[var(--bg-deep)] transition-transform ${filter.hideUnnamed ? 'translate-x-3.5 bg-black' : 'translate-x-0.5'}`}
            />
          </button>
        </label>
      </div>
    </div>
  )
}
