# Third-Party Services

**Last updated:** 2026-06-27

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
| `subscribeTokenTrade` | buy/sell events của 1 token cụ thể, v_sol/v_tokens updated | Real-time price cho positions đang hold (xem PORTFOLIO_TRADE.md) |

**Note:**
- `subscribeTokenTrade` payload: `{ method: "subscribeTokenTrade", keys: ["<mint>"] }`
- Price từ trade events: `price_sol = v_sol / v_tokens`
- Chỉ valid khi token còn trên bonding curve (chưa graduate Raydium)

---

## 2. Jupiter — Swap API

**Base URL:** `https://api.jup.ag/swap/v1/`  
**Auth:** Không cần  
**Cost:** Free  
**Used in:** `src-tauri/src/commands/swap.rs`

| Endpoint | Method | Dùng để |
|---|---|---|
| `/quote` | GET | Get swap quote: SOL → token |
| `/swap` | POST | Build swap transaction từ quote |

**Flow:**
```
quote_jupiter() → GET /quote → raw_quote
build_jupiter_tx() → POST /swap → serialized_tx (base64)
```

**Note:** `build_swap_transaction` race Jupiter vs Kamino parallel (800ms timeout), chọn `max(out_amount)`.

---

## 3. Kamino — Swap API

**URL:** `https://api.kamino.finance/kswap/swap/`  
**Auth:** Không cần  
**Cost:** Free  
**Used in:** `src-tauri/src/commands/swap.rs`

| Endpoint | Method | Dùng để |
|---|---|---|
| `/swap` | GET | Quote + prebuilt transaction cùng lúc |

**Params:**
```
tokenIn: So11111111111111111111111111111111111111112  (SOL)
tokenOut: <output_mint>
amountIn: <lamports>
maxSlippageBps: <bps>
wallet: <user_public_key>
includeSetupIxs: true
wrapAndUnwrapSol: true
```

**Note:** Kamino trả `serialized_tx` sẵn, không cần build step riêng. `price_impact_pct` luôn trả `0.0` — không reliable.

---

## 4. Jupiter — Price API

**URL:** `https://api.jup.ag/price/v2`  
**Auth:** Không cần  
**Cost:** Free  
**Used in:** `src/hooks/usePricePoll.ts`

| Usage | Dùng để |
|---|---|
| `GET ?ids=mint1,mint2,...` | Batch price query cho open positions |

**Interval:** Poll mỗi 10 giây.

**Limitation:** Token mới trên bonding curve thường **chưa được index** → poll trả về rỗng cho pre-graduation tokens. Planned fix: dùng `subscribeTokenTrade` thay thế (xem PORTFOLIO_TRADE.md).

---

## 5. Token Metadata URI (IPFS / Arweave)

**URL:** Dynamic — lấy từ `event.uri` của từng token  
**Auth:** Không cần  
**Cost:** Free  
**Used in:** `src-tauri/src/enricher.rs` → `fetch_has_socials()`

**Dùng để:** Fetch JSON metadata → check có field `twitter`, `telegram`, `website` → set `has_socials: bool`.

**Note:** URI thường là IPFS gateway hoặc Arweave. Timeout 5 giây, fail silently (returns `None`). Gọi cho mọi token trong `build_from_event()`.

---

## 6. Solana RPC (Helius)

**URL:** `https://mainnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>`  
**Auth:** `HELIUS_API_KEY` env var (required at startup)  
**Cost:** Paid tier  
**Used in:** `src-tauri/src/rpc.rs`, `src-tauri/src/commands/swap.rs`

| Usage | Dùng để |
|---|---|
| `send_and_confirm_transaction_with_spinner_and_config()` | Submit signed transaction lên chain |

**Note:** RPC chỉ dùng để broadcast transaction. Token detection và enrichment không dùng RPC.

---

## 7. Custom Wallet (Local — No Third Party)

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
| `SOL_USD_APPROX = 150.0` hardcoded | 🔴 High | `enricher.rs:6` — ảnh hưởng toàn bộ price_usd và market_cap_usd |
| Jupiter Price API không index pre-graduation tokens | 🟡 Medium | `usePricePoll.ts` — positions mới buy chưa có price |
| `subscribeTokenTrade` chưa implement | 🟡 Medium | Cần để real-time price và stop loss trigger |
| Kamino `price_impact_pct` luôn 0.0 | 🟢 Low | `swap.rs` — UI hiển thị impact không chính xác khi Kamino win |

---

## Data Flow (Current)

```
Token Detection:
  pumpportal.fun WS (subscribeNewToken)
    → enricher::build_from_event() [bonding curve math]
      → fetch_has_socials() [token URI / IPFS]
    → emit token_detected to frontend

Swap Execution:
  Frontend invoke build_swap_transaction
    → parallel: Jupiter /quote + Kamino /swap  (800ms timeout)
    → pick best out_amount
    → sign_transaction (custom wallet, local)
    → send_transaction (Helius RPC)

Portfolio Price (current, broken for new tokens):
  usePricePoll.ts → Jupiter Price API (10s interval)

Portfolio Price (planned):
  pumpportal.fun WS subscribeTokenTrade (per held mint)
    → real-time price from bonding curve math
    → fallback: Jupiter Price API after graduation
```
