import { useEffect, useRef, useState } from 'react'
import { usePetStore, type PetEmotion } from '../../store/pet'
import { PetSprite } from './PetSprite'

const emotionLabels: Record<PetEmotion, string> = {
  idle: '',
  alert: '!',
  invested: '◎',
  pumping: '+',
  watching: '👀',
  shrug: '',
  celebration: '★',
}

export function MiniPet() {
  const emotion = usePetStore((s) => s.emotion)
  const xp = usePetStore((s) => s.xp)
  const level = usePetStore((s) => s.level)
  const [expanded, setExpanded] = useState(false)
  const [levelUp, setLevelUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded])

  useEffect(() => {
    const handler = () => {
      setLevelUp(true)
      setTimeout(() => setLevelUp(false), 3000)
    }
    window.addEventListener('pet_level_up', handler)
    return () => window.removeEventListener('pet_level_up', handler)
  }, [])

  const xpForLevel = level === 1 ? 500 : level === 2 ? 2000 : 9999
  const levelXpStart = level === 1 ? 0 : level === 2 ? 500 : 2000
  const xpProgress = Math.min(((xp - levelXpStart) / (xpForLevel - levelXpStart)) * 100, 100)

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
        title={`Level ${level} Capybara — ${xp} XP`}
      >
        <PetSprite emotion={emotion} size={28} />
        {emotion !== 'idle' && (
          <span className="text-[10px] font-bold text-[var(--accent)] animate-pulse">
            {emotionLabels[emotion]}
          </span>
        )}
        {levelUp && (
          <span className="text-[10px] font-bold text-yellow-400 animate-bounce">
            Lv{level}
          </span>
        )}
      </button>

      {expanded && (
        <div className="absolute top-full mt-2 right-0 w-48 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-2xl z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[var(--text-1)]">Capybara</span>
            <span className="text-[10px] text-[var(--accent)] font-bold">Lv.{level}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--text-3)]">XP</span>
              <span className="text-[var(--text-2)] tabular-nums">{xp} / {xpForLevel}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--bg-deep)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${xpProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
