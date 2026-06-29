import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DetectedToken } from '../../types'
import { CapybaraSvg } from '../notifications/CapybaraSvg'
import { PetCard } from './PetCard'
import { usePetWindow } from './usePetWindow'
import { usePetStore } from '../../store/pet'
import { useFilterStore } from '../../store/filter'
import { matchesFilter } from '../../lib/filter'

const AUTO_CARD_MS = 10000

const BODY_ANIM: Record<string, string> = {
  idle:        'capy-bob 2s ease-in-out infinite',
  alert:       'capy-bob-fast 0.7s ease-in-out infinite',
  invested:    'capy-bob 1.8s ease-in-out infinite',
  pumping:     'capy-bounce 0.45s ease-in-out infinite',
  watching:    'capy-tremble 0.15s ease-in-out infinite',
  shrug:       'capy-droop 3s ease-in-out infinite',
  celebration: 'capy-bounce 0.35s ease-in-out infinite',
}

export function PetApp() {
  const { facing, openCard, closeCard } = usePetWindow()
  const [activeToken, setActiveToken] = useState<DetectedToken | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emotion = usePetStore((s) => s.emotion)
  const hydrate = useFilterStore((s) => s.hydrate)

  useEffect(() => { void hydrate() }, [hydrate])

  // Keep stable refs to openCard/closeCard so the event listener never
  // needs to be re-registered (avoids timer-clearing on re-render).
  const openCardRef = useRef(openCard)
  const closeCardRef = useRef(closeCard)
  useEffect(() => { openCardRef.current = openCard }, [openCard])
  useEffect(() => { closeCardRef.current = closeCard }, [closeCard])

  // Stable ref to the current filter config so the listener can read it
  // without being in the dep array.
  const filterRef = useRef(useFilterStore.getState().filter)
  useEffect(() => {
    return useFilterStore.subscribe((s) => { filterRef.current = s.filter })
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<DetectedToken>('token_detected', (e) => {
      // Only alert + show card if token passes the active filter config.
      if (!matchesFilter(e.payload, filterRef.current)) return

      setActiveToken(e.payload)
      setCardOpen(true)
      openCardRef.current()

      if (autoTimer.current) clearTimeout(autoTimer.current)
      autoTimer.current = setTimeout(() => {
        setCardOpen(false)
        closeCardRef.current()
      }, AUTO_CARD_MS)
    }).then((fn) => { unlisten = fn })
    return () => {
      unlisten?.()
      if (autoTimer.current) clearTimeout(autoTimer.current)
    }
  }, []) // stable — uses refs for everything mutable

  const bodyAnim = cardOpen ? 'none' : (BODY_ANIM[emotion] ?? BODY_ANIM.idle)

  return (
    <div
      className="flex h-screen w-screen select-none flex-col items-center justify-end gap-2 px-3 pb-1"
      style={{ background: 'transparent' }}
    >
      {cardOpen && (
        <div className="w-full">
          {activeToken ? (
            <PetCard token={activeToken} />
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-center text-xs text-[var(--text-2)] shadow-2xl">
              Waiting for new tokens…
            </div>
          )}
        </div>
      )}

      <div style={{ transform: `scaleX(${facing})` }}>
        <div style={{ animation: bodyAnim }}>
          <CapybaraSvg size={92} emotion={emotion} />
        </div>
      </div>

      <style>{`
        @keyframes capy-bob {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-3px); }
        }
        @keyframes capy-bob-fast {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes capy-bounce {
          0%, 100% { transform: translateY(0) scaleY(1); }
          40%       { transform: translateY(-8px) scaleY(1.05); }
          70%       { transform: translateY(-2px) scaleY(0.97); }
        }
        @keyframes capy-tremble {
          0%, 100% { transform: translateX(0); }
          25%       { transform: translateX(-1.5px); }
          75%       { transform: translateX(1.5px); }
        }
        @keyframes capy-droop {
          0%, 60%, 100% { transform: translateY(0); }
          80%           { transform: translateY(2px); }
        }
      `}</style>
    </div>
  )
}
