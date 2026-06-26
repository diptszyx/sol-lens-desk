# Sol Lens — Desktop App Architecture

> Part of the **sol-lens monorepo**. See monorepo structure below.

---

## Monorepo Structure

```
sol-lens/                          ← repo root (current sol-lens/)
├── extension/                     ← Chrome MV3 extension (current src/ moved here)
│   ├── src/
│   └── package.json
├── desktop/                       ← Tauri desktop app (this project)
│   ├── src/                       ← React frontend
│   ├── src-tauri/                 ← Rust backend
│   └── package.json
├── shared/                        ← Shared types, design tokens, API utils
│   ├── types.ts                   ← TokenMeta, SwapRecord, etc. (moved from extension)
│   ├── design-tokens.css          ← CSS custom properties shared across surfaces
│   └── package.json
├── pnpm-workspace.yaml
└── package.json
```

### Why monorepo

- `shared/types.ts` — `TokenMeta`, `SwapRecord` used by both extension + desktop
- Same data sources: Jupiter, Birdeye, GeckoTerminal, DexScreener
- Same design language: card UI, color tokens, typography
- One repo, one CI pipeline

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Desktop shell | **Tauri 2** | Cross-platform, ~5MB bundle, uses OS WebView |
| UI framework | **React 19 + TypeScript** | Fast dev, rich ecosystem |
| UI styling | **Tailwind CSS v4** | Utility-first, no runtime overhead |
| Wallet / Auth | **Privy React SDK** | Embedded wallet + social login, handles signing |
| Rust runtime | **Tokio** | Async, high-performance event loop |
| Solana Rust | **solana-client + solana-sdk** | RPC calls, transaction building |
| Swap routing | **Jupiter Quote API v6** | Best price routing, simple REST |
| Realtime data | **WebSocket (tokio-tungstenite)** | Subscribe to new pool events |
| State (UI) | **Zustand** | Minimal, no boilerplate |
| Charts | **Lightweight Charts (TradingView)** | Fast canvas-based price charts |

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Tauri App Window                                        │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  React Frontend (WebView)                       │    │
│  │                                                 │    │
│  │  ┌──────────┐  ┌────────────┐  ┌────────────┐  │    │
│  │  │ Token    │  │  Detail    │  │ Portfolio  │  │    │
│  │  │ Feed     │  │  Panel     │  │ Panel      │  │    │
│  │  └──────────┘  └────────────┘  └────────────┘  │    │
│  │                                                 │    │
│  │  Privy SDK (wallet connect + signing)           │    │
│  │  Zustand store (app state)                      │    │
│  └──────────────┬──────────────────────────────────┘    │
│                 │  Tauri IPC (invoke / emit)             │
│  ┌──────────────▼──────────────────────────────────┐    │
│  │  Rust Backend (src-tauri/)                      │    │
│  │                                                 │    │
│  │  ┌────────────────────────────────────────┐     │    │
│  │  │  Token Detector                        │     │    │
│  │  │  - WS subscribe: Raydium AMM logs      │     │    │
│  │  │  - WS subscribe: Pump.fun graduations  │     │    │
│  │  │  - Parse: mint, pool address, liq      │     │    │
│  │  └──────────────┬─────────────────────────┘     │    │
│  │                 │                               │    │
│  │  ┌──────────────▼─────────────────────────┐     │    │
│  │  │  Token Enricher                        │     │    │
│  │  │  - RPC: fetch mint account             │     │    │
│  │  │  - RPC: top holders                    │     │    │
│  │  │  - Rug flags: mint auth, freeze auth   │     │    │
│  │  └──────────────┬─────────────────────────┘     │    │
│  │                 │                               │    │
│  │  ┌──────────────▼─────────────────────────┐     │    │
│  │  │  Trade Executor                        │     │    │
│  │  │  - GET /quote from Jupiter API         │     │    │
│  │  │  - Build VersionedTransaction          │     │    │
│  │  │  - Return serialized tx to frontend    │     │    │
│  │  │  - Frontend signs via Privy            │     │    │
│  │  │  - Rust receives signed tx → sends     │     │    │
│  │  └────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         Helius RPC      Jupiter API     Pump.fun WS
```

---

## Transaction Signing Flow

Privy runs in the WebView → cannot directly call Rust for signing. Flow:

```
1. User clicks BUY in UI
2. UI calls Tauri command: build_swap_transaction(params)
3. Rust fetches Jupiter quote → builds VersionedTransaction (unsigned)
4. Rust serializes tx → base64 → returns to UI
5. UI: privy.signTransaction(deserialize(base64))
6. UI sends signed tx back: Tauri command send_transaction(signed_base64)
7. Rust deserializes + sends via RPC
8. Rust emits event: transaction_result { signature, status }
9. UI shows success/error
```

---

## IPC Command Surface

```rust
// Tauri commands exposed to frontend
get_new_tokens()           → stream via emit("new_token", TokenInfo)
get_token_detail(mint)     → TokenDetail
build_swap_transaction(SwapParams) → base64 serialized tx
send_transaction(signed_base64)    → TxResult
get_positions()            → Vec<Position>
set_rpc_url(url)           → ()
```

---

## Directory Structure

```
sol-lens/desktop/           ← desktop app root (inside monorepo)
├── src/                    # React frontend
│   ├── components/
│   │   ├── token-feed/
│   │   ├── token-detail/
│   │   └── portfolio/
│   ├── hooks/
│   │   ├── useTokenFeed.ts
│   │   └── usePortfolio.ts
│   ├── store/              # Zustand stores
│   ├── lib/
│   │   ├── tauri.ts        # IPC wrappers
│   │   └── privy.ts        # Privy config
│   └── App.tsx
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   │   ├── swap.rs
│   │   │   └── tokens.rs
│   │   ├── detector/
│   │   │   ├── raydium.rs
│   │   │   └── pump_fun.rs
│   │   ├── enricher.rs
│   │   └── rpc.rs
│   └── Cargo.toml
└── docs/
```

---

## Privy Desktop Compatibility Note

Privy SDK is web-first. In Tauri's WebView:

- **OAuth social login** may need Tauri's `deep-link` plugin to handle redirect URIs
- **Embedded wallets** (no OAuth) work out of the box in WebView
- **External wallet connect** (Phantom via WalletConnect) works in WebView

**Recommendation:** Default to Privy embedded wallet for MVP. Add external wallet support in Phase 2.

Configure in `tauri.conf.json`:
```json
{
  "security": {
    "csp": "default-src 'self'; connect-src https://*.privy.io wss://* https://*"
  }
}
```

---

## RPC Strategy

- Development: free Helius devnet
- Production: user-configurable RPC URL (stored in app config, not hardcoded)
- Recommended: Helius or Triton (paid, higher rate limits for WS subscriptions)
