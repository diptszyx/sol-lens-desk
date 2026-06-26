import { create } from 'zustand'
import type { DetectedToken } from '../types'

interface TokenFeedState {
  tokens: DetectedToken[]
  selected: DetectedToken | null
  addToken: (token: DetectedToken) => void
  selectToken: (mint: string) => void
}

export const useTokenFeedStore = create<TokenFeedState>((set, get) => ({
  tokens: [],
  selected: null,

  addToken: (token) =>
    set((state) => ({
      // Dedup by mint — the detector re-emits the same token repeatedly.
      // Drop any existing entry, then prepend the fresh one.
      tokens: [token, ...state.tokens.filter((t) => t.mint !== token.mint)].slice(0, 200),
    })),

  selectToken: (mint) =>
    set((state) => ({
      selected: state.tokens.find((t) => t.mint === mint) ?? null,
    })),
}))
