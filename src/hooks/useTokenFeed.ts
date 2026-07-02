import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { useTokenFeedStore } from '../store/tokenFeed'
import { useFilterStore } from '../store/filter'
import type { DetectedToken } from '../types'

function isTokenFresh(token: DetectedToken, maxAgeSec: number | null): boolean {
  if (maxAgeSec == null) return true
  return (Date.now() - token.detected_at) / 1000 <= maxAgeSec
}

export function useTokenFeed() {
  const addToken = useTokenFeedStore((s) => s.addToken)
  const updateToken = useTokenFeedStore((s) => s.updateToken)
  const addScoreAlert = useTokenFeedStore((s) => s.addScoreAlert)

  // Refs so event listeners don't need to re-register on every render
  const tokensRef = useRef(useTokenFeedStore.getState().tokens)
  const thresholdRef = useRef(useFilterStore.getState().filter.minScoreThreshold)
  const filterRef = useRef(useFilterStore.getState().filter)

  useEffect(() => {
    const unsubTokens = useTokenFeedStore.subscribe((s) => {
      tokensRef.current = s.tokens
    })
    const unsubFilter = useFilterStore.subscribe((s) => {
      thresholdRef.current = s.filter.minScoreThreshold
      filterRef.current = s.filter
    })
    return () => {
      unsubTokens()
      unsubFilter()
    }
  }, [])

  useEffect(() => {
    let cleanupFn: (() => void) | null = null
    let cancelled = false

    const setup = async () => {
      const unlisten1 = await listen<DetectedToken>('token_detected', (event) => {
        addToken(event.payload)
      })

      const unlisten2 = await listen<DetectedToken>('token_updated', (event) => {
        const updated = event.payload
        const existing = tokensRef.current.find((t) => t.mint === updated.mint)

        if (existing) {
          const threshold = thresholdRef.current
          const fresh = isTokenFresh(updated, filterRef.current.maxAgeSec)
          if (fresh && existing.score < threshold && updated.score >= threshold) {
            addScoreAlert(updated)
          }
          updateToken(updated)
        }
      })

      return () => {
        unlisten1()
        unlisten2()
      }
    }

    // StrictMode (dev) mounts/cleans up/remounts synchronously — if cleanup already ran
    // by the time setup() resolves, tear down immediately instead of leaking listeners
    // that would double-process every token_detected/token_updated event.
    setup().then((fn) => {
      if (cancelled) {
        fn()
      } else {
        cleanupFn = fn
      }
    })

    return () => {
      cancelled = true
      cleanupFn?.()
    }
  }, [addToken, updateToken, addScoreAlert])
}
