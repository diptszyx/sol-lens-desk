import { useEffect, useRef, useState } from 'react'
import { usePetStore } from '../../store/pet'
import { PetSprite } from './PetSprite'

const PET_SIZE = 44
const SPEED = 0.7 // px per frame
const MARGIN = 16

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>
  onClickPet: () => void
}

export function WalkingPet({ containerRef, onClickPet }: Props) {
  const emotion = usePetStore((s) => s.emotion)
  const [x, setX] = useState(80)
  const [facingRight, setFacingRight] = useState(true)
  const xRef = useRef(80)
  const dirRef = useRef(1) // 1 = right, -1 = left
  const rafRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const step = () => {
      const w = containerRef.current?.offsetWidth ?? 800
      const maxX = w - PET_SIZE - MARGIN

      xRef.current += dirRef.current * SPEED

      if (xRef.current >= maxX) {
        xRef.current = maxX
        dirRef.current = -1
        setFacingRight(false)
      } else if (xRef.current <= MARGIN) {
        xRef.current = MARGIN
        dirRef.current = 1
        setFacingRight(true)
      }

      setX(xRef.current)
      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [containerRef])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        left: x,
        zIndex: 20,
        cursor: 'pointer',
        userSelect: 'none',
        filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))',
      }}
      onClick={onClickPet}
      title="Pet dashboard"
    >
      <PetSprite emotion={emotion} size={PET_SIZE} flip={!facingRight} />
    </div>
  )
}
