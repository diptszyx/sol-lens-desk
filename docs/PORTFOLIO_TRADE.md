# Portfolio + Trade — Design Document

**Last updated:** 2026-06-27  
**Status:** Discussed & agreed, pending implementation

---

## Current State (Gaps)

| Feature | Status | Note |
|---|---|---|
| Buy flow | ✅ Done | TradePanel + PetCard quick buy |
| Position tracking | ⚠️ Partial | `addPosition` works, but `pnl_pct` always null |
| Live price | ⚠️ Broken | Jupiter Price API poll 10s, but new tokens not indexed |
| Sell flow | ❌ Missing | No sell command, no sell UI |
| Stop loss | ❌ Missing | No monitoring, no auto-sell |
| Realized PnL | ❌ Missing | No closed_positions, no history |
| Trade history | ❌ Missing | No persistence beyond in-memory store |

---

## Price Architecture (New)

### Problem với Jupiter Price API polling
- Tokens mới trên bonding curve **chưa có** trên Jupiter Price API
- Poll 10s = quá chậm cho stop loss meme coin (price có thể rug trong 5s)

### Solution: pumpportal.fun `subscribeTokenTrade`

Khi user buy token → backend subscribe real-time trade events cho token đó:

```
pumpportal WS: { method: "subscribeTokenTrade", keys: ["<mint>"] }

Trade event trả về:
  v_sol_in_bonding_curve  → SOL trong curve
  v_tokens_in_bonding_curve → tokens còn trong curve
  market_cap_sol
  tx_type: "buy" | "sell"
  trader_public_key
```

Price tính từ mỗi event:
```
price_sol = v_sol / v_tokens
price_usd = price_sol * sol_price_usd   ← cần live SOL price
```

**Kết quả:** Price update real-time theo từng transaction, không cần poll.

### SOL/USD Price (Fix hardcoded 150.0)

Hiện tại `SOL_USD_APPROX = 150.0` hardcoded trong `enricher.rs`.

Fix: Fetch từ Jupiter Price API cho SOL mint (`So11111111111111111111111111111111111111112`), cache 30s.

### Post-graduation Fallback

Khi token graduate lên Raydium, pumpportal WS không còn trade events.  
Fallback: `usePricePoll` (Jupiter Price API, 10s interval) — đã có sẵn.

```
Token on bonding curve → subscribeTokenTrade (real-time)
Token graduated Raydium → Jupiter Price API poll (10s)
```

---

## Database (SQLite)

Dùng `tauri-plugin-sql` với SQLite local. Không cần server.

### Schema

```sql
-- Lịch sử tất cả transactions
CREATE TABLE trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mint        TEXT    NOT NULL,
    symbol      TEXT    NOT NULL,
    side        TEXT    NOT NULL CHECK(side IN ('buy', 'sell')),
    amount_sol  REAL    NOT NULL,
    amount_tokens REAL  NOT NULL,
    price_usd   REAL,
    tx_signature TEXT   NOT NULL,
    status      TEXT    NOT NULL CHECK(status IN ('confirmed', 'failed')),
    created_at  INTEGER NOT NULL  -- unix ms
);

-- Positions đã đóng (để tính realized PnL + history)
CREATE TABLE closed_positions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    mint                TEXT    NOT NULL,
    symbol              TEXT    NOT NULL,
    entry_price_usd     REAL    NOT NULL,
    exit_price_usd      REAL    NOT NULL,
    amount_sol_spent    REAL    NOT NULL,
    amount_sol_received REAL    NOT NULL,
    realized_pnl_usd    REAL    NOT NULL,
    realized_pnl_pct    REAL    NOT NULL,
    opened_at           INTEGER NOT NULL,  -- unix ms
    closed_at           INTEGER NOT NULL,  -- unix ms
    close_reason        TEXT    NOT NULL CHECK(close_reason IN ('manual', 'stop_loss'))
);
```

### Open Positions
Giữ trong Zustand (fast access, không cần persist — app restart = re-sync từ wallet balance).  
→ Khi close position: persist vào `closed_positions` → remove khỏi Zustand.

---

## Stop Loss

### Scope
- Global default: áp dụng cho mọi position mới
- Per-position override: user có thể chỉnh riêng

### Default value
`-50%` (mất 50% entry price → auto sell)

### Trigger mechanism (Backend Rust)

Backend nhận price update từ `subscribeTokenTrade` event:

```rust
fn check_stop_loss(position: &Position, current_price: f64, sl_pct: f64) -> bool {
    let threshold = position.entry_price_usd * (1.0 - sl_pct / 100.0);
    current_price <= threshold
}
```

Nếu trigger:
1. Build sell transaction (Jupiter + Kamino parallel, same as buy)
2. Sign + send
3. Emit `position_closed` event → frontend
4. Persist vào `closed_positions` với `close_reason: "stop_loss"`
5. Remove khỏi open positions
6. Toast notification + pet reaction

### Sell = 100% position (no partial)

---

## Sell Flow

### Manual sell (user click SELL button)
```
User click SELL
  → build_sell_transaction (swap: token → SOL)
     ↓ parallel: Jupiter quote + Kamino quote
     ↓ pick best out_amount (SOL received)
  → sign_transaction
  → send_transaction
  → on confirmed:
     → log to trades table (side: 'sell')
     → calculate realized_pnl
     → persist to closed_positions
     → remove from open positions (Zustand)
     → toast: "Sold $SYMBOL +X% | -X%"
     → pet reaction
```

### Auto sell (stop loss trigger)
Same flow, triggered by backend instead of user click.  
`close_reason: "stop_loss"` thay vì `"manual"`.

---

## UI Changes

### PortfolioPanel

```
┌─────────────────────────────────────────────┐
│ Portfolio          Default SL: [-50%] ▼     │ ← global SL setting
├─────────────────────────────────────────────┤
│ $PEPE                                        │
│ Entry $0.0012 → Now $0.0008  PnL: -33% 🔴  │
│ SL: -50% ✏                      [SELL]      │ ← per-position override + sell btn
├─────────────────────────────────────────────┤
│ $DOGE                                        │
│ Entry $0.15   → Now $0.18    PnL: +20% 🟢  │
│ SL: -40% ✏                      [SELL]      │
└─────────────────────────────────────────────┘
```

- Global SL: dropdown/stepper ở header (options: -20%, -30%, -50%, -70%, custom)
- Per-position: inherits global khi create, click ✏ để edit inline
- PnL color: green nếu > 0, red nếu < 0
- SELL button: luôn hiển thị, click → confirm dialog → execute

### PetCard (Overlay)

- Show **ngay** khi nhận `token_detected` event (không cần hover)
- Auto-dismiss sau **10 giây** nếu không tương tác
- Bị **replace** nếu token mới arrive trong 10s window
- User có thể set dismiss timer (sau này)

---

## Backend Architecture

### Mới cần thêm

```
src-tauri/src/
├── price_tracker.rs    ← manage subscribeTokenTrade per held mint
│                          emit price_updated events
│                          check stop loss on each price tick
├── commands/
│   └── sell.rs         ← build_sell_transaction (mirror of swap.rs buy logic)
└── db.rs               ← SQLite setup, trade/position persistence
```

### price_tracker.rs logic

```rust
// Khi user buy → gọi
pub fn subscribe_token(mint: &str)

// Khi position closed → gọi  
pub fn unsubscribe_token(mint: &str)

// Mỗi trade event đến:
// 1. Tính price từ v_sol/v_tokens
// 2. Emit price_updated { mint, price_usd, market_cap_usd }
// 3. Check stop loss cho position đang hold mint này
// 4. Nếu SL hit → trigger auto sell
```

---

## Data Flow Summary

```
[Buy confirmed]
  → addPosition (Zustand)
  → log trade (SQLite: side='buy')
  → subscribe_token(mint) → pumpportal WS

[Trade event arrives for held mint]
  → recalc price
  → emit price_updated → frontend updatePrices()
  → check SL threshold
    → SL hit → build_sell_transaction → sign → send
               → on confirmed: persist closed_position
                               unsubscribe_token
                               removePosition (Zustand)
                               emit position_closed

[Manual SELL click]
  → same sell flow, close_reason = 'manual'

[Token graduates Raydium]
  → pumpportal WS stops sending trade events
  → usePricePoll (Jupiter 10s) takes over automatically
  → SL monitoring switches to frontend check on each poll
```

---

## Open Issues / TODOs

| # | Issue | Priority |
|---|---|---|
| 1 | `SOL_USD_APPROX = 150.0` hardcoded | 🔴 Fix before ship |
| 2 | Detect graduation (bonding curve = 100%) → switch price source | 🟡 Needed for post-grad positions |
| 3 | SL monitoring post-graduation (Jupiter poll based) | 🟡 After graduation detection |
| 4 | Confirm dialog before SELL (prevent fat-finger) | 🟢 Nice to have |
| 5 | Performance stats panel (win rate, total realized PnL) | 🟢 Phase 2 |
