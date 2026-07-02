# Plan 20 — Graduation Detection + Post-Grad Price Fallback

**Status:** Research xong, pending implementation
**Trigger:** `price_tracker.rs` tính giá từ `v_sol_in_curve`/`v_tokens_in_curve` qua PumpPortal WS (`subscribeTokenTrade`) — chỉ hoạt động khi token còn trên bonding curve. Token graduate (chuyển PumpSwap) giữa lúc user đang hold → PumpPortal ngừng bắn trade event cho mint đó → giá đứng yên vĩnh viễn từ thời điểm graduate, không có fallback nào thay thế.

---

## Vấn đề

`docs/PORTFOLIO_TRADE.md` (thiết kế cũ) đã note hướng fix này ("Token graduated → Jupiter Price API poll (10s) takes over") nhưng **chưa bao giờ implement** — `usePricePoll.ts` không tồn tại trong repo. Hiện tại:

```
Token pre-grad, đang hold → subscribeTokenTrade → price_tracker tính giá → emit price_updated   ✅ hoạt động
Token graduate giữa lúc hold → subscribeTokenTrade im lặng (không còn event) → không ai emit gì nữa   ❌ giá đứng yên mãi
```

Đây là case **user đang hold position, token graduate trong lúc đó** — không phải case mua token đã graduate sẵn (case đó khác, đã bail rõ ràng ở `pumpfun_direct.rs`).

---

## Cách biết token đã graduate

| Nguồn | Độ tin cậy | Dùng để |
|---|---|---|
| `BondingCurve.complete: bool` (offset 48, on-chain thật) | **Tuyệt đối** — chính program pump.fun flip field này lúc graduate | Quyết định logic (chuyển price source) |
| `TokenInfo.bonding_curve_pct` (enricher.rs, ước lượng từ WS stream) | Gần đúng, chỉ để hiển thị UI ("Curve: 41%") | Không dùng cho quyết định — không authoritative |

`pumpfun_direct.rs` đã có sẵn code đọc `complete` (dùng để chặn buy: `if curve.complete { bail!(...) }`) — tái dùng, không viết lại.

---

## Thiết kế

### 1. Detect graduation cho position đang hold

Thêm hàm nhẹ trong `pumpfun_direct.rs`:

```rust
pub async fn is_curve_complete(rpc_url: &str, mint: &Pubkey) -> anyhow::Result<bool>
```

Chỉ fetch account `bonding_curve` (không cần mint accounts như `fetch_curve_context` — không cần token_program/quote_decimals cho việc này), decode `complete` field, trả về bool. Rẻ, 1 RPC call.

**Trigger check:** định kỳ mỗi ~30s, check `is_curve_complete` cho **tất cả mint đang hold** (không phải tất cả token detect — chỉ position thật, số lượng nhỏ, chi phí RPC không đáng kể). Không cần cơ chế phức tạp (WS idle detection) cho v1 — số position hiếm khi nhiều, poll định kỳ đơn giản, đủ tốt.

### 2. Chuyển price source khi phát hiện graduate

Thêm state "price source" cho mỗi tracked position trong `price_tracker.rs`:

```rust
enum PriceSource {
    BondingCurve,   // hiện tại — tính từ v_sol/v_tokens qua WS
    JupiterPoll,     // sau graduate — poll Jupiter Price API
}
```

Khi `is_curve_complete` trả `true` cho 1 mint đang ở `BondingCurve` mode → chuyển sang `JupiterPoll`, bắt đầu poll interval 10s (khớp thiết kế cũ trong doc).

### 3. Poll Jupiter Price API

Endpoint: `https://api.jup.ag/price/v2?ids=<mint>` (hoặc tái dùng pattern `api.jup.ag/tokens/v2/search` đã có trong `enricher.rs::get_sol_price_usd()` — cùng 1 style, cheat sheet có sẵn, copy pattern không viết mới từ đầu). Trả `price_usd` trực tiếp cho mint đó — không cần tính gì thêm (khác bonding curve phải tự tính từ reserve).

Vẫn emit `price_updated` với **cùng shape hiện tại** (`{mint, price_usd, market_cap_usd}`) — frontend không cần đổi gì, không quan tâm price đến từ nguồn nào.

### 4. Dọn dẹp

- Khi mint chuyển sang `JupiterPoll`, không cần unsubscribe `subscribeTokenTrade` chủ động — PumpPortal tự nhiên không còn bắn event cho mint đó nữa (đã graduate), để nguyên harmless, không thêm phức tạp.
- Khi position đóng (`unsubscribe`, sell hết) → dọn cả 2 loại state (WS lẫn poll timer) như logic hiện tại đã làm.

---

## Files cần sửa

**Rust:**
- `src-tauri/src/commands/pumpfun_direct.rs` — thêm `is_curve_complete(rpc_url, mint) -> anyhow::Result<bool>` (tái dùng `BondingCurve::from_bytes`, `derive_pda`)
- `src-tauri/src/price_tracker.rs` — thêm `PriceSource` state per position, loop check graduation mỗi ~30s cho position đang `BondingCurve` mode, loop poll Jupiter mỗi 10s cho position ở `JupiterPoll` mode

**Frontend:** không đổi — `price_updated` event shape giữ nguyên, `store/portfolio.ts::updatePositionPrice` không cần biết nguồn giá.

**Docs:** update `docs/THIRD_PARTY_SERVICES.md` — mục Jupiter Price API đổi từ "Limitation: chưa index token pre-grad" (usage cũ ở `usePricePoll.ts` không tồn tại) sang usage thật: dùng cho position graduate giữa lúc hold.

---

## Rủi ro

1. Poll `is_curve_complete` mỗi 30s cho N position — chi phí RPC tuyến tính theo số position đang hold, không phải theo số token detect (nhỏ, chấp nhận được, không cần tối ưu thêm cho v1).
2. Cửa sổ trễ ~30s giữa lúc graduate thật và lúc bot phát hiện — trong khoảng đó giá vẫn đứng yên (chấp nhận được, ngắn hơn nhiều so với "đứng yên vĩnh viễn" như hiện tại).
3. Jupiter Price API rate limit nếu nhiều position graduate cùng lúc poll liên tục — chưa gặp nhưng nên log rõ nếu poll fail, không throw im lặng (theo tinh thần logging đã fix ở các bug trước).

---

## Việc cần làm

1. Implement `is_curve_complete` trong `pumpfun_direct.rs`
2. Thêm `PriceSource` enum + state tracking trong `price_tracker.rs`
3. Thêm loop check graduation (30s) cho position ở `BondingCurve` mode
4. Thêm loop poll Jupiter Price API (10s) cho position ở `JupiterPoll` mode, emit `price_updated` cùng shape cũ
5. Update `docs/THIRD_PARTY_SERVICES.md`
6. Test: hold 1 position tới lúc graduate thật (hoặc giả lập bằng cách gọi `is_curve_complete` tay trên 1 mint đã graduate sẵn) — xác nhận price chuyển nguồn đúng lúc, không gián đoạn hiển thị
