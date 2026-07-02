# Plan 18 — Enricher Retry + User RPC Config

---

## P1 · Enricher: Retry AccountNotFound, bỏ WARN

**File:** `src-tauri/src/enricher.rs`

### Vấn đề

Fix P0-4 drop tất cả token khi RPC fail. Nhưng `AccountNotFound` là timing race bình thường:
pump.fun WS fires trước khi transaction confirmed on-chain (~0.5–2s). Không phải security risk.

Các lỗi khác (Token-2022, timeout, rate limit) mới thực sự là security-relevant.

### Phân loại lỗi

| Lỗi | Nguyên nhân | Hành động |
|-----|-------------|-----------|
| `AccountNotFound` | Query sớm hơn on-chain confirm | Retry 1 lần sau 2.5s, **không log WARN** |
| `not an SPL token mint account` | Token-2022 — không support | Drop ngay, log WARN |
| Timeout / rate limit / lỗi khác | RPC không verify được | Drop ngay, log WARN |

### Logic mới

```
fetch_mint_authorities(mint)
  ├── Ok(ma, fa)
  │     ├── !ma || !fa → drop (authority chưa revoke)
  │     └── OK → tiếp tục enrich
  ├── Err(AccountNotFound)
  │     └── sleep 2500ms → retry
  │           ├── Ok → tiếp tục enrich
  │           └── Err → drop (không log gì — token không tồn tại on-chain)
  └── Err(khác)
        └── drop + WARN (genuine error)
```

**Lý do không log AccountNotFound sau retry:**
- Nếu retry vẫn AccountNotFound → token thực sự không tồn tại (mint fake)
- Đây là behavior bình thường của pump.fun feed, không cần alert operator
- Log quá nhiều "fake" WARN → user dễ bỏ sót WARN thật sự

**Trade-off:** Token xuất hiện trên feed chậm hơn ~2.5s so với trước. Acceptable.

---

## P2 · User-Configurable RPC URL

### Vấn đề hiện tại

RPC URL hardcode trong settings hoặc env. User không thể đổi sang RPC của riêng họ từ UI. Vấn đề thực tế:
- Free RPC (Helius public, Alchemy free) bị rate limit → enricher fail nhiều
- Trader nghiêm túc muốn dùng paid RPC của riêng (Helius, QuickNode, Triton) → nhanh hơn, ít lỗi hơn
- AccountNotFound giảm mạnh khi dùng RPC tốt hơn (confirmation nhanh hơn)

### Scope

**In scope:**
- UI để user nhập RPC URL trong Settings
- Validate URL trước khi save (ping test)
- Persist vào `sol-lens.settings.json`
- Rust BE đọc URL mới khi user thay đổi (hot reload, không cần restart app)
- Hiện RPC URL đang dùng (ẩn bớt để tránh lộ API key trong screenshot)

**Out of scope:**
- Multi-RPC failover (overkill)
- RPC benchmark/comparison tool
- WebSocket RPC riêng cho price tracker (dùng chung URL)

### Design

**Frontend — Settings panel:**

```
┌─────────────────────────────────────────────┐
│  RPC Endpoint                               │
│  ┌───────────────────────────────────────┐  │
│  │ https://mainnet.helius-rpc.com/?api.. │  │
│  └───────────────────────────────────────┘  │
│  [Test Connection]  ● Connected (45ms)      │
│  [Save]  [Reset to Default]                 │
└─────────────────────────────────────────────┘
```

- Input: text field, type = url, placeholder = default RPC
- Test button: invoke `test_rpc_connection` → ping `getHealth` → trả về latency ms
- Status badge: Connected (Xms) / Failed / Testing...
- Save: persist URL + update Rust state
- Reset: xóa custom URL, dùng lại default từ env/.env

**Rust BE:**

1. `RpcState` hiện tại chỉ có `rpc_url: String`. Cần thêm `Arc<RwLock<String>>` để hot-reload.

2. Commands mới:
   - `test_rpc_connection(url: String) -> Result<u64, String>` — ping + trả latency ms
   - `set_rpc_url(url: String) -> Result<(), String>` — validate + update state + persist
   - `get_rpc_url() -> String` — trả URL hiện tại (masked)

3. Persist: save vào `sol-lens.settings.json` key `rpcUrl`. Load khi app start, override default env URL nếu có.

4. Masking để tránh leak API key trong UI/logs:
   ```
   https://mainnet.helius-rpc.com/?api-key=abc123...
   → hiển thị: https://mainnet.helius-rpc.com/?api-key=abc1***
   ```

### Files cần sửa

**Rust:**
- `src-tauri/src/rpc.rs` — `RpcState` dùng `Arc<RwLock<String>>`, thêm 3 commands
- `src-tauri/src/lib.rs` — register commands mới, load rpcUrl từ settings khi start
- `src-tauri/src/enricher.rs` — dùng shared RPC URL
- `src-tauri/src/price_tracker.rs` — dùng shared RPC URL

**Frontend:**
- `src/components/settings/RpcSettings.tsx` — UI component mới
- Thêm vào settings panel / sidebar

### Execution

```
P1 (enricher retry) → 30 phút — 1 file, surgical change
P2 (RPC config)     → 4–6 giờ
  ├── Rust RpcState refactor     → 1h
  ├── 3 commands mới             → 1h
  ├── Settings UI component      → 2h
  └── Integration + test         → 1h
```

P1 làm trước để feed hoạt động lại. P2 là feature riêng biệt.
