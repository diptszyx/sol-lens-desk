import { create } from 'zustand'
import { DEFAULT_FILTER, SCORE_PRESETS, type FilterConfig } from '../types'

const FILE = 'sol-lens.settings.json'
const KEY = 'filter'

async function tauriStore() {
  const mod = await import('@tauri-apps/plugin-store')
  return mod.load(FILE, { autoSave: false, defaults: {} })
}

async function persist(f: FilterConfig): Promise<void> {
  try {
    const s = await tauriStore()
    await s.set(KEY, f)
    await s.save()
    return
  } catch {
    /* not in Tauri — fall through */
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(f))
  } catch {
    /* ignore */
  }
}

async function loadSaved(): Promise<FilterConfig | null> {
  try {
    const s = await tauriStore()
    const v = await s.get<FilterConfig>(KEY)
    if (v) return v
  } catch {
    /* fall through */
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as FilterConfig
  } catch {
    /* ignore */
  }
  return null
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
    set({ filter: next, activePreset: null })
    void persist(next)
  },
  applyPreset: (preset, config) => {
    set({ filter: config, activePreset: preset })
    void persist(config)
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
    set({ filter: merged, hydrated: true })
  },
}))
