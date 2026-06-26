import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { useTokenFeedStore } from '../store/tokenFeed'
import type { DetectedToken } from '../types'

export function useTokenFeed() {
  const addToken = useTokenFeedStore((s) => s.addToken)

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<DetectedToken>('token_detected', (event) => {
        addToken(event.payload)
      })

      return unlisten
    }

    let unlistenFn: (() => void) | null = null
    setup().then((fn) => { unlistenFn = fn })

    return () => {
      unlistenFn?.()
    }
  }, [])
}
