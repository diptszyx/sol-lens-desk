# Feature Inventory — Current State

**Last updated:** 2026-06-27  
**Status:** Reflects actual implemented code

---

## Module 1: Token Detector (Backend — Rust)

**Location:** `src-tauri/src/detector/`, `src-tauri/src/enricher.rs`

### What's implemented
- WebSocket listener for pump.fun new token events
- Parses `RawTokenEvent`: mint, symbol, name, dev_address, dev_token_amount, v_sol_in_curve, v_tokens_in_curve, initial_sol
- Enricher fetches additional data: price_usd, liquidity_sol, market_cap_usd, holder_count, age_seconds
- Emits `token_detected` Tauri event to frontend with full `DetectedToken` payload

### DetectedToken fields available
```typescript
mint, symbol, name, decimals, price_usd,
liquidity_sol, market_cap_usd, volume_24h,
holder_count, age_seconds, source, detected_at,
dev_address, dev_hold_pct, bonding_curve_pct,
dev_buy_sol, has_socials
```

### Missing
- `mint_authority_revoked` — not fetched (needs `getMint()` RPC call)
- `freeze_authority_revoked` — not fetched (same call)
- Bundle detection — no same-block multi-wallet check
- Holder velocity (how fast holders growing)

---

## Module 2: Filter System (Frontend)

**Location:** `src/lib/filter.ts`, `src/store/filter.ts`, `src/components/filter/FilterPanel.tsx`

### What's implemented
- `FilterConfig` interface with fields:
  - `maxAgeSec`, `maxDevHoldPct`, `minDevBuySol`
  - `maxMcapUsd`, `minBondingCurvePct`, `minLiquiditySol`
  - `requireSocials`, `hideUnnamed`, `sources[]`, `search`
- `matchesFilter()` function — binary pass/fail
- Persisted to Tauri store (survives app restart)
- `FilterPanel` UI with numeric inputs + toggles

### Missing
- Signal score (0–100) — currently binary only
- Score threshold slider replacing multiple fields
- Filter presets (Degen / Balanced / Safe)
- Volume/momentum filters
- Mint + freeze authority filter (can't filter what isn't fetched)
- Filter stats ("X tokens/day pass current config")

---

## Module 3: Token Feed (Frontend)

**Location:** `src/components/token-feed/`

### What's implemented
- `TokenFeed` — real-time list of filtered tokens, newest on top
- `TokenRow` — per-token row with: symbol, price, mcap, liquidity, age, source badge
- `Badge` component for dev_hold_pct (color-coded)
- `devHoldColor()` — color logic based on dev hold %

### Missing
- Signal score display per row
- Sort by score
- Visual rug risk indicator (mint/freeze authority)

---

## Module 4: Pet — Capybara Overlay

**Location:** `src/components/pet/`

### What's implemented
- Separate transparent Tauri window (floating overlay)
- `PetApp` — capybara SVG with bob animation (walk loop), flips left/right randomly
- On `token_detected` event → speech bubble flashes "🚨 New $SYMBOL" for ~3s
- On hover → closes bubble, opens `PetCard`

### PetCard (hover popup)
- Token stats: price, mcap, liquidity, age (4 fields)
- SOL presets + Buy button
- Communicates with main window via Tauri events: `pet_buy_request` → `pet_buy_result`
- `usePetTradeBridge` in main window handles actual swap execution and position creation

### Missing
- **Card shows on hover only** — meme coins require immediate action, hover is too slow
- Pet has no emotional state — doesn't know if alert is good/bad signal
- Pet doesn't react differently to high-score vs low-score token
- No history of past alerts
- Pet appearance doesn't change based on portfolio performance

---

## Module 5: Trade (Frontend + Backend)

**Location:** `src/components/token-detail/TradePanel.tsx`, `src-tauri/src/commands/`

### What's implemented — Full TradePanel (main window)
- Auto-quotes via Jupiter/swap on amount/slippage change (debounced)
- SOL presets: quick-select buttons
- Slippage presets
- Price impact warning (yellow >1%, red >5%)
- Full flow: quote → sign → `build_swap_transaction` → `sign_transaction` → `send_transaction`
- On confirmed: `addPosition()` to portfolio store

### What's implemented — PetCard quick trade
- SOL presets only (no custom input)
- Fixed slippage (SLIPPAGE_BPS constant)
- Bridge pattern via Tauri events (pet window → main window)

### TradeState machine
```
idle → quoting → ready → signing → done/error
```

### Missing
- **Sell** — no sell flow exists anywhere
- Stop loss — no mechanism
- Take profit — no mechanism
- Custom SOL input in PetCard
- Slippage control in PetCard

---

## Module 6: Portfolio

**Location:** `src/components/portfolio/PortfolioPanel.tsx`, `src/store/portfolio.ts`

### What's implemented
- `Position` type: mint, symbol, entry_price_usd, amount_tokens, amount_sol_spent, current_price_usd, pnl_pct, opened_at, tx_signature
- Store actions: `addPosition`, `updatePrices`, `closePosition`
- `PortfolioPanel` — displays open positions
- `addPosition` called automatically after confirmed buy

### Missing (critical)
- `pnl_pct` is always `null` at open — no price polling mechanism to update it
- `updatePrices` exists but nothing triggers it
- `closePosition` exists but no sell flow to call it
- **No realized PnL tracking** (need separate closed_positions)
- No stop loss monitor
- No take profit monitor
- No sell button in UI

---

## Module 7: Wallet (Custom — No Third Party)

**Location:** `src/components/wallet/`, `src/components/auth/`, `src/store/wallet.ts`, `src-tauri/src/wallet.rs`

### What's implemented
- Custom Rust wallet: `create_wallet`, `import_wallet` (mnemonic)
- `unlock_wallet` (password) / `lock_wallet` — in-memory keypair lifecycle
- AES-GCM encryption: keypair stored encrypted locally, never plaintext
- `sign_transaction` — signs with in-memory keypair when unlocked
- `export_wallet` — export mnemonic + private key (base58)
- `WalletGate` / `WalletSetup` / `WalletUnlock` — auth UI flow
- `useWalletStore` — exposes `address` to frontend
- Privy đã bị xóa hoàn toàn

---

## Summary: Critical Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| No mint/freeze authority data | Missing most important safety signal | 🔴 High |
| No score — binary filter only | UX friction, can't rank quality | 🔴 High |
| Pet card shows on hover only | Miss trade window on fast meme coins | 🔴 High |
| No sell flow | Can't close positions | 🔴 High |
| No live price polling | PnL always null, stop loss impossible | 🔴 High |
| No stop loss | Risk management missing | 🟡 Medium |
