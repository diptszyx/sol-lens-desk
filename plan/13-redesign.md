# Plan 13 — Redesign & Missing Features

## Context

App hiện tại functional nhưng có nhiều vấn đề về UX và thiếu feature quan trọng cho meme Solana trader thực sự.
Phase này fix toàn bộ theo thứ tự priority.

---

## Issues map

| ID | Severity | Issue |
|----|----------|-------|
| R1 | 🔴 CRITICAL | Position không persist qua restart — mất hết khi đóng app |
| R2 | 🔴 CRITICAL | Filter bị chôn trong Wallet tab, không accessible khi ở Feed |
| R3 | 🔴 HIGH | Layout 2-column + tabs — feed mất khi xem detail, portfolio không visible |
| R4 | 🔴 HIGH | "Disconnect" button thực ra là Lock — label sai, user sợ bấm |
| R5 | 🔴 HIGH | Wallet address + balance không visible khi ở Feed tab |
| R6 | 🟡 MID | Position cards quá nhỏ, thiếu thông tin |
| R7 | 🟡 MID | Không có price chart — trader cần thấy price action |
| R8 | 🟡 MID | Score breakdown ẩn — user không hiểu score 65 từ đâu ra |
| R9 | 🟡 MID | Chỉ show SOL balance, thiếu SPL token balances |
| R10 | 🟡 MID | "Trade with" hardcoded SOL, không hỗ trợ USDC/USDT |
| R11 | 🟢 NICE | Visual generic — không có identity, không feel như trading tool |

---

## Phase 1 — Critical fixes (không cần redesign layout)

### R1: Position persistence

**Vấn đề:** Positions chỉ sống trong Zustand. Restart app = mất hết. Price tracker không biết cần theo dõi gì. SL không trigger.

**Rust — thêm `open_positions` table vào SQLite:**

```rust
// db.rs — thêm struct + methods

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenPosition {
    pub mint: String,
    pub symbol: String,
    pub decimals: i64,
    pub entry_price_usd: f64,
    pub amount_tokens: f64,
    pub amount_sol_spent: f64,
    pub stop_loss_pct: f64,
    pub opened_at: i64,
    pub tx_signature: String,
}

// CREATE TABLE open_positions (
//   mint TEXT PRIMARY KEY,
//   symbol TEXT NOT NULL,
//   decimals INTEGER NOT NULL,
//   entry_price_usd REAL NOT NULL,
//   amount_tokens REAL NOT NULL,
//   amount_sol_spent REAL NOT NULL,
//   stop_loss_pct REAL NOT NULL,
//   opened_at INTEGER NOT NULL,
//   tx_signature TEXT NOT NULL
// );

impl DbPool {
    pub fn upsert_open_position(&self, p: &OpenPosition) -> anyhow::Result<()>
    pub fn delete_open_position(&self, mint: &str) -> anyhow::Result<()>
    pub fn get_open_positions(&self) -> anyhow::Result<Vec<OpenPosition>>
}
```

**Rust — thêm commands:**

```rust
// commands/positions.rs (file mới)
pub async fn get_open_positions(db: State<DbPool>) -> Result<Vec<OpenPosition>, String>
pub async fn save_open_position(db: State<DbPool>, position: OpenPosition) -> Result<(), String>
pub async fn remove_open_position(db: State<DbPool>, mint: String) -> Result<(), String>
```

**Frontend — portfolio store:**

- Khi `buy_confirmed` → gọi `save_open_position` vào DB
- Khi `position_closed` / `sl_triggered` → gọi `remove_open_position`
- App startup → `get_open_positions` → restore vào store → restart `start_price_tracking` cho từng mint

**Acceptance:**
- [ ] Mua token, đóng app, mở lại → position vẫn còn
- [ ] Price tracking tự resume sau restart
- [ ] SL vẫn trigger sau restart

---

### R2: Filter trong Feed

**Vấn đề:** Filter panel nằm trong Wallet tab. Khi ở Feed không có cách chỉnh filter nhanh.

**Fix:**

- Thêm filter icon button (⚙ hoặc sliders icon) trong Feed header bar
- Click toggle `showFilter` state → FilterPanel slide down trong feed column
- WalletTab xóa phần Filters (chỉ giữ Wallet + Positions + History)

```
Feed column
├── [Header: "12 / 48 tokens"  [⚙ Filters]]
├── [FilterPanel — collapsible]          ← NEW
└── [TokenFeed list]
```

---

## Phase 2 — Layout overhaul (R3, R4, R5)

### Layout mới: 3 columns, no tabs

```
┌─────────────────────────────────────────────────────────────────────┐
│ ◎ Sol Lens  ALPHA                          [🐻 1]  [2Yqap...4jSTVf ▾] [Lock] │
├──────────────┬──────────────────────────────┬──────────────────────┤
│  FEED        │  TOKEN DETAIL                │  PORTFOLIO           │
│  280px       │  flex-1                      │  300px               │
│              │                              │                      │
│  [⚙] 12/48  │  $SYMBOL  pump_fun  2m ago   │  2Yqap...4jSTVf      │
│  ──────────  │  $0.000042                   │  2.4521 ◎            │
│  TokenRow    │                              │  ─────────────────── │
│  TokenRow    │  Liq / MC / Holders / Score  │  OPEN (2)   +$45.20  │
│  TokenRow    │                              │  PositionCard        │
│  TokenRow    │  [Score breakdown ▾]         │  PositionCard        │
│  ...         │                              │  ─────────────────── │
│              │  [Chart]                     │  HISTORY  7W/3L      │
│              │                              │  HistoryRow          │
│              │  [TradePanel]                │  HistoryRow          │
└──────────────┴──────────────────────────────┴──────────────────────┘
```

**Changes:**

- `App.tsx`: bỏ `SideTab` state, bỏ FEED/WALLET tab buttons
- Left column (280px): Feed + collapsible FilterPanel
- Center column (flex-1): TokenDetail + TradePanel (unchanged)
- Right column (300px): Portfolio column (mới)
- Header: bỏ "Export" + "Disconnect", thêm wallet dropdown + "Lock" button

**Header wallet dropdown:**
```
[2Yqap...4jSTVf ▾]
  ↓ click
┌─────────────────────┐
│ 2YqapC...4jSTVf     │
│ 2.4521 ◎  $412 USD  │
│ ─────────────────── │
│ Copy address        │
│ Export wallet       │
│ Use different wallet│
│ ─────────────────── │
│ Lock                │
└─────────────────────┘
```

**R4 fix:** "Disconnect" → "Lock" (ở trong dropdown, không phải standalone button)

**R5 fix:** Wallet info luôn visible trong right column header + header dropdown

---

## Phase 3 — Portfolio column (R6)

### Position cards

```
┌─────────────────────────────┐
│ $PEPE              +50.2% 🟢│
│ Entry $0.0000042            │
│ Now   $0.0000063   +$21.50  │
│ SL -30%  [Edit]  [SELL]     │
└─────────────────────────────┘
```

Show đầy đủ: symbol, entry price, current price, PnL %, PnL USD, SL%, edit SL, SELL button.

---

## Phase 4 — Trading features (R7, R8, R9, R10)

### R7: Price chart

- Library: `lightweight-charts` (TradingView)
- Data source: DexScreener `GET /dex/pairs/solana/{pairAddress}` → OHLCV
- Show trong Detail column, giữa stats grid và TradePanel
- Timeframes: 1m, 5m, 15m
- Fallback: "Chart not available" nếu pair chưa indexing

### R8: Score breakdown

```
Score: 65  [▾ details]
  ↓ expand
  dev_hold < 5%     +30 ✓
  bonding 30-50%    +25 ✓
  dev_buy ≥ 1 SOL   +15 ✗ (dev bought 0.3 SOL)
  has_socials       +10 ✓ (twitter detected)
  dev_hold < 10%    skipped (already got +30)
```

Cần pass score components từ Rust enricher → TokenInfo → Frontend.

**Rust enricher** cần trả thêm:
```rust
pub struct ScoreBreakdown {
    pub dev_hold_safety: u32,      // 0, 15, or 30
    pub bonding_curve_signal: u32, // 0 or 25
    pub dev_buy_signal: u32,       // 0 or 15
    pub socials_signal: u32,       // 0 or 10
}
```

### R9: SPL token balances

- `getTokenAccountsByOwner` RPC call khi wallet unlocked
- Show top 5 tokens by amount trong Portfolio column dưới SOL balance
- Refresh mỗi 30s hoặc sau mỗi swap

### R10: Trade with selector

```
You pay: [SOL ▾]  0.1
         SOL
         USDC
         USDT
         (tokens from wallet)
```

- Khi chọn USDC/USDT: convert amount sang lamports của token đó
- `build_swap_transaction` input_mint thay vì hardcode SOL mint

---

## Phase 5 — Visual overhaul (R11)

### Direction: Dense terminal

Reference: Photon, BullX — data-dense, dark, monospace.

**Color tokens (cập nhật `tokens.css`):**
```css
--bg-deep:    #080810;   /* near-black, blue tint */
--bg-base:    #0c0c18;
--bg-surface: #10101f;
--bg-elevated:#16162a;
--border:     #1e1e35;
--border-strong: #2a2a45;
--text-1:     #f0f0ff;   /* brighter white */
--text-2:     #8888aa;
--text-3:     #44445a;
--accent:     #00ff88;   /* brighter green */
```

**Typography:**
- Numbers: `font-mono` everywhere, không dùng font proportional cho số
- PnL: minimum `text-base font-bold`, không nhỏ hơn
- Labels: `text-[10px] uppercase tracking-widest` giữ nguyên

**Spacing:**
- Tighter: padding cards từ `p-4` → `p-3` / `p-2.5`
- Borders rõ hơn để phân tách sections

---

## Execution order

```
Phase 1A: R1 Position persist     ← LÀMNGAY
Phase 1B: R2 Filter in feed       ← LÀMNGAY
Phase 2:  R3+R4+R5 Layout 3-col   ← sau P1 xong
Phase 3:  R6 Position cards       ← cùng P2
Phase 4A: R7 Price chart          ← sau layout stable
Phase 4B: R8 Score breakdown      ← nhỏ, làm cùng R7
Phase 4C: R9 SPL balances         ← sau R7
Phase 4D: R10 Trade with selector ← sau R9
Phase 5:  R11 Visual overhaul     ← sau tất cả features xong
```

---

## Files sẽ thay đổi

### Phase 1A (R1)
- `src-tauri/src/db.rs` — thêm `OpenPosition` struct + table + methods
- `src-tauri/src/commands/mod.rs` — register module mới
- `src-tauri/src/commands/positions.rs` — NEW: 3 commands
- `src-tauri/src/lib.rs` — register commands, load positions on startup
- `src/store/portfolio.ts` — persist to DB on buy/close, load on init

### Phase 1B (R2)
- `src/components/token-feed/TokenFeed.tsx` — thêm filter toggle
- `src/components/wallet/WalletTab.tsx` — xóa Filters section

### Phase 2 (R3+R4+R5)
- `src/App.tsx` — bỏ tabs, 3-column layout, wallet dropdown
- `src/components/wallet/WalletDropdown.tsx` — NEW
- `src/components/wallet/WalletTab.tsx` — deprecated hoặc slim down
- `src/components/portfolio/PortfolioColumn.tsx` — NEW (merge positions + history)

### Phase 4A (R7)
- `src/components/token-detail/PriceChart.tsx` — NEW
- `src/components/token-detail/TradePanel.tsx` — tích hợp chart

### Phase 4B (R8)
- `src-tauri/src/enricher.rs` — thêm `ScoreBreakdown` vào `TokenInfo`
- `src/components/token-detail/ScoreBreakdown.tsx` — NEW
- `src/types/index.ts` — thêm `score_breakdown` field

### Phase 5 (R11)
- `src/styles/tokens.css` — update color tokens
- Multiple components — tighten spacing, typography
