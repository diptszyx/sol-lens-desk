# P6 — Portfolio Panel

## Goal
Track open positions from buys made in-session. Show entry price, current price, PnL. Persist across app restarts.

## Data Model

```typescript
interface Position {
  mint: string
  symbol: string
  entry_price_sol: number     // SOL per token at buy
  amount_tokens: number       // tokens received
  amount_sol_spent: number    // SOL spent
  current_price_sol: number | null
  pnl_pct: number | null
  opened_at: number           // unix ms
  tx_signature: string
}
```

## Storage

Use Tauri's `tauri-plugin-store` (JSON file in app data dir). Positions persist across restarts.

```toml
# Cargo.toml
tauri-plugin-store = "2"
```

```typescript
// Frontend: use @tauri-apps/plugin-store
import { Store } from '@tauri-apps/plugin-store'
const store = new Store('positions.json')
```

## Store (src/store/portfolio.ts)

```typescript
import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import type { Position } from '../types'

interface PortfolioState {
  positions: Position[]
  addPosition: (p: Position) => Promise<void>
  updatePrices: (prices: Record<string, number>) => void
  closePosition: (mint: string) => Promise<void>
}

let tauriStore: Store | null = null

async function getStore() {
  if (!tauriStore) tauriStore = new Store('positions.json')
  return tauriStore
}

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  positions: [],

  addPosition: async (position) => {
    const store = await getStore()
    const next = [...get().positions, position]
    await store.set('positions', next)
    await store.save()
    set({ positions: next })
  },

  updatePrices: (prices) => set(state => ({
    positions: state.positions.map(p => {
      const current = prices[p.mint]
      if (!current) return p
      const pnl = ((current - p.entry_price_sol) / p.entry_price_sol) * 100
      return { ...p, current_price_sol: current, pnl_pct: pnl }
    }),
  })),

  closePosition: async (mint) => {
    const store = await getStore()
    const next = get().positions.filter(p => p.mint !== mint)
    await store.set('positions', next)
    await store.save()
    set({ positions: next })
  },
}))
```

## Price Polling

Poll Jupiter price API every 10s for open positions:

```typescript
// src/hooks/usePricePoll.ts
import { useEffect } from 'react'
import { usePortfolioStore } from '../store/portfolio'

const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v2'

export function usePricePoll() {
  const { positions, updatePrices } = usePortfolioStore()

  useEffect(() => {
    if (positions.length === 0) return

    const poll = async () => {
      const mints = positions.map(p => p.mint).join(',')
      try {
        const resp = await fetch(`${JUPITER_PRICE_URL}?ids=${mints}`)
        const data = await resp.json()
        const prices: Record<string, number> = {}
        for (const [mint, info] of Object.entries(data.data as Record<string, { price: string }>)) {
          prices[mint] = parseFloat(info.price)
        }
        updatePrices(prices)
      } catch {
        // silent — prices just won't update this tick
      }
    }

    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [positions.length])
}
```

## Portfolio Panel Component

```tsx
// src/components/portfolio/PortfolioPanel.tsx
import { usePortfolioStore } from '../../store/portfolio'
import { usePricePoll } from '../../hooks/usePricePoll'
import { formatSol } from '../../lib/format'

export function PortfolioPanel() {
  usePricePoll()
  const { positions } = usePortfolioStore()

  if (positions.length === 0) {
    return (
      <div className="p-4 text-center text-gray-600 text-sm">
        No open positions
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs border-b border-gray-800">
            <th className="text-left px-3 py-2">Token</th>
            <th className="text-right px-3 py-2">Spent</th>
            <th className="text-right px-3 py-2">Entry</th>
            <th className="text-right px-3 py-2">Current</th>
            <th className="text-right px-3 py-2">PnL</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => (
            <PositionRow key={p.mint} position={p} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PositionRow({ position: p }: { position: Position }) {
  const pnlColor = !p.pnl_pct
    ? 'text-gray-400'
    : p.pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'

  return (
    <tr className="border-b border-gray-800/50 hover:bg-gray-900">
      <td className="px-3 py-2 font-mono">
        {p.symbol || p.mint.slice(0, 8)}
      </td>
      <td className="px-3 py-2 text-right text-gray-300">
        {formatSol(p.amount_sol_spent)} SOL
      </td>
      <td className="px-3 py-2 text-right text-gray-400 text-xs">
        {p.entry_price_sol.toExponential(3)}
      </td>
      <td className="px-3 py-2 text-right text-gray-300 text-xs">
        {p.current_price_sol?.toExponential(3) ?? '—'}
      </td>
      <td className={`px-3 py-2 text-right font-semibold ${pnlColor}`}>
        {p.pnl_pct != null ? `${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(1)}%` : '—'}
      </td>
    </tr>
  )
}
```

## Add Position After Trade

In TradePanel, after confirmed tx:

```typescript
const { addPosition } = usePortfolioStore()

if (txResult.status === 'confirmed') {
  await addPosition({
    mint: token.mint,
    symbol: token.symbol ?? token.mint.slice(0, 6),
    entry_price_sol: parseFloat(amount) / (out_amount / 10 ** token.decimals),
    amount_tokens: out_amount,
    amount_sol_spent: parseFloat(amount),
    current_price_sol: null,
    pnl_pct: null,
    opened_at: Date.now(),
    tx_signature: txResult.signature,
  })
}
```

## Acceptance Criteria

- [ ] Position appears immediately after confirmed buy
- [ ] Positions persist after app restart
- [ ] PnL updates every 10s via Jupiter price API
- [ ] Green/red color coding for PnL
- [ ] No positions → shows "No open positions" placeholder
