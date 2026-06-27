import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DetectedToken } from '../../types'
import { CapybaraSvg } from '../notifications/CapybaraSvg'
import { PetCard } from './PetCard'
import { usePetWindow } from './usePetWindow'
import { usePetStore } from '../../store/pet'

const BUBBLE_MS = 5000

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
  const [bubble, setBubble] = useState(false)
  const [hovering, setHovering] = useState(false)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emotion = usePetStore((s) => s.emotion)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<DetectedToken>('token_detected', (e) => {
      setActiveToken(e.payload)
      setBubble(true)
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
      bubbleTimer.current = setTimeout(() => setBubble(false), BUBBLE_MS)
    }).then((fn) => { unlisten = fn })
    return () => {
      unlisten?.()
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
    }
  }, [])

  function handleEnter() {
    setHovering(true)
    openCard()
  }

  function handleLeave() {
    setHovering(false)
    closeCard()
  }

  const symbol = activeToken?.symbol ?? activeToken?.mint.slice(0, 6)
  const bodyAnim = hovering ? 'none' : (BODY_ANIM[emotion] ?? BODY_ANIM.idle)

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="flex h-screen w-screen select-none flex-col items-center justify-end gap-2 px-3 pb-1"
      style={{ background: 'transparent' }}
    >
      {hovering && (
        <div className="w-full">
          {activeToken ? (
            <PetCard token={activeToken} />
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-center text-xs text-[var(--text-3)] shadow-2xl">
              Waiting for new tokens…
            </div>
          )}
        </div>
      )}

      {!hovering && bubble && activeToken && (
        <div className="relative max-w-[200px] rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 shadow-xl">
          <p className="text-xs font-bold text-[var(--text-1)]">
            🚨 New <span className="text-[var(--accent)]">${symbol}</span>
          </p>
          <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[var(--border)] bg-[var(--bg-surface)]" />
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
