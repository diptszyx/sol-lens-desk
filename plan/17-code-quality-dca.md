# Plan 17 — Code Quality, Duplicate Logic, và DCA Position Merge

Audit date: 2026-06-30. Continuation of plan 16.

---

## Data Persistence Audit (restart safety)

Kiểm tra toàn bộ state có bị mất khi restart không:

| Data | Nơi lưu | Cách restore | Trạng thái |
|------|----------|--------------|------------|
| XP, level, pet stats | SQLite `pet_state` | `loadFromDb()` trong Dashboard useEffect | ✅ OK (đã fix ở plan 16) |
| Open positions | SQLite `open_positions` | `restoreOpenPositions()` trong Dashboard useEffect | ✅ OK |
| globalStopLossPct | `sol-lens.settings.json` | `loadGlobalSl()` trong Dashboard useEffect | ✅ OK (đã fix ở plan 16) |
| Filter settings | `sol-lens.settings.json` | `filter.hydrate()` trong TokenFeed, PetDrawer, PetApp | ✅ OK (gọi nhiều lần nhưng idempotent) |
| Closed positions history | SQLite `closed_positions` | On-demand qua `get_closed_positions` | ✅ OK |
| Trade log (raw) | SQLite `trades` | Không surface ra UI | ✅ Lưu đúng, nhưng xem phần B1 |
| Wallet | `wallet.json` encrypted | User nhập lại password | ✅ OK |
| Token feed | Zustand only | Không restore (live data) | ✅ Intentional |

**Kết luận:** Không còn bug mất data khi restart. Tất cả critical state đã được persist đúng chỗ.

---

## Bugs và Trùng Lặp Tìm Thấy

### A1 · 🔴 HIGH — `handleSell` copy-paste 100% ở 2 file

**Files:** `src/App.tsx:187` và `src/components/portfolio/PortfolioSurface.tsx:91`

Code giống hệt nhau hoàn toàn:
```
build_sell_transaction → sign_transaction → send_sell_transaction
→ log_trade → stop_price_tracking → emit('position_closed')
```

Nếu fix bug ở một chỗ, chỗ kia vẫn còn. Risk thực tế: đã xảy ra khi cần sync logic.

**Fix:** Extract thành `src/hooks/useHandleSell.ts`:

```ts
// src/hooks/useHandleSell.ts
export function useHandleSell() {
  const address = useWalletStore((s) => s.address)
  const [selling, setSelling] = useState<string | null>(null)

  async function handleSell(mint: string, amountTokens: number, decimals: number) {
    if (!address || selling) return
    setSelling(mint)
    try {
      const amountRaw = Math.floor(amountTokens * Math.pow(10, decimals))
      const quote = await invoke<{ serialized_tx: string; out_amount_ui: number }>(
        'build_sell_transaction',
        { params: { input_mint: mint, amount_tokens: amountRaw, slippage_bps: 100, user_public_key: address, input_decimals: decimals } }
      )
      const signedTxBase64 = await invoke<string>('sign_transaction', { txBase64: quote.serialized_tx })
      const txResult = await invoke<{ signature: string; status: string }>('send_sell_transaction', { signedTxBase64 })

      if (txResult.status === 'confirmed') {
        const pos = usePortfolioStore.getState().positions.find((p) => p.mint === mint)
        invoke('log_trade', {
          mint, symbol: pos?.symbol ?? mint.slice(0, 6), side: 'sell',
          amountSol: quote.out_amount_ui, amountTokens, priceUsd: pos?.current_price_usd ?? null,
          txSignature: txResult.signature, status: 'confirmed', createdAt: Date.now(),
        }).catch(console.error)
        invoke('stop_price_tracking', { mint }).catch(console.error)
        const { emit } = await import('@tauri-apps/api/event')
        emit('position_closed', {
          mint, close_reason: 'manual',
          exit_price_usd: pos?.current_price_usd ?? 0,
          realized_pnl_pct: pos?.pnl_pct ?? 0,
        })
      }
    } catch (err) {
      console.error('Sell failed:', err)
    } finally {
      setSelling(null)
    }
  }

  return { handleSell, selling }
}
```

Sau đó xóa `handleSell` + `selling` state trong cả 2 file, thay bằng:
```ts
const { handleSell, selling } = useHandleSell()
```

---

### A2 · 🔴 HIGH — DCA: mua token lần 2 bị drop hoàn toàn (silent data loss)

**File:** `src/store/portfolio.ts`

`buy_confirmed` listener có guard:
```ts
if (state.positions.some((p) => p.mint === mint)) return  // return early!
```

Khi user mua token A lần 2:
1. `buy_confirmed` fires với data của lần mua thứ 2
2. Guard trả về ngay → không gọi `addPosition`, không gọi `log_trade`, không gọi `save_open_position`
3. Lần mua thứ 2 **biến mất hoàn toàn**: không hiện trên UI, không lưu DB, không tính vào PnL
4. Position hiển thị vẫn dùng data lần mua 1 — PnL tính sai

**Góc nhìn trader meme coin:** DCA hiếm nhưng xảy ra khi: snipe failed/retry, mua thêm khi FOMO pump. Silent drop là unacceptable — người dùng thấy trade đã executed on-chain nhưng app không ghi nhận.

**Fix:** Merge vào position hiện có với blended entry price thay vì drop.

Trong `buy_confirmed` listener, thay đoạn guard bằng:

```ts
listen<{...}>('buy_confirmed', (e) => {
  const { mint, symbol, decimals, amount_sol, amount_tokens, entry_price_usd, tx_signature } = e.payload
  const state = usePortfolioStore.getState()
  const openedAt = Date.now()
  const existing = state.positions.find((p) => p.mint === mint)

  if (existing) {
    // DCA: merge vào position hiện có với blended entry price
    const totalSol = existing.amount_sol_spent + amount_sol
    const totalTokens = existing.amount_tokens + amount_tokens
    const blendedEntry = totalSol / totalTokens  // blended entry tính bằng SOL-per-token

    // Blended entry price USD = totalSol_spent / totalTokens (xấp xỉ)
    const blendedEntryUsd = (existing.entry_price_usd * existing.amount_tokens + entry_price_usd * amount_tokens) / totalTokens

    usePortfolioStore.setState((s) => ({
      positions: s.positions.map((p) =>
        p.mint === mint
          ? { ...p, amount_tokens: totalTokens, amount_sol_spent: totalSol, entry_price_usd: blendedEntryUsd }
          : p
      ),
    }))

    // Vẫn log trade (raw tx record)
    invoke('log_trade', {
      mint, symbol, side: 'buy', amountSol: amount_sol, amountTokens: amount_tokens,
      priceUsd: entry_price_usd, txSignature: tx_signature, status: 'confirmed', createdAt: openedAt,
    }).catch(console.error)

    // Update DB position với data mới
    invoke('save_open_position', {
      position: { mint, symbol, decimals, entry_price_usd: blendedEntryUsd, amount_tokens: totalTokens, amount_sol_spent: totalSol, stop_loss_pct: existing.stop_loss_pct, opened_at: existing.opened_at, tx_signature: existing.tx_signature },
    }).catch(console.error)

    return
  }

  // First buy — logic cũ giữ nguyên
  const stopLoss = state.globalStopLossPct
  state.addPosition({
    mint, symbol, decimals, entry_price_usd, amount_tokens,
    amount_sol_spent: amount_sol, current_price_usd: entry_price_usd,
    pnl_pct: 0, opened_at: openedAt, tx_signature, stop_loss_pct: stopLoss, priceLoaded: true,
  })
  invoke('log_trade', { mint, symbol, side: 'buy', amountSol: amount_sol, amountTokens: amount_tokens, priceUsd: entry_price_usd, txSignature: tx_signature, status: 'confirmed', createdAt: openedAt }).catch(console.error)
  invoke('save_open_position', { position: { mint, symbol, decimals, entry_price_usd, amount_tokens, amount_sol_spent: amount_sol, stop_loss_pct: stopLoss, opened_at: openedAt, tx_signature } }).catch(console.error)
})
```

---

### B1 · 🟡 MEDIUM — `trades` table là "dark data" + `get_trade_history` dead

**Files:** `src-tauri/src/commands/history.rs:71`, `src-tauri/src/db.rs:209`, `src-tauri/src/lib.rs`

**Tình trạng:**
- Bảng `trades` được write đầy đủ (buy + sell manual + sell SL)
- `get_trade_history` command được define nhưng **không register** trong `lib.rs` invoke_handler
- Không có UI nào gọi command này → data không thể đọc được từ app
- `HistoryPanel` dùng `get_closed_positions` (bảng riêng) — đây là màn hình history duy nhất

**Hai hướng:**

**Option A — Xóa (đơn giản hơn):**
- Xóa `get_trade_history` trong `history.rs`
- Xóa `get_trade_history` trong `db.rs`
- `trades` table vẫn giữ (là audit log cho idempotency check qua `tx_signature_exists`)
- Build sẽ hết warning

**Option B — Register + thêm UI (feature đầy đủ hơn):**
- Thêm `commands::history::get_trade_history` vào invoke_handler trong `lib.rs`
- Thêm tab "Raw Trades" vào `HistoryPanel.tsx` — hiện raw buy/sell per token
- Cho phép user xem toàn bộ transaction history (không chỉ closed positions)

**Recommendation:** **Option A** trước mắt. `trades` table giữ để `tx_signature_exists` hoạt động. Nếu sau này muốn làm màn hình raw history thì register lại. Hiện tại không có UI để làm có ý nghĩa.

**Fix Option A:**
```
1. Xóa function get_trade_history() trong src-tauri/src/commands/history.rs (lines 70-73)
2. Xóa method get_trade_history() trong src-tauri/src/db.rs (lines 209-234)
3. Không cần sửa lib.rs (đã không register sẵn)
4. cargo build → hết 2 warnings
```

---

### B2 · 🟡 MEDIUM — `restoreOpenPositions` truyền dead params

**File:** `src/store/portfolio.ts:308`

```ts
// Hiện tại — truyền 2 params thừa
invoke('start_price_tracking', {
  mint: p.mint,
  entry_price_usd: p.entry_price_usd,
  amount_tokens: p.amount_tokens,   // ← Rust không nhận
  decimals: p.decimals,              // ← Rust không nhận
  stop_loss_pct: p.stop_loss_pct,
}).catch(console.error)
```

Rust command `start_price_tracking` chỉ nhận `mint`, `entry_price_usd`, `stop_loss_pct`. Tauri silently ignore params thừa — không crash nhưng gây confusion.

**Fix:**
```ts
// Sau khi fix
invoke('start_price_tracking', {
  mint: p.mint,
  entry_price_usd: p.entry_price_usd,
  stop_loss_pct: p.stop_loss_pct,
}).catch(console.error)
```

---

### C1 · 🟢 LOW — `gainTradeXp` naming confusing

**File:** `src/store/pet.ts`

Hiện tại `gainTradeXp` được gọi cho cả:
- `buy_confirmed` → "vừa mua" → +10 XP
- `position_closed` → "vừa đóng vị thế" → +10 XP

Tên `gainTradeXp` không rõ đây là XP cho buy hay cho close. Nếu design có chủ ý là +10 per action (buy và close đều tính), thì nên:

**Fix (rename để rõ intent):**
```ts
// Thay gainTradeXp() bằng 2 hàm riêng:
gainBuyXp: async () => { /* +10 XP, totalTrades += 0 */ }   // called on buy_confirmed
gainCloseXp: async () => { /* +10 XP, totalTrades += 1 */ } // called on position_closed
```

Hoặc nếu muốn đơn giản hơn: giữ nguyên `gainTradeXp` nhưng chỉ gọi khi `position_closed` (close = trade xong). Bỏ call tại `buy_confirmed`. Trader "hoàn thành 1 trade" khi đóng, không phải khi mở.

**Note:** Đây là product decision, không chỉ là technical. Hỏi ý định trước khi sửa.

---

## Execution Order

```
Week 1:
  A1  → 1h   — Extract useHandleSell hook (HIGH, surgical)
  A2  → 2h   — DCA merge position (HIGH, logic change)
  B1  → 30m  — Xóa get_trade_history dead code (xóa < thêm)
  B2  → 5m   — Remove dead params (1 line change)

Week 2 (if agreed):
  C1  → 30m  — Rename/split gainTradeXp (product decision needed first)
```

---

## Persistence Summary (sau tất cả fixes)

Tất cả data quan trọng đã có nơi lưu và được restore đúng khi restart:

```
Restart app → Dashboard.useEffect chạy:
  ├── loadFromDb()        → XP, level, pet stats ← SQLite
  ├── restoreOpenPositions() → open positions   ← SQLite
  └── loadGlobalSl()     → SL % setting         ← sol-lens.settings.json

TokenFeed.useEffect chạy:
  └── filter.hydrate()   → filter settings       ← sol-lens.settings.json

On-demand:
  └── HistoryPanel       → closed positions      ← SQLite (get_closed_positions)
```

Không còn state quan trọng nào chỉ sống trong Zustand memory.
