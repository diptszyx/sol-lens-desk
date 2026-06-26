# P7 — Settings & UX Polish

## Goal
RPC config, default slippage, visual polish, error states.

## Settings Panel

```typescript
interface AppSettings {
  rpc_url: string
  ws_url: string
  default_slippage_bps: number
  min_liquidity_sol: number    // filter: hide tokens below this
  hide_flagged: boolean        // filter: hide tokens with rug flags
}

const DEFAULT_SETTINGS: AppSettings = {
  rpc_url: 'https://mainnet.helius-rpc.com/?api-key=',
  ws_url: 'wss://atlas-mainnet.helius-rpc.com/?api-key=',
  default_slippage_bps: 300,
  min_liquidity_sol: 5,
  hide_flagged: false,
}
```

Store in `tauri-plugin-store` → `settings.json`.

## Token Feed Filters

Apply in store selector, not in store state:

```typescript
export function useFilteredTokens() {
  const tokens = useTokenFeedStore(s => s.tokens)
  const settings = useSettingsStore(s => s.settings)

  return tokens.filter(t => {
    if (t.liquidity_sol < settings.min_liquidity_sol) return false
    if (settings.hide_flagged) {
      const { mint_authority, freeze_authority, top_holder_pct } = t.rug_flags
      if (mint_authority || freeze_authority || top_holder_pct > 30) return false
    }
    return true
  })
}
```

## Error States

| Scenario | UX |
|----------|-----|
| WS disconnected | Yellow banner: "Reconnecting..." |
| RPC error | Red toast: "RPC error: [message]" |
| Buy failed | Red inline error under BUY button |
| High price impact (>5%) | Orange warning before buy |
| No wallet | BUY button disabled + tooltip "Connect wallet first" |

## Connection Status Indicator

Tauri emit from Rust on WS state changes:

```rust
// In detector loop
app.emit("ws_status", json!({ "source": "raydium", "status": "connected" })).ok();
app.emit("ws_status", json!({ "source": "raydium", "status": "disconnected" })).ok();
```

```tsx
// Header: colored dot
<WsStatusDot source="raydium" />
<WsStatusDot source="pump_fun" />
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Deselect token / close detail panel |
| `↑ ↓` | Navigate token feed |
| `Enter` | Open detail for selected token |
| `B` | Focus BUY amount input (when detail open) |

## Sound Alerts (optional)

Play subtle ping on new token detection. Configurable in settings.

```typescript
// Use Web Audio API (available in WebView)
function playDetectionPing() {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.1, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
  osc.start()
  osc.stop(ctx.currentTime + 0.3)
}
```

## Visual Design Direction

- **Theme:** Dark luxury — near-black background, subtle borders, sharp typography
- **Accent:** `#9945FF` (Solana purple) for CTAs
- **Green:** `#22c55e` for pump_fun source, confirmed, positive PnL
- **Red:** `#ef4444` for errors, negative PnL
- **Yellow:** `#eab308` for warnings, rug flags
- **Font:** System monospace for addresses, sans-serif for UI

No gradient blobs. No card grids. Dense information layout like a trading terminal.

## Acceptance Criteria

- [ ] RPC URL configurable in settings and persisted
- [ ] Liquidity filter hides low-liquidity tokens
- [ ] WS status shown in header
- [ ] High price impact (>5%) shows warning before buy
- [ ] Settings persist across app restart
