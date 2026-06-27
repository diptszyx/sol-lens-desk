# P3: Portfolio + Trade

**Depends on:** P1 (T1.1 SOL price, T1.5 SQLite)  
**Ref:** [PORTFOLIO_TRADE.md](../PORTFOLIO_TRADE.md)

---

## T3.1 — db.rs: Trade Persistence Functions

**Files:** `src-tauri/src/db.rs`

**What to do:**

Thêm các functions sau vào `db.rs` (schema đã tạo ở P1.5):

```rust
pub async fn log_trade(db: &Pool<Sqlite>, trade: &Trade) -> anyhow::Result<i64>
pub async fn close_position(db: &Pool<Sqlite>, pos: &ClosedPosition) -> anyhow::Result<()>
pub async fn get_closed_positions(db: &Pool<Sqlite>) -> anyhow::Result<Vec<ClosedPosition>>
pub async fn get_trade_history(db: &Pool<Sqlite>, mint: &str) -> anyhow::Result<Vec<Trade>>

pub async fn get_pet_state(db: &Pool<Sqlite>) -> anyhow::Result<PetState>
pub async fn update_pet_xp(db: &Pool<Sqlite>, xp_delta: i64) -> anyhow::Result<()>
```

Expose `db: Pool<Sqlite>` qua Tauri state.

---

## T3.2 — price_tracker.rs (New File)

**Files:** `src-tauri/src/price_tracker.rs` (tạo mới), `src-tauri/src/lib.rs`

**What to do:**

```rust
pub struct PriceTracker {
    subscribed_mints: HashSet<String>,
    ws_tx: mpsc::Sender<PumpportalMessage>,  // reuse existing WS connection
    app: AppHandle,
}

impl PriceTracker {
    pub fn subscribe(&mut self, mint: &str, stop_loss_pct: f64, entry_price_usd: f64)
    pub fn unsubscribe(&mut self, mint: &str)
    // Called on each trade event for subscribed mints:
    fn on_trade_event(&self, event: TradeEvent)
        // 1. price_sol = v_sol / v_tokens
        // 2. price_usd = price_sol * sol_price (reuse T1.1 cache)
        // 3. emit "price_updated" { mint, price_usd, market_cap_usd }
        // 4. check_stop_loss(entry_price_usd, price_usd, stop_loss_pct)
        //    → if triggered: trigger auto-sell flow
}
```

**pumpportal.rs integration:**

Cần extend pumpportal WS để handle `subscribeTokenTrade` subscription alongside existing `subscribeNewToken`. Best approach: share single WS connection, route messages bằng `tx_type` field.

---

## T3.3 — commands/sell.rs (New File)

**Files:** `src-tauri/src/commands/sell.rs` (tạo mới), `src-tauri/src/commands/mod.rs`

**What to do:**

Mirror của `swap.rs` nhưng direction ngược lại (token → SOL):

```rust
pub struct SellParams {
    pub input_mint: String,        // token mint
    pub amount_tokens: u64,        // token amount (100% position)
    pub slippage_bps: u32,
    pub user_public_key: String,
    pub input_decimals: u8,
}

#[tauri::command]
pub async fn build_sell_transaction(params: SellParams) -> Result<BuildTxResult, String>
```

Same parallel Jupiter + Kamino logic, pick best SOL out_amount. Register command trong `lib.rs`.

---

## T3.4 — Stop Loss Monitoring

**Files:** `src-tauri/src/price_tracker.rs`

**What to do:**

Trong `on_trade_event()`:

```rust
fn check_stop_loss(
    entry_price: f64,
    current_price: f64,
    sl_pct: f64,  // e.g. 50.0 for -50%
) -> bool {
    let threshold = entry_price * (1.0 - sl_pct / 100.0);
    current_price <= threshold
}
```

Nếu SL triggered:
1. Call `build_sell_transaction()` internally
2. Sign + send (cần access WalletState)
3. Emit `position_closed { mint, reason: "stop_loss", pnl_pct }`
4. Log to SQLite (`db::close_position`)
5. Call `self.unsubscribe(mint)`

**Note:** Cần WalletState unlocked để sign. Nếu wallet locked → emit `sl_failed { mint, reason: "wallet_locked" }` → frontend hiển thị warning.

---

## T3.5 — Backend Events (Buy + Sell)

**Files:** `src-tauri/src/commands/swap.rs`, `src-tauri/src/commands/sell.rs`

**What to do:**

Sau khi buy confirmed → emit `buy_confirmed`:
```rust
app.emit("buy_confirmed", json!({
    "mint": params.output_mint,
    "amount_sol": params.amount_lamports as f64 / 1e9,
    "amount_tokens": result.out_amount_ui,
    "entry_price_usd": current_price_usd,
    "tx_signature": sig,
}))
```

Sau khi sell confirmed → emit `position_closed`:
```rust
app.emit("position_closed", json!({
    "mint": params.input_mint,
    "close_reason": "manual" | "stop_loss",
    "exit_price_usd": exit_price,
    "realized_pnl_pct": pnl_pct,
}))
```

---

## T3.6 — Portfolio Store Update

**Files:** `src/store/portfolio.ts`

**What to do:**

Thêm vào `Position`:
```typescript
stop_loss_pct: number          // per-position override, inherits global
```

Thêm vào store:
```typescript
globalStopLossPct: number      // default 50
setGlobalStopLoss(pct: number): void
setPositionStopLoss(mint: string, pct: number): void
removePosition(mint: string): void
```

Listen events:
```typescript
listen('buy_confirmed', ...)   → addPosition
listen('price_updated', ...)   → updatePositionPrice
listen('position_closed', ...) → removePosition + log to history
```

---

## T3.7 — PortfolioPanel UI

**Files:** `src/components/portfolio/PortfolioPanel.tsx`

**What to do:**

Theo mockup trong [PORTFOLIO_TRADE.md](../PORTFOLIO_TRADE.md):

```
┌─────────────────────────────────────────────┐
│ Portfolio         Default SL: [-50%] ▼       │
├─────────────────────────────────────────────┤
│ $PEPE                                        │
│ Entry $0.0012 → Now $0.0008  PnL: -33% 🔴  │
│ SL: -50% ✏                      [SELL]      │
├─────────────────────────────────────────────┤
│ $DOGE                                        │
│ Entry $0.15   → Now $0.18    PnL: +20% 🟢  │
│ SL: -40% ✏                      [SELL]      │
└─────────────────────────────────────────────┘
```

- Global SL: dropdown header (options: -20, -30, -50, -70, custom)
- Per-position SL: inline edit (click ✏ → input field)
- SELL button: confirm dialog → invoke `build_sell_transaction` → `send_transaction`
- PnL: green nếu > 0, red nếu < 0

---

## T3.8 — usePricePoll Retirement (Pre-grad Tokens)

**Files:** `src/hooks/usePricePoll.ts`

**What to do:**

Hiện tại poll Jupiter mọi 10s. Cần phân biệt:
- Pre-graduation tokens → dùng `price_tracker` events (real-time từ WS)
- Post-graduation tokens → vẫn Jupiter poll 10s

Logic: nếu token có `bonding_curve_pct < 100` → skip khỏi Jupiter poll batch (đã có từ WS). Nếu `bonding_curve_pct >= 100` (hoặc null vì đã graduate) → giữ trong poll batch.

---

## Checklist P3

- [ ] T3.1: db.rs có log_trade, close_position, get history functions
- [ ] T3.2: price_tracker.rs subscribe/unsubscribe per mint, emit price_updated
- [ ] T3.3: sell.rs build_sell_transaction (token→SOL, parallel Jupiter+Kamino)
- [ ] T3.4: Stop loss check on every price_updated, auto-sell triggers correctly
- [ ] T3.5: buy_confirmed + position_closed events emitted from backend
- [ ] T3.6: portfolio store listens to events, has globalStopLossPct
- [ ] T3.7: PortfolioPanel có SELL button, SL override, live PnL colors
- [ ] T3.8: Pre-grad tokens use WS price, post-grad use Jupiter poll
- [ ] Test: Manual sell → trade logged → position removed
- [ ] Test: Price drops to SL → auto sell → position_closed emitted
