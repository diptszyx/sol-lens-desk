import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'

export type DetectorStatus = 'idle' | 'connected' | 'reconnecting'

interface DetectorStatusStore {
  status: DetectorStatus
  errorCount: number
  init: () => void
}

let listening = false

// Default optimistic: the backend emits "connected" once, almost immediately at app
// startup, before the frontend has finished mounting and registering its listener — that
// first event is reliably missed. Only "reconnecting" (re-emitted on every retry) is safe
// to depend on, so assume connected unless we actually observe a reconnect.
export const useDetectorStatusStore = create<DetectorStatusStore>((set, get) => ({
  status: 'connected',
  errorCount: 0,
  init: () => {
    if (listening) return
    listening = true
    listen<{ status: string }>('detector_status', (e) => {
      const s = e.payload.status
      if (s === 'idle') {
        set({ status: 'idle', errorCount: 0 })
      } else if (s === 'connected') {
        set({ status: 'connected', errorCount: 0 })
      } else if (s === 'reconnecting') {
        set({ status: 'reconnecting', errorCount: get().errorCount + 1 })
      }
    })
  },
}))
