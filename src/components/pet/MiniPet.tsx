import { useEffect, useState } from 'react'
import { usePetStore, type PetEmotion } from '../../store/pet'
import { CapybaraSvg } from '../notifications/CapybaraSvg'

const emotionLabels: Record<PetEmotion, string> = {
  idle: '',
  alert: '!',
  invested: '◎',
  pumping: '+',
  watching: '👀',
  shrug: '',
  celebration: '★',
}

const emotionAnimations: Record<PetEmotion, string> = {
  idle: 'capy-idle 2s ease-in-out infinite',
  alert: 'capy-alert 0.3s ease-in-out 3',
  invested: 'capy-bounce 0.5s ease-in-out infinite',
  pumping: 'capy-dance 0.3s ease-in-out infinite',
  watching: 'capy-still 0s',
  shrug: 'capy-shrug 0.5s ease-in-out 1',
  celebration: 'capy-spin 0.3s ease-in-out 8',
}

export function MiniPet() {
  const emotion = usePetStore((s) => s.emotion)
  const xp = usePetStore((s) => s.xp)
  const level = usePetStore((s) => s.level)
  const [expanded, setExpanded] = useState(false)
  const [levelUp, setLevelUp] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
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
    <div className="relative">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
        title={`Level ${level} Capybara — ${xp} XP`}
      >
        <div
          className="w-7 h-7 flex items-center justify-center"
          style={{ animation: emotionAnimations[emotion] }}
        >
          <CapybaraSvg size={28} emotion={emotion} />
        </div>
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
        <div className="absolute bottom-full mb-2 left-0 w-48 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-2xl z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[var(--text-1)]">
              {emotion === 'idle' ? 'Chillin\'' : emotion.charAt(0).toUpperCase() + emotion.slice(1)}
            </span>
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

      <style>{`
        @keyframes capy-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes capy-alert {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        @keyframes capy-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes capy-dance {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-4px) rotate(-5deg); }
          75% { transform: translateY(-4px) rotate(5deg); }
        }
        @keyframes capy-still {
          0%, 100% { transform: scale(1); }
        }
        @keyframes capy-shrug {
          0% { transform: translateY(0); }
          50% { transform: translateY(-6px) rotate(-10deg); }
          100% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes capy-spin {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.2); }
          100% { transform: rotate(360deg) scale(1); }
        }
      `}</style>
    </div>
  )
}
