import { create } from 'zustand'
import type { DetectedToken } from '../types'

interface TokenFeedState {
  tokens: DetectedToken[]
  selected: DetectedToken | null
  scoreAlerts: DetectedToken[]
  addToken: (token: DetectedToken) => void
  updateToken: (token: DetectedToken) => void
  selectToken: (mint: string) => void
  clearTokens: () => void
  addScoreAlert: (token: DetectedToken) => void
  dismissScoreAlert: (mint: string) => void
}

export const useTokenFeedStore = create<TokenFeedState>((set, get) => ({
  tokens: [],
  selected: null,
  scoreAlerts: [],

  addToken: (token) =>
    set((state) => ({
      tokens: [token, ...state.tokens.filter((t) => t.mint !== token.mint)].slice(0, 200),
    })),

  updateToken: (token) =>
    set((state) => ({
      tokens: state.tokens.map((t) => (t.mint === token.mint ? token : t)),
      selected: state.selected?.mint === token.mint ? token : state.selected,
    })),

  selectToken: (mint) =>
    set((state) => ({
      selected: state.tokens.find((t) => t.mint === mint) ?? null,
    })),

  clearTokens: () => set({ tokens: [], selected: null }),

  addScoreAlert: (token) =>
    set((state) => ({
      scoreAlerts: [token, ...state.scoreAlerts.filter((t) => t.mint !== token.mint)],
    })),

  dismissScoreAlert: (mint) =>
    set((state) => ({
      scoreAlerts: state.scoreAlerts.filter((t) => t.mint !== mint),
    })),
}))
