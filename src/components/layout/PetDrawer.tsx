import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DetectedToken } from '../../types'
import { CapybaraSvg } from '../notifications/CapybaraSvg'
import { PetCard } from '../pet/PetCard'
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
  const [facing, setFacing] = useState(1)

  useEffect(() => { void hydrate() }, [hydrate])

  const filterRef = useRef(useFilterStore.getState().filter)
  useEffect(() => {
    return useFilterStore.subscribe((s) => { filterRef.current = s.filter })
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<DetectedToken>('token_detected', (e) => {
      if (!matchesFilter(e.payload, filterRef.current)) return
      setActiveToken(e.payload)
      setCardOpen(true)
      setFacing((f) => -f)

      if (autoTimer.current) clearTimeout(autoTimer.current)
      autoTimer.current = setTimeout(() => {
        setCardOpen(false)
      }, AUTO_CARD_MS)
    }).then((fn) => { unlisten = fn })
    return () => {
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

  const bodyAnim = cardOpen ? 'none' : (BODY_ANIM[emotion] ?? BODY_ANIM.idle)

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
            <div className="w-full animate-fadeIn">
              <PetCard token={activeToken} />
            </div>
          )}

          <div style={{ transform: `scaleX(${facing})` }}>
            <div style={{ animation: bodyAnim }}>
              <CapybaraSvg size={92} emotion={emotion} />
            </div>
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
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .animate-fadeIn {
            animation: fadeIn 200ms ease-out;
          }
        `}</style>
      </div>
    </>
  )
}
