import { create } from 'zustand'
import type { Position } from '../types'

interface PortfolioState {
  positions: Position[]
  addPosition: (p: Position) => void
  updatePrices: (prices: Record<string, number>) => void
  closePosition: (mint: string) => void
}

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  positions: [],

  addPosition: (position) =>
    set((state) => ({
      positions: [...state.positions, position],
    })),

  updatePrices: (prices) =>
    set((state) => ({
      positions: state.positions.map((p) => {
        const current = prices[p.mint]
        if (!current) return p
        const pnl = ((current - p.entry_price_usd) / p.entry_price_usd) * 100
        return { ...p, current_price_usd: current, pnl_pct: pnl }
      }),
    })),

  closePosition: (mint) =>
    set((state) => ({
      positions: state.positions.filter((p) => p.mint !== mint),
    })),
}))
