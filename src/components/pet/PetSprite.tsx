import './pet-sprite.css'
import type { PetEmotion } from '../../store/pet'

import idleSprite from '../../../assets/pet/sprites/idle.png'
import alertSprite from '../../../assets/pet/sprites/alert.png'
import investedSprite from '../../../assets/pet/sprites/invested.png'
import pumpingSprite from '../../../assets/pet/sprites/pumping.png'
import watchingSprite from '../../../assets/pet/sprites/watching.png'
import shrugSprite from '../../../assets/pet/sprites/shrug.png'
import celebrationSprite from '../../../assets/pet/sprites/celebration.png'

interface SpriteConfig {
  url: string
  frames: number
  frameW: number
  frameH: number
  fps: number
  loop: boolean
}

const SPRITES: Record<PetEmotion, SpriteConfig> = {
  idle:        { url: idleSprite,        frames: 8,  frameW: 292, frameH: 256, fps: 3,  loop: true },
  // loop:false — play the sniff → eyes-open reaction once, then hold the final
  // wide-eyed frame for the rest of the card's lifetime. Looping made the alert
  // flick back to its eyes-closed sniff frames every 0.75s, reading as idle.
  alert:       { url: alertSprite,       frames: 6,  frameW: 292, frameH: 256, fps: 6,  loop: false },
  invested:    { url: investedSprite,    frames: 6,  frameW: 292, frameH: 256, fps: 8,  loop: true },
  pumping:     { url: pumpingSprite,     frames: 8,  frameW: 292, frameH: 256, fps: 10, loop: true },
  watching:    { url: watchingSprite,    frames: 4,  frameW: 292, frameH: 256, fps: 4,  loop: true },
  shrug:       { url: shrugSprite,       frames: 10, frameW: 292, frameH: 256, fps: 8,  loop: false },
  celebration: { url: celebrationSprite, frames: 11, frameW: 292, frameH: 256, fps: 10, loop: false },
}

// Canonical display ratio — use idle frame dimensions as baseline
const CANONICAL_W = 292
const CANONICAL_H = 256

interface Props {
  emotion: PetEmotion
  size?: number
  flip?: boolean
  animated?: boolean
}

export function PetSprite({ emotion, size = 64, flip = false, animated = false }: Props) {
  const cfg = SPRITES[emotion]
  const scale = size / CANONICAL_W
  const displayH = Math.round(CANONICAL_H * scale)

  const totalSheetW = cfg.frameW * cfg.frames
  const duration = cfg.frames / cfg.fps

  return (
    <div
      style={{
        width: size,
        height: displayH,
        overflow: 'hidden',
        flexShrink: 0,
        background: 'transparent',
        // translateZ promotes to GPU layer — prevents WebKit from collapsing
        // the compositing layer and losing transparency after window resize.
        transform: flip ? 'scaleX(-1) translateZ(0)' : 'translateZ(0)',
      }}
    >
      <div
        style={{
          width: cfg.frameW,
          height: cfg.frameH,
          background: 'transparent',
          backgroundImage: `url(${cfg.url})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${totalSheetW}px ${cfg.frameH}px`,
          backgroundPosition: '0 0',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // Looping sprites step across all N frames (0 → -N*frameW, the -N boundary
          // is only hit at the instant of wrap). Non-looping sprites must stop ON the
          // last real frame: step to -(N-1)*frameW with steps(N-1), otherwise `forwards`
          // holds the past-the-end position and the pet vanishes on a blank frame.
          animation: animated
            ? `pet-sprite-${emotion} ${duration}s steps(${cfg.loop ? cfg.frames : cfg.frames - 1}) ${cfg.loop ? 'infinite' : '1 forwards'}`
            : undefined,
        }}
      />
    </div>
  )
}
