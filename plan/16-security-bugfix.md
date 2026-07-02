# Plan 16 — Security Hardening & Bug Fixes

Audit date: 2026-06-30. Fixes ranked by severity. Each task is self-contained and can be done independently.

---

## P0 — Critical (ship-blocker)

### P0-1 · Wallet KDF: SHA256 → Argon2

**File:** `src-tauri/src/wallet.rs`  
**Risk:** Encrypted `wallet.json` bị lấy → brute-force password trong vài giây.

**Current:**
```rust
fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(password.as_bytes());
    h.update(b"sol-lens-v1");
    h.update(salt);
    h.finalize().into()
}
```

**Steps:**
1. Add `argon2 = "0.5"` vào `Cargo.toml`
2. Replace `derive_key` với Argon2id:
```rust
use argon2::{Argon2, Algorithm, Version, Params};

fn derive_key(password: &str, salt: &[u8]) -> anyhow::Result<[u8; 32]> {
    let params = Params::new(65536, 3, 1, Some(32))?; // 64MB mem, 3 iterations
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| anyhow::anyhow!("KDF failed: {e}"))?;
    Ok(key)
}
```
3. Migration: khi user unlock lần đầu sau update, re-encrypt với key mới. Strategy:
   - Đọc version field từ `wallet.json` (add `"kdf": "argon2id"` field)
   - Nếu field thiếu → còn dùng SHA256 → decrypt OK → re-encrypt với Argon2 → save lại
4. Update `encrypt_secrets` và `decrypt_secrets` để handle `Result<[u8;32]>` thay vì `[u8;32]`
5. Salt tăng từ 16 lên 32 bytes

**Test:** Thời gian unlock phải ~0.2-0.5s (acceptable UX, đủ chậm để brute-force)

---

### P0-2 · Stop-Loss: emit trước, remove sau

**File:** `src-tauri/src/price_tracker.rs`  
**Risk:** Emit fail → position zombie (không tracked, nhưng vẫn trong DB/Zustand)

**Current order:**
```rust
positions.write().await.remove(&mint);  // 1. xóa khỏi tracker
let _ = app.emit("sl_triggered", ...);  // 2. notify frontend
```

**Fixed order:**
```rust
// 1. Notify frontend FIRST
if let Err(e) = app.emit("sl_triggered", SLPayload { mint: mint.clone(), ... }) {
    tracing::error!("sl_triggered emit failed for {mint}: {e}");
    // vẫn tiếp tục remove để tránh infinite SL loop
}
// 2. Sau đó mới remove
positions.write().await.remove(&mint);
```

**Note:** Emit fail vẫn nên remove — nếu không, SL sẽ trigger lại ở tick tiếp theo. Nhưng ít nhất log lại được.

---

### P0-3 · Transaction Idempotency Key

**Files:** `src-tauri/src/db.rs`, `src-tauri/src/commands/history.rs`  
**Risk:** Network timeout → frontend retry → double-spend (2x SOL mất)

**Steps:**

1. Thêm UNIQUE constraint vào `trades` table:
```sql
-- Thêm index, không drop table (data migration safe)
CREATE UNIQUE INDEX IF NOT EXISTS trades_tx_sig_idx ON trades(tx_signature);
```
Chạy khi `DbPool::open()` ngay sau `execute_batch`.

2. Trong `log_trade` command, đổi sang `INSERT OR IGNORE`:
```rust
conn.execute(
    "INSERT OR IGNORE INTO trades 
     (mint, symbol, side, amount_sol, amount_tokens, price_usd, tx_signature, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    params![...],
)?;
```

3. Frontend: trước khi gọi `send_transaction`, check nếu tx_signature đã trong DB → skip (dùng query `SELECT 1 FROM trades WHERE tx_signature = ?`)

4. Tương tự cho `send_sell_transaction` trong `sl_triggered` flow.

---

### P0-4 · RPC Error → Reject Token (không phải assume safe)

**File:** `src-tauri/src/enricher.rs`  
**Risk:** RPC timeout/rate-limit → token assume safe → bad token lọt vào feed

**Current:**
```rust
Err(_) => (true, true),  // assume BOTH revoked = safe
```

**Fixed:**
```rust
Err(e) => {
    tracing::warn!("fetch_mint_authorities failed for {mint}: {e}");
    return None;  // drop token nếu không verify được
}
```

Thay toàn bộ match arm, bỏ `(true, true)` fallback.

---

## P1 — High (fix trong sprint tiếp)

### P1-1 · DB: `std::sync::Mutex` → `tokio::sync::Mutex`

**File:** `src-tauri/src/db.rs`  
**Risk:** Blocking tokio thread → starve async runtime → concurrent invokes fail silently (root cause của XP bug)

**Steps:**

1. Đổi import và struct:
```rust
use tokio::sync::Mutex;  // thay std::sync::Mutex

pub struct DbPool {
    pub conn: Mutex<Connection>,
}
```

2. Tất cả methods cần thêm `.await`:
```rust
// Before
let conn = self.conn.lock().unwrap();

// After
let conn = self.conn.lock().await;
// (bỏ .unwrap() — tokio Mutex không poison)
```

3. Tất cả methods phải thành `async fn`:
```rust
pub async fn update_pet_xp(&self, ...) -> anyhow::Result<PetState> { ... }
pub async fn get_pet_state(&self) -> anyhow::Result<PetState> { ... }
pub async fn log_trade(&self, ...) -> anyhow::Result<()> { ... }
// ... tất cả methods còn lại
```

4. Các Tauri commands gọi DB methods cũng phải `.await`:
```rust
db.update_pet_xp(xp_delta, tokens_delta, trades_delta).await
    .map_err(|e| e.to_string())?;
```

**Note:** Đây là refactor lớn nhất trong P1, nhưng thay đổi mechanical — search-replace là chính.

---

### P1-2 · Jupiter Quote Expiry Check

**File:** `src/components/token-detail/TradePanel.tsx`  
**Risk:** Quote 3 giây tuổi → sign → TX fail on-chain với "Quote not found"

**Steps:**

1. Store quote timestamp khi nhận:
```ts
type QuoteReady = {
  tag: 'ready'
  serializedTx: string
  outAmountUi: number
  quoteFetchedAt: number  // ← thêm field này
}
```

2. Trước khi send, validate:
```ts
const QUOTE_MAX_AGE_MS = 1500

async function handleBuy() {
  if (state.tag !== 'ready') return
  if (Date.now() - state.quoteFetchedAt > QUOTE_MAX_AGE_MS) {
    // Quote expired, re-fetch
    await fetchQuote()
    return  // user sẽ thấy quote mới và bấm lại
  }
  // ... proceed to sign
}
```

3. UI: show countdown timer (1.5s → 0 → "Refreshing...") trên BUY button khi quote active.

---

### P1-3 · Pipeline Supervision

**File:** `src-tauri/src/lib.rs`  
**Risk:** pumpportal connection chết → app tiếp tục chạy, không detect token, user không biết

**Steps:**

1. Wrap listener trong supervision loop:
```rust
tauri::async_runtime::spawn({
    let tx = tx1.clone();
    let app_handle = app.handle().clone();
    async move {
        loop {
            tracing::info!("Starting pumpportal listener...");
            if let Err(e) = detector::pumpportal::listen(tx.clone()).await {
                tracing::error!("Pumpportal listener died: {e}");
            }
            // Emit event để frontend biết
            let _ = app_handle.emit("detector_status", json!({ "status": "reconnecting" }));
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    }
});
```

2. Emit `detector_status` events: `"connected"` | `"reconnecting"` | `"error"`

3. Frontend: listen event, hiện badge trên header (xanh/vàng/đỏ) — minimal UI change.

---

### P1-4 · Merge `swap.rs` và `sell.rs`

**Files:** `src-tauri/src/commands/swap.rs`, `src-tauri/src/commands/sell.rs`  
**Risk:** Bug fix ở 1 file không fix file kia, drift theo thời gian

Logic 2 files giống nhau ~90%. Sự khác biệt duy nhất:
- Swap: SOL → Token (buy)
- Sell: Token → SOL (sell), có thêm `input_decimals` param

**Steps:**

1. Tạo `src-tauri/src/commands/trade.rs` với generic logic
2. Extract `build_jupiter_tx`, `build_kamino_tx` thành shared functions nhận `TradeDirection` enum:
```rust
pub enum TradeDirection { Buy, Sell }
```
3. Giữ lại `build_swap_transaction` và `build_sell_transaction` như thin wrappers để không break Tauri command names (frontend không cần thay đổi)
4. Delete duplicate code trong swap.rs và sell.rs

---

## P2 — Medium (backlog)

### P2-1 · localStorage → Zod Validation

**Files:** `src/components/token-feed/TokenRow.tsx`, `src/components/token-detail/TradePanel.tsx`

```ts
// Thêm schema:
import { z } from 'zod'

const TradeDefaultsSchema = z.object({
  defaultAmount: z.string().optional(),
  defaultMint: z.string().optional(),
}).catch({})  // fallback to empty object on parse error

// Usage:
const raw = localStorage.getItem('trade_defaults')
const defaults = raw ? TradeDefaultsSchema.parse(JSON.parse(raw)) : {}
```

---

### P2-2 · Pet Level Update Atomic

**File:** `src-tauri/src/commands/pet.rs`

Hiện tại: XP update → compute level in Rust → separate UPDATE for level. 2 round-trips.

Gộp vào 1 SQL:
```sql
UPDATE pet_state 
SET 
  xp = xp + ?1,
  total_tokens_seen = total_tokens_seen + ?2,
  total_trades = total_trades + ?3,
  level = CASE 
    WHEN xp + ?1 >= 2000 THEN 3
    WHEN xp + ?1 >= 500  THEN 2
    ELSE 1
  END
WHERE id = 1
```

Bỏ hoàn toàn level check logic trong Rust command.

---

### P2-3 · SPL Token Account Parsing Validation

**File:** `src-tauri/src/rpc.rs:32-40`

Thêm bounds check và owner validation:
```rust
// Validate data length (SPL Mint = 82 bytes)
if data.len() < 82 {
    return Err(anyhow::anyhow!("account too short for SPL Mint: {} bytes", data.len()));
}

// Validate owner is SPL Token program
const SPL_TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJsyFbPVwwQQfVepP8h";
if account.owner.to_string() != SPL_TOKEN_PROGRAM {
    return Err(anyhow::anyhow!("not an SPL token mint account"));
}
```

---

### P2-4 · Wallet Auto-Lock After Inactivity

**Files:** `src-tauri/src/wallet.rs`, `src/store/wallet.ts`

1. Backend: thêm `last_activity: Instant` vào `WalletState`, `get_wallet_status` trả về `locked` nếu `elapsed > INACTIVITY_TIMEOUT` (15 phút)
2. Frontend: `useEffect` với `setInterval` 60s gọi `get_wallet_status` → nếu locked redirect về unlock screen
3. Optional: reset timer khi user có mouse/keyboard event

---

### P2-5 · Detector Status UI

Phụ thuộc P1-3 (supervision events).

**File:** `src/components/layout/SideRail.tsx` hoặc Header

Thêm small indicator dot:
- 🟢 connected
- 🟡 reconnecting  
- 🔴 error (>3 attempts failed)

Listen `detector_status` event từ Rust.

---

### P2-6 · `restoreOpenPositions` PnL Initial Value

**File:** `src/store/portfolio.ts`

Hiện tại restore với `current_price_usd: entry_price_usd` → PnL = 0% sai.

Option A (quick): Fetch current price ngay sau restore cho từng position — invoke `get_spl_balances` hoặc price endpoint.

Option B (safer): Chấp nhận PnL = 0% khi khởi động, hiện spinner/placeholder cho đến khi price update đầu tiên đến. Thêm `priceLoaded: boolean` flag vào Position type.

---

## P3 — Low / Cleanup

### P3-1 · Extract Magic Numbers thành Config

**Files:** `src-tauri/src/enricher.rs`, `src/types/index.ts`

Tạo `src-tauri/src/config.rs`:
```rust
pub const PUMP_INIT_SOL: f64 = 30.0;      // Initial bonding curve SOL
pub const SCORE_DEV_HOLD_THRESHOLD: f64 = 5.0;  // Dev hold % threshold
pub const SOL_PRICE_CACHE_TTL_SECS: u64 = 30;
pub const PIPELINE_QUEUE_CAP: usize = 500;
pub const WATCHLIST_MAX_SIZE: usize = 100;
```

Frontend `src/constants.ts`:
```ts
export const QUOTE_MAX_AGE_MS = 1500
export const QUOTE_DEBOUNCE_MS = 600
export const SL_PRESET_OPTIONS = [10, 20, 30, 50, 70]
export const LEVEL_THRESHOLDS = { T1: 500, T2: 2000 }
```

---

### P3-2 · Pipeline Eviction Cleanup

**File:** `src-tauri/src/detector/pipeline.rs`

Khi evict token khỏi watchlist (line 49-56), đồng thời stop price tracking:
```rust
if let Some(oldest) = evicted_mint {
    // Stop price tracking for evicted token
    if let Some(tracker) = tracker_state.get() {
        tracker.unsubscribe(&oldest).await;
    }
    list.remove(&oldest);
}
```

Cần pass `PriceTracker` state vào pipeline hoặc emit event.

---

### P3-3 · `void persist()` trong Filter Store — Add Error Log

**File:** `src/store/filter.ts`

```ts
// Before:
void persist(next)

// After:
persist(next).catch((e) => console.error('[filter] persist failed:', e))
```

3 chỗ trong file cần update.

---

## Execution Order

```
Week 1 (P0 — Ship blockers):
  P0-4  → 5 min  (1 line fix, RPC error handling)
  P0-3  → 2h     (idempotency, DB + frontend)
  P0-2  → 30min  (SL emit order)
  P0-1  → 4h     (Argon2 + migration logic)

Week 2 (P1 — Core reliability):
  P1-1  → 4h     (tokio Mutex refactor — mechanical but wide)
  P1-4  → 2h     (merge swap/sell)
  P1-2  → 1h     (quote expiry)
  P1-3  → 1h     (pipeline supervision)

Week 3 (P2 — Polish):
  P2-2  → 1h     (atomic level update SQL)
  P2-3  → 30min  (SPL account validation)
  P2-1  → 1h     (Zod localStorage)
  P2-5  → 1h     (detector status UI, depends P1-3)
  P2-4  → 2h     (wallet auto-lock)
  P2-6  → 1h     (restore PnL placeholder)

Backlog (P3):
  P3-1, P3-2, P3-3  → cleanup khi có thời gian
```

---

## Done (already fixed)

- ✅ XP không persist → gộp `gainTokenXp`/`gainTradeXp` (1 invoke/event)
- ✅ `globalStopLossPct` không persist → save vào `sol-lens.settings.json`
- ✅ Silent error swallowing trong pet store → đổi sang `console.error`
