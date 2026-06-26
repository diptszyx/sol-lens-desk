import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DetectedToken } from '../../types'
import { CapybaraSvg } from '../notifications/CapybaraSvg'
import { PetCard } from './PetCard'
import { usePetWindow } from './usePetWindow'

const BUBBLE_MS = 5000

/**
 * Root of the capybara overlay window. The capybara walks along the bottom of the
 * desktop, pops a speech bubble when a new token is detected, and expands into a
 * trade card on hover. Trades are delegated to the dashboard via `pet_buy_request`.
 */
export function PetApp() {
  const { facing, openCard, closeCard } = usePetWindow()
  const [activeToken, setActiveToken] = useState<DetectedToken | null>(null)
  const [bubble, setBubble] = useState(false)
  const [hovering, setHovering] = useState(false)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // New token → set as active, flash a speech bubble.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<DetectedToken>('token_detected', (e) => {
      setActiveToken(e.payload)
      setBubble(true)
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
      bubbleTimer.current = setTimeout(() => setBubble(false), BUBBLE_MS)
    }).then((fn) => {
      unlisten = fn
    })
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

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="flex h-screen w-screen select-none flex-col items-center justify-end gap-2 px-3 pb-1"
      style={{ background: 'transparent' }}
    >
      {/* Trade card on hover */}
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

      {/* Speech bubble on alert (when not hovering) */}
      {!hovering && bubble && activeToken && (
        <div className="relative max-w-[200px] rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 shadow-xl">
          <p className="text-xs font-bold text-[var(--text-1)]">
            🚨 New <span className="text-[var(--accent)]">${symbol}</span>
          </p>
          {/* tail */}
          <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[var(--border)] bg-[var(--bg-surface)]" />
        </div>
      )}

      {/* Capybara — flip on outer (facing), bob on inner (walk) to avoid
          transform clobbering between the two. */}
      <div style={{ transform: `scaleX(${facing})` }}>
        <div style={{ animation: !hovering ? 'capy-walk 0.5s ease-in-out infinite' : 'none' }}>
          <CapybaraSvg size={92} />
        </div>
      </div>

      <style>{`
        @keyframes capy-walk {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  )
}
