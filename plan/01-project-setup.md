# P0 — Project Setup

## Goal
Working Tauri 2 app with React 19 + TypeScript frontend. Hot reload dev. Production build passes.
Desktop lives at `sol-lens/desktop/` inside the monorepo.

## Steps

### 0. Monorepo setup (run from `sol-lens/` root)

Move current extension source into `extension/`, then add workspace config:

```bash
# From sol-lens/ root
mkdir -p extension desktop shared

# Move extension code
mv src extension/src
mv manifest.json extension/
mv vite.config.ts extension/
mv tsconfig.json extension/
mv package.json extension/
# Root package.json becomes workspace root (see below)
```

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'extension'
  - 'desktop'
  - 'shared'
```

**Root package.json:**
```json
{
  "name": "sol-lens",
  "private": true,
  "scripts": {
    "dev:ext": "pnpm --filter extension dev",
    "dev:desktop": "pnpm --filter desktop tauri dev",
    "build:ext": "pnpm --filter extension build",
    "build:desktop": "pnpm --filter desktop tauri build"
  }
}
```

**shared/package.json:**
```json
{
  "name": "@sol-lens/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.ts",
  "exports": { ".": "./index.ts" }
}
```

Move `extension/src/shared/types.ts` → `shared/types.ts`
Move `extension/src/shared/utils.ts` → `shared/utils.ts`
Update extension imports: `'../shared/types'` → `'@sol-lens/shared'`

### 1. Scaffold desktop Tauri project

```bash
cd sol-lens/
pnpm create tauri-app desktop
# Choose: React + TypeScript
# Tauri version: 2.x
cd desktop
```

### 2. Frontend dependencies

```bash
pnpm add \
  @privy-io/react-auth \
  @solana/web3.js \
  zustand \
  lightweight-charts \
  tailwindcss @tailwindcss/vite \
  clsx
```

### 3. Rust dependencies (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.21", features = ["native-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
solana-client = "1.18"
solana-sdk = "1.18"
bs58 = "0.5"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
```

### 4. Tauri config (tauri.conf.json)

Key settings:
```json
{
  "productName": "Sol Lens Desk",
  "version": "0.1.0",
  "bundle": {
    "identifier": "io.solens.desk"
  },
  "security": {
    "csp": "default-src 'self' tauri:; script-src 'self' 'unsafe-inline'; connect-src https://*.privy.io wss://* https://* ipc: http://ipc.localhost; frame-src https://*.privy.io; img-src 'self' data: https:"
  },
  "windows": [
    {
      "title": "Sol Lens Desk",
      "width": 1280,
      "height": 800,
      "minWidth": 1024,
      "minHeight": 600
    }
  ]
}
```

> **Note:** `frame-src https://*.privy.io` is critical for Privy embedded wallet iframe.

### 5. Vite config

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
})
```

### 6. Folder structure init

```
src/
├── components/
├── hooks/
├── store/
├── lib/
│   ├── tauri.ts      # typed IPC wrappers
│   └── privy.ts      # PrivyProvider config
├── types/
│   └── index.ts      # shared types (TokenInfo, Position, etc.)
└── App.tsx

src-tauri/src/
├── main.rs
├── lib.rs            # tauri::Builder setup
├── commands/
│   ├── mod.rs
│   ├── swap.rs
│   └── tokens.rs
├── detector/
│   ├── mod.rs
│   ├── raydium.rs
│   └── pump_fun.rs
├── enricher.rs
└── rpc.rs
```

### 7. Types strategy

**Reuse from `@sol-lens/shared`** — don't redefine:
- `TokenMeta` — full token metadata (symbol, name, mint, price, mcap, liquidity, holders, etc.)
- `SwapRecord` — completed swap history
- `PriceHistory` — OHLCV data for charts

**Desktop-only types (desktop/src/types/index.ts):**

```typescript
import type { TokenMeta } from '@sol-lens/shared'

// Extends TokenMeta with detection-specific fields
export interface DetectedToken extends TokenMeta {
  source: 'raydium' | 'pump_fun'
  detected_at: number       // unix ms
  rug_flags: RugFlags
  enriched: boolean         // false = only signature known so far
}

export interface RugFlags {
  mint_authority: boolean
  freeze_authority: boolean
  top_holder_pct: number    // 0-100
  liquidity_locked: boolean | null
}

export interface Position {
  mint: string
  symbol: string
  entry_price_sol: number
  amount_tokens: number
  amount_sol_spent: number
  current_price_sol: number | null
  pnl_pct: number | null
  opened_at: number
  tx_signature: string
}

export interface SwapParams {
  output_mint: string
  amount_lamports: number
  slippage_bps: number
  user_public_key: string
}

export interface TxResult {
  signature: string
  status: 'confirmed' | 'failed'
  error: string | null
}
```

## Acceptance Criteria

- [ ] `pnpm tauri dev` launches app with white screen (no errors in console)
- [ ] `pnpm tauri build` produces binary for current OS
- [ ] Hot reload works on frontend file save
- [ ] Rust compile succeeds with all deps
