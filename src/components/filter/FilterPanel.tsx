import { useRef, useState, useEffect } from 'react'
import { useFilterStore } from '../../store/filter'
import { useTokenFeedStore } from '../../store/tokenFeed'
import { DEFAULT_FILTER, MAX_AGE_SEC, SCORE_PRESETS } from '../../types'
import type { FilterConfig } from '../../types'

const PRESET_CONFIGS: Record<keyof typeof SCORE_PRESETS, FilterConfig> = {
  degen: { ...DEFAULT_FILTER, minScoreThreshold: SCORE_PRESETS.degen.threshold },
  balanced: { ...DEFAULT_FILTER, minScoreThreshold: SCORE_PRESETS.balanced.threshold },
  safe: { ...DEFAULT_FILTER, minScoreThreshold: SCORE_PRESETS.safe.threshold },
}

const DEBOUNCE_MS = 400

interface NumFieldProps {
  label: string
  unit?: string
  value: number | null
  onChange: (v: number | null) => void
  max?: number
}

function NumField({ label, unit, value, onChange, placeholder = '∞', max }: NumFieldProps & { placeholder?: string }) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    return () => flush()
  }, [])

  useEffect(() => {
    setLocal(value != null ? String(value) : '')
  }, [value])

  const apply = (raw: string) => {
    if (raw === '') {
      onChange(null)
    } else {
      const n = Number(raw)
      if (!isNaN(n)) {
        onChange(max != null && n > max ? max : n)
      }
    }
  }

  const handleChange = (raw: string) => {
    setLocal(raw)
    flush()
    if (raw !== '') {
      timerRef.current = setTimeout(() => apply(raw), DEBOUNCE_MS)
    }
  }

  const handleBlur = () => {
    flush()
    if (local !== '') {
      apply(local)
    }
  }

  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-[var(--text-2)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={local}
          placeholder={placeholder}
          max={max}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          className="w-20 rounded bg-[var(--bg-deep)] border border-[var(--border)] px-2 py-1 text-right font-mono text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:border-[var(--accent)] outline-none"
        />
        {unit && <span className="text-[10px] text-[var(--text-3)] w-7">{unit}</span>}
      </span>
    </label>
  )
}

export function FilterPanel({ onClose }: { onClose: () => void }) {
  const filter = useFilterStore((s) => s.filter)
  const activePreset = useFilterStore((s) => s.activePreset)
  const applyPreset = useFilterStore((s) => s.applyPreset)
  const set = useFilterStore((s) => s.set)
  const clearTokens = useTokenFeedStore((s) => s.clearTokens)

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
            onClick={() => {
              clearTokens()
              applyPreset(key as keyof typeof SCORE_PRESETS, PRESET_CONFIGS[key as keyof typeof SCORE_PRESETS])
            }}
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

      <div className="grid gap-2">
        <NumField label={`Max age (≤${MAX_AGE_SEC}s)`} unit="s" value={filter.maxAgeSec} onChange={(v) => set({ maxAgeSec: v })} placeholder="∞" max={MAX_AGE_SEC} />
        <NumField label="Min liquidity" unit="SOL" value={filter.minLiquiditySol} onChange={(v) => set({ minLiquiditySol: v })} placeholder="0 (any)" />
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
