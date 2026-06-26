# Sol Lens Desktop — Master Plan

## Context
Part of the **sol-lens monorepo** (`sol-lens/desktop/`).
Extension (`sol-lens/extension/`) and desktop share types + design tokens via `sol-lens/shared/`.

## Goal
Desktop app (Tauri) detect new Solana tokens + semi-auto trade via Privy embedded wallet.
Same card UI + design language as the Chrome extension.

## Detection Pipeline (Hybrid WS + Filter)

```
Launch Platform (Pump.fun, LetsBONK.fun, ...)
    │  WS logsSubscribe
    ▼
RawTokenEvent (signature + source)
    │  tokio::mpsc pending queue
    ▼
Enricher (tokio::spawn per token)
    ├── Fetch tx → extract mint
    └── Fetch market data (Jupiter → DexScreener)
    │
    ▼
Filter Layer (simple)
    ├── min_liquidity_sol (default: 5 SOL)
    └── blocked_mints
    │
    ├── Pass → emit "token_detected" → UI feed
    └── Fail → skip
```

## Processing Flow (Full)

```
User opens app
  │
  ▼
P1: Login via Privy → embedded wallet
  │
  ▼
P2: Rust WS connects → subscribe launch platforms
  │  Detector → pending queue
  ▼
P4: Enricher fetches metadata + rug flags
  │  Filter → emit only passing tokens
  ▼
P3: UI real-time feed updates
  │  User clicks token → detail panel (chart + stats)
  ▼
P5: User enters SOL amount → BUY
  │  Jupiter quote → Rust build tx → Privy sign → Rust send
  ▼
P6: Position added to portfolio
  │  Price polls every 10s → PnL updates
  ▼
P7: Settings (RPC URL, filters, slippage)
```

## Phases

| Phase | Name | Deliverable | Est. |
|-------|------|-------------|------|
| P0 | Project Setup | Monorepo restructure + Tauri scaffold | 1-2 days |
| P1 | Wallet Auth | Privy embedded wallet, login screen | 1 day |
| P2 | Token Detector | Rust WS listener → pending queue | 2 days |
| P3 | Token Feed UI | Real-time feed component | 1 day |
| P4 | Token Enricher + Filter | RPC metadata, rug flags, filter layer | 1 day |
| P5 | Trade Flow | Jupiter quote → build tx → sign → send | 2 days |
| P6 | Portfolio | Positions panel, PnL | 1 day |
| P7 | Polish | Settings, error states, UX | 1 day |

**Total MVP estimate: ~10 days**

## Plan Files

- [01-project-setup.md](./01-project-setup.md) ✅
- [02-privy-integration.md](./02-privy-integration.md) ✅
- [03-token-detector.md](./03-token-detector.md) 🔄 updated
- [04-token-feed-ui.md](./04-token-feed-ui.md)
- [05-token-enricher.md](./05-token-enricher.md) 🔄 updated
- [06-trade-flow.md](./06-trade-flow.md)
- [07-portfolio.md](./07-portfolio.md)
- [08-settings-ux.md](./08-settings-ux.md)

## Dependencies Between Phases

```
P0 ──► P1 ──► P5 (trade needs wallet)
P0 ──► P2 ──► P4 (enricher needs detector pipeline)
         P2 + P4 ──► P3 (feed needs detector + enricher)
         P3 + P4 + P5 ──► P6 (portfolio needs all three)
         P3 + P4 + P5 + P6 ──► P7 (settings polish)
```

## Key Technical Risks

| Risk | Phase | Mitigation |
|------|-------|-----------|
| Privy iframe blocked by Tauri CSP | P1 | Configure CSP + Privy dashboard allowed origins |
| WS disconnect / missed events | P2 | Auto-reconnect with exponential backoff |
| Launch platform program address changes | P2 | Configurable addresses, log patterns |
| Jupiter API rate limit | P5 | Cache quotes briefly, show retry UI |
| Tx build fails (blockhash stale) | P5 | Fetch fresh blockhash per trade attempt |
| DexScreener not indexing token yet | P4 | Retry enrich after 5s if first attempt returns null |
