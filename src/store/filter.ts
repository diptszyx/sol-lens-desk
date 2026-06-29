import { create } from 'zustand'
import { DEFAULT_FILTER, MAX_AGE_SEC, SCORE_PRESETS, type FilterConfig } from '../types'

const FILE = 'sol-lens.settings.json'
const KEY = 'filter'

async function tauriStore() {
  const mod = await import('@tauri-apps/plugin-store')
  return mod.load(FILE, { autoSave: false, defaults: {} })
}

async function persist(f: FilterConfig): Promise<void> {
  const s = await tauriStore()
  await s.set(KEY, f)
  await s.save()
}

async function loadSaved(): Promise<FilterConfig | null> {
  try {
    const s = await tauriStore()
    const v = await s.get<FilterConfig>(KEY)
    return v ?? null
  } catch {
    return null
  }
}

interface FilterStore {
  filter: FilterConfig
  hydrated: boolean
  activePreset: keyof typeof SCORE_PRESETS | null
  set: (patch: Partial<FilterConfig>) => void
  applyPreset: (preset: keyof typeof SCORE_PRESETS, config: FilterConfig) => void
  clearPreset: () => void
  reset: () => void
  hydrate: () => Promise<void>
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  filter: DEFAULT_FILTER,
  hydrated: false,
  activePreset: null,
  set: (patch) => {
    const next = { ...get().filter, ...patch }
    if (next.maxAgeSec != null && next.maxAgeSec > MAX_AGE_SEC) next.maxAgeSec = MAX_AGE_SEC
    set({ filter: next, activePreset: null })
    void persist(next)
  },
  applyPreset: (preset, config) => {
    const clamped = { ...config }
    if (clamped.maxAgeSec != null && clamped.maxAgeSec > MAX_AGE_SEC) clamped.maxAgeSec = MAX_AGE_SEC
    set({ filter: clamped, activePreset: preset })
    void persist(clamped)
  },
  clearPreset: () => {
    set({ activePreset: null })
  },
  reset: () => {
    set({ filter: DEFAULT_FILTER, activePreset: null })
    void persist(DEFAULT_FILTER)
  },
  hydrate: async () => {
    const saved = await loadSaved()
    const merged = saved ? { ...DEFAULT_FILTER, ...saved } : DEFAULT_FILTER
    if (merged.maxAgeSec != null && merged.maxAgeSec > MAX_AGE_SEC) merged.maxAgeSec = MAX_AGE_SEC
    const entries = Object.entries(SCORE_PRESETS) as [keyof typeof SCORE_PRESETS, { threshold: number }][]
    const [matchedPreset, matchedConfig] = entries
      .reduce((best, cur) =>
        Math.abs(cur[1].threshold - merged.minScoreThreshold) < Math.abs(best[1].threshold - merged.minScoreThreshold)
          ? cur : best
      )
    merged.minScoreThreshold = matchedConfig.threshold
    set({ filter: merged, hydrated: true, activePreset: matchedPreset })
  },
}))
