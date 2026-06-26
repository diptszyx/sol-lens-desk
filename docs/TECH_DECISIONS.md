# Tech Decisions

## Decision Log

### TD-001: Tauri over Electron

**Decision:** Use Tauri 2  
**Alternatives:** Electron, Wails (Go)  
**Reason:**
- Bundle size: ~5MB vs ~150MB
- Rust backend = same language as Solana SDK → no FFI needed
- Better memory usage for long-running trading session
- Windows support: uses Edge WebView2 (pre-installed on Win10/11)

### TD-002: Privy for wallet

**Decision:** Privy React SDK with embedded wallet as default  
**Alternatives:** Phantom direct, Solana Wallet Adapter  
**Reason:**
- Users don't need to install Phantom separately
- Privy handles key custody (no private key stored in app)
- Social login lowers onboarding friction
- **Trade-off:** Privy adds dependency on privy.io servers

**Risk:** OAuth redirects in desktop WebView need Tauri deep-link plugin  
**Mitigation:** Use embedded wallet for MVP (no OAuth redirect needed)

### TD-003: Jupiter for swap routing

**Decision:** Jupiter Quote API v6  
**Alternatives:** Direct Raydium CPI, Orca SDK  
**Reason:**
- Best price across all Solana DEXes automatically
- Simple REST API — easy to call from Rust (reqwest)
- Handles slippage, route splitting
- **Trade-off:** Slight latency vs direct DEX (~100-200ms extra)

### TD-004: Transaction signing in frontend

**Decision:** Build tx in Rust → serialize → sign in React via Privy → send in Rust  
**Reason:**
- Private keys never leave Privy SDK context
- Rust cannot access Privy's signing directly
- Clean security boundary

### TD-005: Zustand over Redux/Jotai

**Decision:** Zustand  
**Reason:** Minimal boilerplate, works well with Tauri event listeners, small bundle

### TD-006: Lightweight Charts over Recharts/Chart.js

**Decision:** TradingView Lightweight Charts  
**Reason:** Canvas-based, handles high-frequency tick data without lag, free for commercial use
