import { create } from 'zustand'
import { DEFAULT_FILTER, type FilterConfig } from '../types'

const FILE = 'sol-lens.settings.json'
const KEY = 'filter'

async function tauriStore() {
  const mod = await import('@tauri-apps/plugin-store')
  return mod.load(FILE, { autoSave: false, defaults: {} })
}

// Persist to the Tauri store (real desktop), falling back to localStorage in a
// plain browser (smoke tests / dev) so the feature degrades gracefully.
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
  set: (patch: Partial<FilterConfig>) => void
  apply: (f: FilterConfig) => void
  reset: () => void
  hydrate: () => Promise<void>
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  filter: DEFAULT_FILTER,
  hydrated: false,
  set: (patch) => {
    const next = { ...get().filter, ...patch }
    set({ filter: next })
    void persist(next)
  },
  apply: (f) => {
    set({ filter: f })
    void persist(f)
  },
  reset: () => {
    set({ filter: DEFAULT_FILTER })
    void persist(DEFAULT_FILTER)
  },
  hydrate: async () => {
    const saved = await loadSaved()
    // Merge over defaults so configs saved by older versions stay valid.
    set({ filter: saved ? { ...DEFAULT_FILTER, ...saved } : DEFAULT_FILTER, hydrated: true })
  },
}))
