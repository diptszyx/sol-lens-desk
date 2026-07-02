# Plan 19 — Bonding Curve Direct Trade (Pump.fun Pre-Graduation)

**Status:** Bonding curve path — verify xong, sẵn sàng code. PumpSwap path — còn 1 gap thật (xem mục cuối), cần đào thêm trước khi code phần post-graduation.
**Trigger:** `fetch_best_quote` (Jupiter + Kamino race) không route được token vừa detect — cả hai chỉ thấy pool đã tồn tại, token mới còn nằm trên bonding curve pump.fun (chưa graduate) thì không có pool nào để quote.

---

## Vấn đề

Bot detect token qua `subscribeNewToken` (PumpPortal WS) — bắt token **ngay lúc mint**, còn 100% trên bonding curve. Trade path hiện tại (`trade.rs::fetch_best_quote`) chỉ có Jupiter + Kamino, cả 2 chỉ route được token **đã graduate** (có pool thật). → Với token bot target, gần như luôn `"No route found"`. Bug kiến trúc, không phải bug code.

---

## Quyết định: build instruction 100% local từ IDL chính chủ

- Không dùng PumpPortal Local API (fee 0.5%, phụ thuộc 3rd-party execution).
- Không dùng crate cộng đồng (`sol-trade-sdk`, `pumpfun`, v.v.) — pump.fun tự publish IDL chính chủ, đủ tự build, khỏi trust code người lạ ký transaction hộ.
- Nguồn: **`pump-fun/pump-public-docs`** (GitHub, org chính chủ) — `idl/pump.json` (bonding curve), `idl/pump_amm.json` (PumpSwap), `idl/pump_fees.json`.

---

## Phát hiện quan trọng nhất: IDL công khai KHÔNG khớp 100% behavior on-chain thật

Quy trình verify: lấy tx thật qua public Solana RPC (`getSignaturesForAddress`), decode base58 instruction data thủ công (tự viết decoder, không dùng lib ngoài), so account list + discriminator với IDL — lặp lại trên **6 tx độc lập** (4 bonding curve, 2 PumpSwap).

**Kết quả:**

| Instruction | IDL khai báo | Thực tế on-chain | Khớp? |
|---|---|---|---|
| `buy` (bonding curve, legacy) | 16 accounts | 18 accounts (2 lần, 2 tx độc lập) | ❌ thiếu 2 |
| `buy_exact_quote_in_v2` (bonding curve) | 27 accounts | 28 accounts | ❌ thiếu 1 |
| `sell_v2` (bonding curve) | 26 accounts | 26 accounts | ✅ khớp tuyệt đối |
| `buy` (PumpSwap) | 23 accounts | 26 accounts | ❌ thiếu 3 |

Account dư ra ở tất cả case ❌ đều **map đúng vào danh sách Buyback Fee Recipients chính thức** (`docs/FEE_RECIPIENTS.md`) — tức không phải "rác" từ router gọi CPI như t đoán ban đầu, mà là account buyback thật mà chương trình on-chain đã âm thầm thêm vào, nhưng **IDL công khai chưa cập nhật** cho các instruction "đời cũ" (`buy`, `buy_exact_quote_in_v2`, PumpSwap `buy`/`sell`).

**Chỉ riêng `buy_v2`/`sell_v2` của bonding curve có IDL đầy đủ, khớp chính xác on-chain** (đã verify `sell_v2` 26=26; `buy_v2` cùng họ, cùng pattern account, tin cậy cao dù chưa bắt được tx mẫu riêng cho nó).

**→ Quyết định:** dùng **`buy_v2`/`sell_v2`** cho bonding curve, không dùng `buy`/`sell` (legacy). Vừa an toàn (IDL đầy đủ, verify được), vừa args sạch hơn (bỏ được `OptionBool` mơ hồ — `buy_v2`/`sell_v2` chỉ có `amount`/`max_sol_cost`/`min_sol_output`, toàn `u64`).

---

## `buy_v2` — spec đầy đủ (bonding curve, pre-graduation)

```
Program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
Discriminator: [184, 23, 238, 97, 103, 197, 211, 61]
Args: amount: u64, max_sol_cost: u64
```

**27 accounts, đúng thứ tự, kèm cách derive:**

| # | Account | Derive |
|---|---|---|
| 1 | global | PDA(["global"], PUMP_PROGRAM) |
| 2 | base_mint | input (mint token) |
| 3 | quote_mint | `So11111111111111111111111111111111111111112` (WSOL) khi buy bằng SOL |
| 4 | base_token_program | Token-2022 hoặc classic Token program — đọc từ mint account owner |
| 5 | quote_token_program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (classic, vì quote=WSOL) |
| 6 | associated_token_program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` (fixed) |
| 7 | fee_recipient | 1 địa chỉ bất kỳ trong "Normal Fee Recipients" (`docs/FEE_RECIPIENTS.md`) |
| 8 | associated_quote_fee_recipient | ATA(owner=fee_recipient, mint=quote_mint, program=quote_token_program) |
| 9 | buyback_fee_recipient | 1 địa chỉ bất kỳ trong "Buyback Fee Recipients" |
| 10 | associated_quote_buyback_fee_recipient | ATA(owner=buyback_fee_recipient, mint=quote_mint) |
| 11 | bonding_curve | PDA(["bonding-curve", base_mint], PUMP_PROGRAM) |
| 12 | associated_base_bonding_curve | ATA(owner=bonding_curve, mint=base_mint, program=base_token_program) |
| 13 | associated_quote_bonding_curve | ATA(owner=bonding_curve, mint=quote_mint) |
| 14 | user | **signer**, ví bot |
| 15 | associated_base_user | ATA(owner=user, mint=base_mint) |
| 16 | associated_quote_user | ATA(owner=user, mint=quote_mint) |
| 17 | creator_vault | PDA(["creator-vault", bonding_curve.creator], PUMP_PROGRAM) — **cần đọc field `creator` từ account `bonding_curve` on-chain trước**, không derive tĩnh được |
| 18 | associated_creator_vault | ATA(owner=creator_vault, mint=quote_mint) |
| 19 | sharing_config | PDA(["sharing-config", base_mint], FEE_PROGRAM) |
| 20 | global_volume_accumulator | PDA(["global_volume_accumulator"], PUMP_PROGRAM) |
| 21 | user_volume_accumulator | PDA(["user_volume_accumulator", user], PUMP_PROGRAM) |
| 22 | associated_user_volume_accumulator | ATA(owner=user_volume_accumulator, mint=quote_mint) |
| 23 | fee_config | PDA(["fee_config", PUMP_PROGRAM_bytes], FEE_PROGRAM) |
| 24 | fee_program | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` (fixed) |
| 25 | system_program | `11111111111111111111111111111111` (fixed) |
| 26 | event_authority | PDA(["__event_authority"], PUMP_PROGRAM) |
| 27 | program | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (tự trỏ) |

Tất cả seeds trên lấy trực tiếp từ `pda` field trong `idl/pump.json` (parse bằng script, không đoán). `sell_v2` cấu trúc y hệt, bỏ `global_volume_accumulator`+`associated_user_volume_accumulator` giữ `user_volume_accumulator` (26 accounts), args đổi thành `amount`/`min_sol_output`.

---

## Đã đóng (không còn treo)

1. **`OptionBool`** — moot, `buy_v2`/`sell_v2` không dùng type này (chỉ `buy`/`sell` legacy có, và t không dùng legacy nữa). Với `pump_amm.json` (PumpSwap) thì `OptionBool` vẫn còn (định nghĩa: struct 1 field `bool`, tức Borsh-encode đúng 1 byte, không phải enum 2 field kiểu `Option<bool>` chuẩn — không có byte tag None/Some).
2. **PDA seeds** — đã lấy đủ, chính xác cho toàn bộ 27 account của `buy_v2` (bảng trên), verify chéo bằng cách match địa chỉ thật trong tx mẫu (`fee_recipient`, `fee_program`, `mint` đều khớp expected pattern).
3. **Graduation destination hiện tại = PumpSwap** — confirm bằng data thật: program `pAMMBay6...` có **15 tx thành công trong cùng 1 giây** lúc kiểm tra — cực kỳ active, không phải program chết/deprecated.

---

## Chưa đóng — PumpSwap (post-graduation) còn gap thật

Không có `buy_v2`/`sell_v2` cho PumpSwap — chỉ có `buy`/`sell`/`buy_exact_quote_in`, và cả 2 cái đã verify (`buy`/`sell`) đều bị thiếu account trong IDL công khai (thiếu 3, xem bảng trên). 3 account thiếu này **map được vị trí cuối cùng khớp Buyback Fee Recipients**, nhưng chưa xác định chắc **thứ tự đầy đủ + tên chính xác + cách derive** của cả 3 (chỉ mới thấy account thứ 2 trong 3 khớp danh sách buyback, còn account 1 và 3 thì chưa xác định là gì).

**Việc cần làm trước khi code phần PumpSwap:**
- Đối chiếu account dư đó với account list tương ứng của `buy_v2` bên bonding curve (rất có thể PumpSwap cũng cần đúng cặp `buyback_fee_recipient` + `associated_quote_buyback_fee_recipient`, chỉ là chưa công bố trong `pump_amm.json`) — suy luận có cơ sở nhưng chưa verify tay từng field.
- Có thể cần tìm thêm vài tx PumpSwap mẫu, decode tay account thứ 1 và thứ 3 trong 3 account dư để chắc chắn tên/thứ tự.
- Vì bot m đang **focus token mới detect (pre-graduation)**, phần PumpSwap chỉ cần cho **sell khi đang hold token đã graduate** — không chặn phần buy chính, có thể để làm sau, dùng fallback tạm (báo lỗi rõ ràng "chưa support sell post-graduation" thay vì build sai instruction).

---

## Thiết kế implementation

**File mới:** `src-tauri/src/commands/pumpfun_direct.rs`

- Build `Instruction` (`solana_sdk::instruction::Instruction`, đã có sẵn) trực tiếp: discriminator 8 byte cố định + Borsh-encode args + `AccountMeta` đúng bảng trên.
- `creator_vault` phải đọc account `bonding_curve` on-chain trước (field `creator`) rồi mới derive được — không phải seed tĩnh, cần 1 lần `get_account` + decode struct `BondingCurve` (định nghĩa trong `idl/pump.json` phần `accounts`/`types`).
- Input: dùng thẳng curve reserves cache trong `TokenInfo` (`enricher.rs`, `v_sol_in_bonding_curve`/`v_tokens_in_bonding_curve`) để tính `max_sol_cost` theo slippage — 0 HTTP quote call. Vẫn cần 1 RPC call để đọc `bonding_curve.creator` (không tránh được, nhưng nhẹ, không phải "quote" round-trip).
- **Freshness check:** event cache cũ hơn ngưỡng (vd 3s) → re-fetch bonding curve account qua RPC trước khi build ix.
- Router theo `bonding_curve_pct` (có sẵn trong `TokenInfo`): `< 100` → `buy_v2`/`sell_v2` bonding curve. `>= 100` → PumpSwap (sau khi đóng gap ở mục trên).
- Sign bằng `wallet.rs` (đã có), gửi qua `rpc.rs`/Helius (đã có).

**Dependency:** `Cargo.toml` đã có `solana-sdk`/`solana-client`. Cần thêm `borsh` để encode args đúng chuẩn Anchor (chưa thấy trong deps hiện tại).

**Ước lượng:** ~1 ngày cho bonding curve buy/sell (data đã đủ, chỉ còn code + test). +0.5-1 ngày cho PumpSwap sau khi đóng gap account.

---

## Dọn dead code sau khi chuyển hẳn qua local

**Xóa trong `src-tauri/src/commands/trade.rs`:**
- `quote_jupiter()` (dòng 47-80) + `JUPITER_QUOTE_URL` const
- `build_jupiter_tx()` (dòng 125-151)
- `quote_kamino()` (dòng 82-123) + `KAMINO_SWAP_URL` const
- `fetch_best_quote()` — thay bằng gọi thẳng `pumpfun_direct::build_buy_ix`/`build_sell_ix`
- `Quote` struct, `QUOTE_TIMEOUT_MS`

**Xóa trong `docs/THIRD_PARTY_SERVICES.md`:**
- Mục Jupiter Swap API + Kamino Swap API — xóa hẳn
- Cập nhật "Data Flow (Current)" — "Swap Execution" đổi thành local instruction build
- Thêm mục "Pump.fun on-chain program (direct instruction)" — nguồn IDL `pump-fun/pump-public-docs`

**Kiểm tra trước khi xóa:** frontend (`TradePanel.tsx`, `usePetTradeBridge.ts`) chỉ thấy `BuildTxResult` abstract qua `provider: String` — đổi backend không cần đổi frontend type.

---

## Jupiter còn dùng chỗ khác — KHÔNG xóa hết

`src-tauri/src/enricher.rs::get_sol_price_usd()` (dòng 52-87) — gọi `https://api.jup.ag/tokens/v2/search` lấy giá SOL/USD, không liên quan swap/trade. Giữ nguyên. Kamino thì sạch, xóa `quote_kamino` là hết dấu vết.

---

## Files cần sửa

**Rust:**
- `src-tauri/Cargo.toml` — thêm `borsh`
- `src-tauri/src/commands/pumpfun_direct.rs` — mới
- `src-tauri/src/commands/trade.rs` — xóa quote functions cũ
- `src-tauri/src/enricher.rs` — expose reserves cho routing. Không đụng `get_sol_price_usd()`.

**Docs:** `docs/THIRD_PARTY_SERVICES.md` — xóa Jupiter/Kamino Swap API, giữ Jupiter Price API, thêm mục pump.fun direct.

**Frontend:** không đổi bắt buộc.

---

## Rủi ro

1. Code ký + gửi transaction thật, tự build instruction — bắt buộc test amount nhỏ trên mainnet trước, không devnet thật cho pump.fun.
2. `creator_vault` derive sai nếu đọc nhầm field `creator` trong `BondingCurve` account struct — cần decode đúng layout (offset/type) từ IDL `accounts` section, chưa parse phần này.
3. PumpSwap gap account (mục trên) — chưa code phần này cho tới khi đóng gap.
4. Token graduate giữa lúc detect và click buy — router cần fallback an toàn.
5. Curve reserves cache stale nếu user hesitate lâu — freshness check bắt buộc.

---

## Việc cần làm

1. Parse `idl/pump.json` phần `accounts` → lấy layout struct `BondingCurve` (field `creator` offset/type) để decode đúng khi đọc on-chain
2. Implement `pumpfun_direct.rs`: build `buy_v2`/`sell_v2` theo bảng account đã chốt ở trên
3. POC: build + sign 1 buy thật trên mainnet, amount nhỏ (0.01 SOL) — xác nhận tx confirm
4. Wire vào `trade.rs`, xóa `quote_jupiter`/`quote_kamino`/`fetch_best_quote` cũ
5. Update `docs/THIRD_PARTY_SERVICES.md`
6. Đóng gap PumpSwap (đối chiếu 3 account dư, verify thêm tx nếu cần) rồi mới code phần sell post-graduation
7. Test end-to-end: buy pre-grad → hold → sell (sau khi PumpSwap xong)
