import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { usePortfolioStore } from './portfolio'
import { useFilterStore } from './filter'
import { matchesFilter } from '../lib/filter'
import { DEFAULT_SL_PCT } from '../types'
import type { DetectedToken } from '../types'

export type PetEmotion =
  | 'idle'
  | 'alert'
  | 'invested'
  | 'pumping'
  | 'watching'
  | 'shrug'
  | 'celebration'

interface PetStore {
  emotion: PetEmotion
  prevEmotion: PetEmotion
  xp: number
  level: number
  totalTokensSeen: number
  totalTrades: number

  setEmotion: (e: PetEmotion) => void
  restorePrev: () => void
  addXp: (amount: number) => void
  incrementTokensSeen: () => void
  incrementTrades: () => void
  loadFromDb: () => Promise<void>
}

const LEVEL_T2 = 2000
const LEVEL_T1 = 500

function calcLevel(xp: number): number {
  if (xp >= LEVEL_T2) return 3
  if (xp >= LEVEL_T1) return 2
  return 1
}

export const usePetStore = create<PetStore>((set, get) => ({
  emotion: 'idle',
  prevEmotion: 'idle',
  xp: 0,
  level: 1,
  totalTokensSeen: 0,
  totalTrades: 0,

  setEmotion: (emotion) =>
    set((state) => ({
      emotion,
      prevEmotion:
        state.emotion !== 'shrug' && state.emotion !== 'celebration'
          ? state.emotion
          : state.prevEmotion,
    })),

  restorePrev: () =>
    set((state) => ({
      emotion: state.prevEmotion,
    })),

  addXp: async (amount) => {
    const { xp, level } = get()
    const newXp = xp + amount
    const newLevel = calcLevel(newXp)
    set({ xp: newXp, level: newLevel })
    if (newLevel > level) {
      window.dispatchEvent(new CustomEvent('pet_level_up', { detail: { level: newLevel } }))
    }
    try {
      await invoke('update_pet_xp', { xpDelta: amount, tokensDelta: 0, tradesDelta: 0 })
    } catch { /* ignore */ }
  },

  incrementTokensSeen: async () => {
    set((state) => ({ totalTokensSeen: state.totalTokensSeen + 1 }))
    try {
      await invoke('update_pet_xp', { xpDelta: 0, tokensDelta: 1, tradesDelta: 0 })
    } catch { /* ignore */ }
  },

  incrementTrades: async () => {
    set((state) => ({ totalTrades: state.totalTrades + 1 }))
    try {
      await invoke('update_pet_xp', { xpDelta: 0, tokensDelta: 0, tradesDelta: 1 })
    } catch { /* ignore */ }
  },

  loadFromDb: async () => {
    try {
      const state = await invoke<{
        xp: number
        level: number
        total_tokens_seen: number
        total_trades: number
      }>('get_pet_state')
      set({
        xp: state.xp,
        level: state.level,
        totalTokensSeen: state.total_tokens_seen,
        totalTrades: state.total_trades,
      })
    } catch { /* ignore */ }
  },
}))

let petEventWired = false

export function setupPetEventListeners() {
  if (petEventWired) return
  petEventWired = true

  listen<DetectedToken>('token_detected', (event) => {
    const filter = useFilterStore.getState().filter
    if (!matchesFilter(event.payload, filter)) return

    const store = usePetStore.getState()
    store.setEmotion('alert')
    store.incrementTokensSeen()
    store.addXp(1)
    setTimeout(() => store.restorePrev(), 10_000)
  })

  listen('buy_confirmed', () => {
    const store = usePetStore.getState()
    store.setEmotion('invested')
    store.incrementTrades()
    store.addXp(10)
  })

  listen<{ mint: string; price_usd: number }>('price_updated', () => {
    const store = usePetStore.getState()
    // Don't interrupt transient celebratory/loss states; their timers restore.
    if (store.emotion === 'shrug' || store.emotion === 'celebration') return

    const positions = usePortfolioStore.getState().positions
    if (positions.length === 0) return

    // Worst-case priority across all positions: watching > invested > pumping.
    let nearSl = false
    let allPumping = true
    for (const p of positions) {
      const price = p.current_price_usd
      if (price == null) {
        allPumping = false
        continue
      }
      const pnlPct = ((price - p.entry_price_usd) / p.entry_price_usd) * 100
      const slPct = p.stop_loss_pct ?? DEFAULT_SL_PCT
      const slThreshold = p.entry_price_usd * (1 - slPct / 100)
      if (price <= slThreshold * 1.1) nearSl = true
      if (pnlPct <= 20) allPumping = false
    }

    if (nearSl) store.setEmotion('watching')
    else if (allPumping) store.setEmotion('pumping')
    else store.setEmotion('invested')
  })

  listen<{ realized_pnl_pct: number }>('position_closed', (e) => {
    const store = usePetStore.getState()
    const emotion = e.payload.realized_pnl_pct > 0 ? 'celebration' : 'shrug'
    store.setEmotion(emotion)
    store.incrementTrades()
    store.addXp(10)
    const duration = emotion === 'celebration' ? 5000 : 3000
    setTimeout(() => store.restorePrev(), duration)
  })
}
