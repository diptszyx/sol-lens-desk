# Third-Party Services

**Last updated:** 2026-07-01

Danh sách tất cả external services đang thực sự được dùng trong code.

---

## 1. pumpportal.fun WebSocket

**URL:** `wss://pumpportal.fun/api/data`  
**Auth:** Không cần  
**Cost:** Free  
**Used in:** `src-tauri/src/detector/pumpportal.rs`

### Đang dùng

| Subscription | Data nhận được | Dùng để |
|---|---|---|
| `subscribeNewToken` | mint, symbol, name, uri, initial_buy (dev sol), market_cap_sol, v_sol_in_bonding_curve, v_tokens_in_bonding_curve, trader_public_key (dev), dev_token_amount | Detect token mới → tính price/mcap/bonding curve từ math, không cần API thêm |

### Chưa dùng (available, planned)

| Subscription | Data nhận được | Dùng để (planned) |
|---|---|---|
| `subscribeTokenTrade` | buy/sell events của 1 token cụ thể, v_sol/v_tokens updated | Real-time price cho positions đang hold |

**Note:**
- `subscribeTokenTrade` payload: `{ method: "subscribeTokenTrade", keys: ["<mint>"] }`
- Price từ trade events: `price_sol = v_sol / v_tokens`
- Chỉ valid khi token còn trên bonding curve (chưa graduate Raydium)

---

## 2. Pump.fun On-chain Program (Direct Instruction)

**Program ID:** `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`  
**Fee Program:** `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`  
**IDL source:** `pump-fun/pump-public-docs` (GitHub, org chính chủ)  
**Used in:** `src-tauri/src/commands/pumpfun_direct.rs`

### Instructions dùng

| Instruction | Dùng cho | Notes |
|---|---|---|
| `buy_v2` | Buy token pre-graduation (bonding curve) | 27 accounts, discriminator `[184, 23, 238, 97, 103, 197, 211, 61]`, args: `amount: u64, max_sol_cost: u64` |
| `sell_v2` | Sell token pre-graduation (bonding curve) | 26 accounts, discriminator `[93, 246, 130, 60, 231, 233, 64, 178]`, args: `amount: u64, min_sol_output: u64` |

### Flow

```
build_swap_transaction / build_sell_transaction
  → pumpfun_direct::fetch_bonding_curve() → RPC get_account (read creator field)
  → pumpfun_direct::build_buy_v2_ix() / build_sell_v2_ix()
  → build createATA instruction for token account
  → compose VersionedTransaction → bincode serialize → base64
  → sign_transaction (custom wallet, local)
  → send_transaction (Helius RPC)
```

**Note:** Instruction được build 100% local từ IDL chính chủ, không dùng 3rd-party API hay crate cộng đồng. Cần 1 RPC call để đọc `bonding_curve.creator` (không tránh được). Fee recipients lấy từ `docs/FEE_RECIPIENTS.md` trong repo chính chủ, chọn random mỗi lần build.

---

## 3. Jupiter — Price API

**Auth:** Không cần  
**Cost:** Free  

### 3a. Token Search (SOL price lookup)

**URL:** `https://api.jup.ag/tokens/v2/search`  
**Used in:** `src-tauri/src/enricher.rs` → `get_sol_price_usd()`

| Usage | Dùng để |
|---|---|
| `get_sol_price_usd()` | Lấy giá SOL/USD để tính price_usd và market_cap_usd cho token |

**Interval:** Cache 30 giây.

### 3b. Price v2 (post-graduation position price)

**URL:** `https://api.jup.ag/price/v2?ids=<mint1>,<mint2>,...`  
**Used in:** `src-tauri/src/price_tracker.rs` → `run_jupiter_poll_loop()`

| Usage | Dùng để |
|---|---|
| Batch poll mỗi 10s | Lấy giá USD cho position đã graduate từ bonding curve sang PumpSwap, khi PumpPortal WS không còn bắn trade event |

**Trigger:** `run_graduation_loop()` (30s interval) phát hiện `BondingCurve.complete == true` → chuyển position sang `JupiterPoll` mode. Sau đó `run_jupiter_poll_loop()` poll giá mỗi 10s và emit `price_updated` cùng shape cũ (frontend không cần đổi).

**Limitation:** Token mới graduate có thể mất vài phút để Jupiter index — trong thời gian đó giá tạm đứng yên từ WS event cuối cùng.

---

## 4. Token Metadata URI (IPFS / Arweave)

**URL:** Dynamic — lấy từ `event.uri` của từng token  
**Auth:** Không cần  
**Cost:** Free  
**Used in:** `src-tauri/src/enricher.rs` → `fetch_socials()`

**Dùng để:** Fetch JSON metadata → check có field `twitter`, `telegram`, `website` → set `has_socials: bool`.

**Note:** URI thường là IPFS gateway hoặc Arweave. Timeout 5 giây, fail silently (returns `None`). Gọi cho mọi token trong `build_from_event()`.

---

## 5. Solana RPC (Helius)

**URL:** `https://mainnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>`  
**Auth:** `HELIUS_API_KEY` env var (required at startup)  
**Cost:** Paid tier  
**Used in:** `src-tauri/src/rpc.rs`, `src-tauri/src/commands/trade.rs`, `src-tauri/src/commands/pumpfun_direct.rs`

| Usage | Dùng để |
|---|---|
| `send_and_confirm_transaction_with_spinner_and_config()` | Submit signed transaction lên chain |
| `get_account()` | Đọc BondingCurve account (lấy creator field cho pumpfun direct) |
| `get_latest_blockhash()` | Lấy recent blockhash cho transaction |

**Note:** Token detection và enrichment không dùng RPC.

---

## 6. Custom Wallet (Local — No Third Party)

**Type:** Rust implementation, fully local  
**Auth:** User password (AES-GCM encryption)  
**Used in:** `src-tauri/src/wallet.rs`

**Dùng để:**
- Tạo / import wallet từ mnemonic
- Encrypt keypair với password → store local (Tauri app data dir)
- Unlock / lock wallet theo session
- Sign transaction bằng keypair in-memory khi unlocked
- Export mnemonic / private key

**Note:** Privy đã bị xóa hoàn toàn. Không có external auth dependency. Keypair không bao giờ persist dạng plaintext.

---

## Known Issues

| Issue | Severity | Location |
|---|---|---|
| PumpSwap post-graduation trade chưa support | 🔴 High | `pumpfun_direct.rs` — token đã graduate sẽ fail với clear error message, cần đóng gap account trong IDL PumpSwap |
| Jupiter Price API chưa index token vừa graduate | 🟡 Medium | `price_tracker.rs` — delay vài phút từ lúc graduate tới lúc Jupiter có giá, trong cửa sổ đó giá đứng yên từ WS event cuối cùng |

---

## Data Flow (Current)

```
Token Detection:
  pumpportal.fun WS (subscribeNewToken)
    → enricher::build_from_event() [bonding curve math]
      → fetch_socials() [token URI / IPFS]
    → compute_score() → emit token_detected to frontend

Swap Execution (pre-graduation):
  Frontend invoke build_swap_transaction
    → pumpfun_direct::fetch_curve_context() [RPC get_account]
    → build buy_v2 / sell_v2 instruction [local, from official IDL]
    → compose VersionedTransaction → sign_transaction (custom wallet, local)
    → send_transaction (Helius RPC)

Position Price (pre-graduation):
  price_tracker → PumpPortal WS subscribeTokenTrade
    → bonding curve math → emit price_updated
    → check SL threshold → emit sl_triggered

Position Price (post-graduation):
  price_tracker → run_graduation_loop (30s) → is_curve_complete() [RPC]
    → switch PriceSource::BondingCurve → PriceSource::JupiterPoll
  price_tracker → run_jupiter_poll_loop (10s) → Jupiter Price API v2
    → emit price_updated (same shape)
    → check SL threshold → emit sl_triggered
```
