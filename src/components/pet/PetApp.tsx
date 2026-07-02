import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DetectedToken } from '../../types'
import type { PetEmotion } from '../../store/pet'
import { PetSprite } from './PetSprite'
import { PetCard } from './PetCard'
import { usePetWindow } from './usePetWindow'
import { usePetStore } from '../../store/pet'

export function PetApp() {
  const { facing, openCard, closeCard } = usePetWindow()
  const [activeToken, setActiveToken] = useState<DetectedToken | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const emotion = usePetStore((s) => s.emotion)

  const openCardRef = useRef(openCard)
  const closeCardRef = useRef(closeCard)
  useEffect(() => { openCardRef.current = openCard }, [openCard])
  useEffect(() => { closeCardRef.current = closeCard }, [closeCard])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    listen<{ emotion: PetEmotion }>('pet_emotion', (e) => {
      usePetStore.getState().setEmotion(e.payload.emotion)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => { cancelled = true; unlisten?.() }
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    listen<{ token: DetectedToken }>('pet_show_card', (e) => {
      setActiveToken(e.payload.token)
      setCardOpen(true)
      openCardRef.current()
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => { cancelled = true; unlisten?.() }
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    listen('pet_hide_card', () => {
      setCardOpen(false)
      closeCardRef.current()
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => { cancelled = true; unlisten?.() }
  }, [])

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

      <PetSprite emotion={emotion} size={92} flip={facing === -1} animated />
    </div>
  )
}
