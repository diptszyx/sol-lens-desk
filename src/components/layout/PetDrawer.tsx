import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DetectedToken } from '../../types'
import { PetSprite } from '../pet/PetSprite'
import { PetCard } from '../pet/PetCard'
import { usePetStore } from '../../store/pet'
import { useFilterStore } from '../../store/filter'
import { matchesFilter } from '../../lib/filter'

const AUTO_CARD_MS = 10000

interface Props {
  open: boolean
  onClose: () => void
}

export function PetDrawer({ open, onClose }: Props) {
  const [activeToken, setActiveToken] = useState<DetectedToken | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emotion = usePetStore((s) => s.emotion)
  const level = usePetStore((s) => s.level)
  const xp = usePetStore((s) => s.xp)
  const hydrate = useFilterStore((s) => s.hydrate)
  const [flip, setFlip] = useState(false)

  useEffect(() => { void hydrate() }, [hydrate])

  const filterRef = useRef(useFilterStore.getState().filter)
  useEffect(() => {
    return useFilterStore.subscribe((s) => { filterRef.current = s.filter })
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    listen<DetectedToken>('token_detected', (e) => {
      if (!matchesFilter(e.payload, filterRef.current)) return
      setActiveToken(e.payload)
      setCardOpen(true)
      setFlip((f) => !f)

      if (autoTimer.current) clearTimeout(autoTimer.current)
      autoTimer.current = setTimeout(() => {
        setCardOpen(false)
      }, AUTO_CARD_MS)
    }).then((fn) => {
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    })
    return () => {
      cancelled = true
      unlisten?.()
      if (autoTimer.current) clearTimeout(autoTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 pointer-events-none"
          onClick={onClose}
          style={{ background: 'rgba(0,0,0,0.3)' }}
        />
      )}

      <div
        className={`fixed top-0 right-0 h-screen w-[380px] z-50 border-l border-[var(--border)] bg-[var(--bg-base)] flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">🐾</span>
            <span className="text-xs font-bold text-[var(--text-1)]">Capybara</span>
            <span className="text-[10px] text-[var(--accent)] font-bold">Lv.{level}</span>
            <span className="text-[10px] text-[var(--text-3)]">{xp} XP</span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] text-lg leading-none w-6 h-6 flex items-center justify-center"
            aria-label="Close pet drawer"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-end gap-2 px-3 pb-4">
          {cardOpen && activeToken && (
            <div className="w-full" style={{ animation: 'fadeIn 200ms ease-out' }}>
              <PetCard token={activeToken} />
            </div>
          )}

          <PetSprite emotion={emotion} size={92} flip={flip} />
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
