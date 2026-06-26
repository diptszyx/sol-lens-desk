# P3 — Token Feed UI

## Goal
Real-time scrollable list of new tokens. Each row shows key info at a glance. Clicking a row opens detail panel.

**Note:** P3 depends on P2 + P4. UI only receives tokens that have been enriched + passed filter via the `token_detected` event. No partial/empty tokens in feed.

## Event Flow (simplified)

```
Rust (P2+P4): detect → enrich → filter → emit "token_detected"
                                            │
Frontend (P3): listen<TokenInfo>("token_detected") → addToken → render
```

Chỉ 1 event duy nhất từ Rust lên UI. Mọi token trong feed đều có đầy đủ metadata + đã pass filter.

## Design Reference

Reference `extension/src/content/content.css` + `extension/src/popup/popup.css` for the card design (same visual language as the tooltip card users already see in the extension).

**Shared design tokens** — import from `shared/design-tokens.css`:

```css
:root {
  --bg-deep:    #09090f;
  --bg-base:    #0d0d15;
  --bg-surface: #13131c;
  --text-1: #eeeef5;
  --text-2: #8585a0;
  --text-3: #55556a;
  --border: rgba(255,255,255,0.06);
  --accent:    #c8f135;   /* sol-lens lime — CTA color */
  --positive:  #4ade80;
  --negative:  #f87171;
}
```

Desktop uses same palette — NOT `bg-purple-600`. CTA button = `--accent` lime, same as extension's "Trade $SYMBOL" button.

## Token Detail Card (reference extension tooltip)

The detail panel mirrors the extension's tooltip card:
```
┌─────────────────────────────────────┐
│ [logo] $BONK  Raydium  12s ago      │
│        Bonk Inu          $0.00002   │
│                          -3.2%      │
│ ╔═══════════════════════════════╗   │
│ ║   [price chart - red/green]  ║   │
│ ╚═══════════════════════════════╝   │
│ ┌─────────────┬───────────────┐     │
│ │ MARKET CAP  │ VOLUME (24H)  │     │
│ │ $1.2M       │ $86K          │     │
│ ├─────────────┼───────────────┤     │
│ │ LIQUIDITY   │ HOLDERS       │     │
│ │ 48 SOL      │ 12,431        │     │
│ └─────────────┴───────────────┘     │
│ ⚠ mint auth · top 42%               │
│                                     │
│ [   Trade $BONK   ] ← lime btn      │
└─────────────────────────────────────┘
```

## Layout

```
┌─────────────────────────────────────────────────────┐
│ Header: [Logo] Sol Lens Desk    [Wallet: 7xK...abc] │
├──────────────────────────┬──────────────────────────┤
│  Token Feed              │  Detail Panel            │
│  ┌────────────────────┐  │  (empty until selected)  │
│  │ 🔴 BONK  Raydium  │  │                          │
│  │ $0.0001 | 12 SOL  │  │                          │
│  │ ⚠ mint auth        │  │                          │
│  ├────────────────────┤  │                          │
│  │ 🟢 PEPE  Pump.fun  │  │                          │
│  │ $0.0003 | 8 SOL   │  │                          │
│  └────────────────────┘  │                          │
├──────────────────────────┴──────────────────────────┤
│  Portfolio Panel (collapsible bottom)               │
└─────────────────────────────────────────────────────┘
```

## Zustand Store (src/store/tokenFeed.ts)

```typescript
import { create } from 'zustand'
import type { TokenInfo } from '../types'

interface TokenFeedState {
  tokens: TokenInfo[]
  selected: TokenInfo | null
  addToken: (token: TokenInfo) => void
  selectToken: (mint: string) => void
}

export const useTokenFeedStore = create<TokenFeedState>((set, get) => ({
  tokens: [],
  selected: null,

  addToken: (token) => set(state => ({
    // newest first, cap at 200 to avoid memory growth
    tokens: [token, ...state.tokens].slice(0, 200),
  })),

  selectToken: (mint) => set(state => ({
    selected: state.tokens.find(t => t.mint === mint) ?? null,
  })),
}))
```

## Components

### TokenFeed (src/components/token-feed/TokenFeed.tsx)

```tsx
import { useTokenFeed } from '../../hooks/useTokenFeed'
import { useTokenFeedStore } from '../../store/tokenFeed'
import { TokenRow } from './TokenRow'

export function TokenFeed() {
  useTokenFeed()  // listens for Rust "token_detected" events
  const { tokens, selectToken } = useTokenFeedStore()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-500">
          {tokens.length} tokens detected
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tokens.map(token => (
          <TokenRow
            key={token.mint}
            token={token}
            onClick={() => selectToken(token.mint)}
          />
        ))}
        {tokens.length === 0 && (
          <div className="p-8 text-center text-gray-600">
            Listening for new tokens...
          </div>
        )}
      </div>
    </div>
  )
}
```

### TokenRow (src/components/token-feed/TokenRow.tsx)

```tsx
import type { TokenInfo } from '../../types'
import { RugBadge } from './RugBadge'
import { formatAge, formatSol } from '../../lib/format'

interface Props {
  token: TokenInfo
  onClick: () => void
}

export function TokenRow({ token, onClick }: Props) {
  const hasFlags = token.rug_flags.mint_authority || token.rug_flags.freeze_authority

  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 text-left hover:bg-gray-900 border-b border-gray-800/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            token.source === 'pump_fun' ? 'bg-green-500' : 'bg-blue-500'
          }`} />
          <span className="font-mono font-semibold text-white">
            {token.symbol || token.mint.slice(0, 6)}
          </span>
          <span className="text-xs text-gray-500">{token.source}</span>
        </div>
        <span className="text-xs text-gray-500">{formatAge(token.age_seconds)}</span>
      </div>

      <div className="mt-1 flex items-center gap-3">
        <span className="text-sm text-gray-300">
          {formatSol(token.liquidity_sol)} SOL liq
        </span>
        {hasFlags && <RugBadge flags={token.rug_flags} />}
      </div>
    </button>
  )
}
```

### RugBadge

```tsx
import type { RugFlags } from '../../types'

export function RugBadge({ flags }: { flags: RugFlags }) {
  const warnings: string[] = []
  if (flags.mint_authority) warnings.push('mint')
  if (flags.freeze_authority) warnings.push('freeze')
  if (flags.top_holder_pct > 30) warnings.push(`top ${flags.top_holder_pct.toFixed(0)}%`)

  if (warnings.length === 0) return null

  return (
    <span className="text-xs text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">
      ⚠ {warnings.join(' · ')}
    </span>
  )
}
```

## Format utils (src/lib/format.ts)

```typescript
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

export function formatSol(sol: number): string {
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}k`
  return sol.toFixed(2)
}
```

## Acceptance Criteria

- [ ] New token appears at top of list within 2s of detection
- [ ] List capped at 200 rows — no memory growth
- [ ] Rug flags shown inline as yellow badges
- [ ] Clicking row selects it (detail panel placeholder shows)
- [ ] Source color: green = pump_fun, blue = raydium
- [ ] Smooth scroll, no jank on fast token bursts
