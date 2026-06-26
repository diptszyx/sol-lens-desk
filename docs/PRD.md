# Sol Lens Desk — Product Requirements Document

**Version:** 0.1  
**Date:** 2026-06-25  
**Status:** Draft

---

## 1. Problem

Solana new token launches happen in milliseconds. Traders using browser-based tools miss opportunities due to:
- Tab/browser overhead
- Manual copy-paste between tools
- No unified signal → decision → trade flow

## 2. Product Vision

A desktop app (Windows/macOS/Linux) that detects new Solana token launches in real-time, surfaces key safety signals, and lets the user execute a swap in one click.

---

## 3. User Flow

```
App open
  └─ Connect wallet via Privy
       └─ Dashboard loads
            ├─ Token feed: new tokens stream in realtime
            ├─ User clicks token → detail panel opens
            │     ├─ Liquidity, market cap, top holders
            │     ├─ Mint authority / freeze authority flags
            │     └─ Bonding curve progress (Pump.fun)
            └─ User sets amount → clicks BUY
                  └─ Transaction signed via Privy → sent to chain
                       └─ Position appears in portfolio panel
```

---

## 4. Features

### MVP (Phase 1)

| # | Feature | Description |
|---|---------|-------------|
| F1 | Wallet connect | Login + wallet via Privy (embedded or connected wallet) |
| F2 | New token feed | Real-time stream of new tokens from Pump.fun + Raydium |
| F3 | Token detail | Liquidity, holders, mint/freeze flags, age, price |
| F4 | Semi-auto buy | User sets SOL amount, clicks BUY, Privy signs, Rust sends |
| F5 | Portfolio panel | Open positions, entry price, current price, PnL |
| F6 | Basic rug filters | Auto-flag tokens with mint authority, top holder >30%, no liquidity lock |

### Phase 2

| # | Feature |
|---|---------|
| F7 | Auto-sell via take-profit / stop-loss |
| F8 | Wallet balance display |
| F9 | Transaction history |
| F10 | Custom filter presets |

---

## 5. Non-Goals (MVP)

- Fully automated sniping (no human confirmation)
- Multi-chain support
- Mobile app
- Social features

---

## 6. Success Metrics

- Time from token detection → trade execution < 5 seconds (user-limited)
- App cold start < 3 seconds
- Zero missed new pool events during active session
- No wallet key stored in app (Privy handles signing)

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Privy OAuth redirect broken in desktop WebView | Use Privy's `headless` mode or deep-link redirect scheme |
| RPC rate limits | Use paid RPC (Helius/Triton), configurable endpoint |
| False positives in rug detection | Show flags as warnings, never auto-block |
| Transaction failure / slippage | Show error clearly, configurable slippage setting |
