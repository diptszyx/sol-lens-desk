import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow, currentMonitor, primaryMonitor } from '@tauri-apps/api/window'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'

const IDLE_W = 240
const IDLE_H = 180
const CARD_W = 320
const CARD_H = 470
const BOTTOM_MARGIN = 8
const STEP = 1.4
const TICK_MS = 32

type Mode = 'walk' | 'card'

interface PetWindowApi {
  facing: 1 | -1
  openCard: () => void
  closeCard: () => void
}

export function usePetWindow(): PetWindowApi {
  const [facing, setFacing] = useState<1 | -1>(1)

  const posX = useRef(40)
  const dir = useRef<1 | -1>(1)
  const mode = useRef<Mode>('walk')
  const mon = useRef<{ w: number; h: number } | null>(null)

  const api = useRef<{ openCard: () => void; closeCard: () => void }>({
    openCard: () => {},
    closeCard: () => {},
  })

  useEffect(() => {
    const win = getCurrentWindow()
    let timer: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    const idleY = () => (mon.current ? mon.current.h - IDLE_H - BOTTOM_MARGIN : 0)
    const maxX = () => (mon.current ? Math.max(0, mon.current.w - IDLE_W) : 0)

    async function init() {
      if (cancelled) return
      const m = (await currentMonitor()) ?? (await primaryMonitor())
      const scale = m ? await win.scaleFactor().catch(() => 1) : 1
      mon.current = m
        ? { w: m.size.width / scale, h: m.size.height / scale }
        : { w: window.screen.width, h: window.screen.height }
      posX.current = Math.min(posX.current, maxX())
      await win.setPosition(new LogicalPosition(posX.current, idleY())).catch(() => {})
      timer = setInterval(tick, TICK_MS)
    }

    function tick() {
      if (mode.current !== 'walk' || !mon.current) return
      let x = posX.current + STEP * dir.current
      if (x <= 0) {
        x = 0
        dir.current = 1
        setFacing(1)
      } else if (x >= maxX()) {
        x = maxX()
        dir.current = -1
        setFacing(-1)
      }
      posX.current = x
      win.setPosition(new LogicalPosition(x, idleY())).catch(() => {})
    }

    init()

    api.current = {
      openCard: async () => {
        if (!mon.current) return
        mode.current = 'card'
        const x = Math.min(
          Math.max(0, posX.current - (CARD_W - IDLE_W) / 2),
          Math.max(0, mon.current.w - CARD_W),
        )
        const y = mon.current.h - CARD_H - BOTTOM_MARGIN
        await win.setSize(new LogicalSize(CARD_W, CARD_H)).catch(() => {})
        await win.setPosition(new LogicalPosition(x, y)).catch(() => {})
        // Force WebKit to repaint transparent layer after resize — macOS compositor
        // sometimes renders stale opaque background after dynamic window resize.
        requestAnimationFrame(() => {
          document.documentElement.style.opacity = '0.9999'
          requestAnimationFrame(() => { document.documentElement.style.opacity = '' })
        })
      },
      closeCard: async () => {
        if (!mon.current) {
          mode.current = 'walk'
          return
        }
        await win.setSize(new LogicalSize(IDLE_W, IDLE_H)).catch(() => {})
        await win.setPosition(new LogicalPosition(posX.current, idleY())).catch(() => {})
        mode.current = 'walk'
      },
    }

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [])

  return {
    facing,
    openCard: () => api.current.openCard(),
    closeCard: () => api.current.closeCard(),
  }
}
