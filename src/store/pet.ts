import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen, emitTo } from '@tauri-apps/api/event'
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
  gainTokenXp: () => Promise<void>
  gainBuyXp: () => Promise<void>
  gainCloseXp: () => Promise<void>
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
      // prevEmotion is the "resting" state to fall back to. Transient states —
      // shrug/celebration (post-trade) and alert (new-token flash) — must never
      // become prevEmotion, otherwise a live token feed keeps overwriting it with
      // 'alert' and the pet can never settle back to idle.
      prevEmotion:
        state.emotion !== 'shrug' &&
        state.emotion !== 'celebration' &&
        state.emotion !== 'alert'
          ? state.emotion
          : state.prevEmotion,
    })),

  restorePrev: () =>
    set((state) => ({
      emotion: state.prevEmotion,
    })),

  gainTokenXp: async () => {
    const { xp, level } = get()
    const newXp = xp + 1
    const newLevel = calcLevel(newXp)
    set((state) => ({ xp: newXp, level: newLevel, totalTokensSeen: state.totalTokensSeen + 1 }))
    if (newLevel > level) {
      window.dispatchEvent(new CustomEvent('pet_level_up', { detail: { level: newLevel } }))
    }
    try {
      await invoke('update_pet_xp', { xpDelta: 1, tokensDelta: 1, tradesDelta: 0 })
    } catch (e) {
      console.error('[pet] gainTokenXp failed:', e)
    }
  },

  gainBuyXp: async () => {
    const { xp, level } = get()
    const newXp = xp + 10
    const newLevel = calcLevel(newXp)
    set((state) => ({ xp: newXp, level: newLevel }))
    if (newLevel > level) {
      window.dispatchEvent(new CustomEvent('pet_level_up', { detail: { level: newLevel } }))
    }
    try {
      await invoke('update_pet_xp', { xpDelta: 10, tokensDelta: 0, tradesDelta: 0 })
    } catch (e) {
      console.error('[pet] gainBuyXp failed:', e)
    }
  },

  gainCloseXp: async () => {
    const { xp, level } = get()
    const newXp = xp + 10
    const newLevel = calcLevel(newXp)
    set((state) => ({ xp: newXp, level: newLevel, totalTrades: state.totalTrades + 1 }))
    if (newLevel > level) {
      window.dispatchEvent(new CustomEvent('pet_level_up', { detail: { level: newLevel } }))
    }
    try {
      await invoke('update_pet_xp', { xpDelta: 10, tokensDelta: 0, tradesDelta: 1 })
    } catch (e) {
      console.error('[pet] gainCloseXp failed:', e)
    }
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
    } catch (e) {
      console.error('[pet] loadFromDb failed:', e)
    }
  },
}))

let petEventWired = false

// Single shared timer for the new-token alert card. A fresh token resets it
// instead of stacking a new 10s timer, so overlapping detections don't leave
// multiple restore callbacks racing each other.
let alertTimer: ReturnType<typeof setTimeout> | null = null
const ALERT_CARD_MS = 10_000

function syncEmotion(emotion: PetEmotion) {
  emitTo('pet', 'pet_emotion', { emotion }).catch(() => {})
}

// The correct resting emotion: idle when the book is flat, otherwise whatever
// the pet was showing before the transient state (invested/pumping/watching).
function settleEmotion() {
  const store = usePetStore.getState()
  if (usePortfolioStore.getState().positions.length === 0) {
    store.setEmotion('idle')
  } else {
    store.restorePrev()
  }
  syncEmotion(usePetStore.getState().emotion)
}

function syncShowCard(token: DetectedToken) {
  emitTo('pet', 'pet_show_card', { token }).catch(() => {})
}

function syncHideCard() {
  emitTo('pet', 'pet_hide_card', {}).catch(() => {})
}

export function setupPetEventListeners() {
  if (petEventWired) return
  petEventWired = true

  listen<DetectedToken>('token_detected', (event) => {
    const filter = useFilterStore.getState().filter
    if (!matchesFilter(event.payload, filter)) return

    const store = usePetStore.getState()
    store.setEmotion('alert')
    syncEmotion('alert')
    syncShowCard(event.payload)
    store.gainTokenXp()

    if (alertTimer) clearTimeout(alertTimer)
    alertTimer = setTimeout(() => {
      alertTimer = null
      settleEmotion()
      syncHideCard()
    }, ALERT_CARD_MS)
  })

  listen('buy_confirmed', () => {
    const store = usePetStore.getState()
    store.setEmotion('invested')
    syncEmotion('invested')
    store.gainBuyXp()
  })

  listen<{ mint: string; price_usd: number }>('price_updated', () => {
    const store = usePetStore.getState()
    if (store.emotion === 'shrug' || store.emotion === 'celebration') return

    const positions = usePortfolioStore.getState().positions
    if (positions.length === 0) return

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

    if (nearSl) {
      store.setEmotion('watching')
      syncEmotion('watching')
    } else if (allPumping) {
      store.setEmotion('pumping')
      syncEmotion('pumping')
    } else {
      store.setEmotion('invested')
      syncEmotion('invested')
    }
  })

  listen<{ realized_pnl_pct: number; close_reason: string }>('position_closed', (e) => {
    const store = usePetStore.getState()
    // Stop-loss always shrugs — even a trailing SL that closes green is framed as
    // "we move", never a celebration. Only a manual sell in profit celebrates.
    const emotion =
      e.payload.close_reason === 'manual' && e.payload.realized_pnl_pct > 0
        ? 'celebration'
        : 'shrug'
    store.setEmotion(emotion)
    syncEmotion(emotion)
    store.gainCloseXp()
    const duration = emotion === 'celebration' ? 5000 : 3000
    setTimeout(settleEmotion, duration)
  })
}
