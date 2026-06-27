# P1: Foundation

**Blocks:** P2, P3, P4  
**Ref:** [SIGNAL_RESEARCH.md](../SIGNAL_RESEARCH.md), [THIRD_PARTY_SERVICES.md](../THIRD_PARTY_SERVICES.md)

---

## T1.1 — Live SOL/USD Price

**Problem:** `SOL_USD_APPROX = 150.0` hardcoded in `enricher.rs:6` → sai toàn bộ price_usd, market_cap_usd.

**Files:** `src-tauri/src/enricher.rs`

**What to do:**
1. Thêm async function `fetch_sol_price_usd() -> f64` — gọi Jupiter Price API cho SOL mint (`So11111111111111111111111111111111111111112`)
2. Cache kết quả trong `tokio::sync::RwLock<(f64, Instant)>` — TTL 30s, lazy-init
3. Xóa `const SOL_USD_APPROX: f64 = 150.0`
4. `build_from_event()` gọi `get_sol_price_usd().await`

```
Jupiter Price API: GET https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112
Response: { "data": { "So11...": { "price": "160.42" } } }
```

**Fallback:** Nếu fetch fail → dùng last cached value (hoặc 150.0 nếu chưa có lần nào thành công).

---

## T1.2 — Mint/Freeze Authority Check (Hard Gates)

**Problem:** Hiện tại không check mint authority hoặc freeze authority → có thể alert rug tokens.

**Files:** `src-tauri/src/enricher.rs`, `src-tauri/src/rpc.rs`

**What to do:**
1. Thêm `fetch_mint_authorities(mint: &str, rpc: &RpcClient) -> (bool, bool)` → trả `(mint_authority_revoked, freeze_authority_revoked)`
   - Gọi `rpc.get_account_data(mint_pubkey)` → deserialize `spl_token::state::Mint`
   - `mint_authority_revoked = mint.mint_authority.is_none()`
   - `freeze_authority_revoked = mint.freeze_authority.is_none()`
2. Trong `enrich()`: nếu `!mint_authority_revoked || !freeze_authority_revoked` → return `None` (hard gate, token bị block silently)
3. `Pipeline` cần pass `RpcClient` vào enricher (hoặc enricher nhận RPC state từ App)
4. Thêm fields vào `TokenInfo`:
   ```rust
   pub mint_authority_revoked: bool,
   pub freeze_authority_revoked: bool,
   ```

**Note:** RPC call này có latency ~200-500ms. Chấp nhận được vì token detection không cần sub-second.

**Dependency:** Cần `RpcState` accessible từ enricher — pass `rpc_url` vào `enrich()` hoặc dùng global.

---

## T1.3 — Score Computation

**Problem:** Không có score → không thể implement Filter phase.

**Files:** `src-tauri/src/enricher.rs`

**What to do:**
1. Thêm `fn compute_score(token: &TokenInfo) -> u8` theo formula trong [SIGNAL_RESEARCH.md](../SIGNAL_RESEARCH.md):
   ```
   Safety (max 50):
     dev_hold_pct < 5%  → +30
     dev_hold_pct < 10% → +15
     else               →  0
     lp_locked          → +20 (skip for now — data not available pre-graduation)

   Signal (max 50):
     bonding_curve_pct 30-50% → +25
     bonding_curve_pct 50-70% → +15
     bonding_curve_pct > 70%  → +5
     else (< 30%)             →  0
     dev_buy_sol >= 1.0       → +15
     dev_buy_sol >= 0.5       → +8
     else                     →  0
     has_socials == true      → +10
   ```
2. Thêm field `pub score: u8` vào `TokenInfo`
3. Gọi `compute_score()` cuối `build_from_event()` và set `score`

---

## T1.4 — TypeScript Types Update

**Files:** `src/types/index.ts`

**What to do:**
1. Thêm vào `DetectedToken`:
   ```typescript
   mint_authority_revoked: boolean
   freeze_authority_revoked: boolean
   score: number
   ```
2. Xóa khỏi `FilterConfig`:
   ```
   maxDevHoldPct, minDevBuySol, maxMcapUsd, minBondingCurvePct, requireSocials, sources
   ```
3. Thêm vào `FilterConfig`:
   ```typescript
   minScoreThreshold: number  // 0-100
   ```
4. Update `DEFAULT_FILTER` và xóa `SNIPER_PRESET` (replaced by score presets)

---

## T1.5 — SQLite Setup

**Files:** `src-tauri/src/db.rs` (new), `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

**What to do:**
1. Add `tauri-plugin-sql` với SQLite feature vào `Cargo.toml` nếu chưa có
2. Tạo `src-tauri/src/db.rs`:
   ```rust
   pub async fn init_db(app: &AppHandle) -> anyhow::Result<()>
   ```
   Chạy migrations:
   ```sql
   CREATE TABLE IF NOT EXISTS trades (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     mint TEXT NOT NULL,
     symbol TEXT NOT NULL,
     side TEXT NOT NULL CHECK(side IN ('buy','sell')),
     amount_sol REAL NOT NULL,
     amount_tokens REAL NOT NULL,
     price_usd REAL,
     tx_signature TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('confirmed','failed')),
     created_at INTEGER NOT NULL
   );

   CREATE TABLE IF NOT EXISTS closed_positions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     mint TEXT NOT NULL,
     symbol TEXT NOT NULL,
     entry_price_usd REAL NOT NULL,
     exit_price_usd REAL NOT NULL,
     amount_sol_spent REAL NOT NULL,
     amount_sol_received REAL NOT NULL,
     realized_pnl_usd REAL NOT NULL,
     realized_pnl_pct REAL NOT NULL,
     opened_at INTEGER NOT NULL,
     closed_at INTEGER NOT NULL,
     close_reason TEXT NOT NULL CHECK(close_reason IN ('manual','stop_loss'))
   );

   CREATE TABLE IF NOT EXISTS pet_state (
     id INTEGER PRIMARY KEY CHECK(id = 1),
     xp INTEGER NOT NULL DEFAULT 0,
     level INTEGER NOT NULL DEFAULT 1,
     total_tokens_seen INTEGER NOT NULL DEFAULT 0,
     total_trades INTEGER NOT NULL DEFAULT 0
   );
   ```
3. Call `db::init_db(&app)` trong `lib.rs` setup closure

---

## Checklist P1

- [ ] T1.1: SOL price live, cached 30s, fallback to last known
- [ ] T1.2: getMint() RPC, hard gate returns None, TokenInfo has authority fields
- [ ] T1.3: compute_score() correct formula, score in TokenInfo
- [ ] T1.4: TypeScript types updated, old FilterConfig fields removed
- [ ] T1.5: SQLite initialized, 3 tables created on startup
- [ ] Build passes, no regression on existing token detection
