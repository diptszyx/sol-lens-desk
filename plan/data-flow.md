# Token Detection → Alert: Data Flow

## Overview

```
pump.fun WS
    │
    ▼
pumpportal.rs (Rust)
    │  subscribeNewToken
    │  reconnect on silent disconnect (30s timeout)
    ▼
mpsc channel (RawTokenEvent)
    │
    ▼
pipeline.rs (Rust)
    ├──► watch_list (HashMap<mint, RawTokenEvent>, TTL 10 min)
    │
    └──► enricher::enrich()
              │  - fetch_mint_authorities (RPC)   → skip if not revoked
              │  - build_from_event               → bonding_curve_pct, dev_hold_pct, dev_buy_sol
              │  - fetch_has_socials (HTTP → IPFS) → twitter/telegram/website
              │  - compute_score()
              ▼
         TokenInfo { score, liquidity_sol, ... }
              │
              ▼
         app.emit("token_detected")
              │
              ▼ (Tauri IPC)
         useTokenFeed.ts
              │
              ▼
         tokenFeedStore.addToken()   → tokens[] (max 200, dedup by mint)
              │
              ▼
         TokenFeed UI (matchesFilter)
              │  - minScoreThreshold
              │  - minLiquiditySol
              │  - maxAgeSec
              │  - hideUnnamed
              ▼
         TokenRow shown / hidden
```

---

## Re-enrichment Loop (score alert)

Chạy song song với pipeline chính. Mục đích: token launch với score thấp có thể pass sau khi dev thêm socials.

```
pipeline.rs
    │
    └──► re_enrich_loop (background task)
              │  every 30s
              │  semaphore: max 5 concurrent
              │
              ├── lọc watch_list: chỉ token detected_at < 10 phút trước
              │
              └── enricher::enrich() (re-fetch has_socials, recompute score)
                        │
                        ▼
                   app.emit("token_updated")
                        │
                        ▼ (Tauri IPC)
                   useTokenFeed.ts listener
                        │
                        ├── old_score < threshold && new_score >= threshold?
                        │       │
                        │       ▼ YES
                        │   addScoreAlert(token)  → scoreAlerts[]  → UI alert
                        │
                        └── updateToken(token)    → cập nhật score in-place
```

---

## Score Components

| Factor | Max pts | Nguồn | Thay đổi theo thời gian? |
|--------|---------|-------|--------------------------|
| dev_hold_pct < 5% | +30 safety | event (snapshot) | Không (re-enrich không re-fetch) |
| bonding_curve_pct 30–50% | +25 signal | event (snapshot) | Không |
| dev_buy_sol ≥ 1 SOL | +15 signal | event (snapshot) | Không |
| has_socials | +10 signal | HTTP → metadata URI | **Có** ← lý do re-enrich |
| dev_hold_pct < 10% | +15 safety | event (snapshot) | Không |

> **Note:** bonding_curve_pct và dev_hold_pct là snapshot tại thời điểm detect.
> Muốn live update → cần poll on-chain account hoặc subscribe `subscribeTokenTrade` (0.01 SOL/10k events).

---

## Event Names (Tauri)

| Event | Hướng | Khi nào |
|-------|-------|---------|
| `token_detected` | Rust → Frontend | Token mới detect + enrich xong |
| `token_updated` | Rust → Frontend | Re-enrich sau 30s, score có thể thay đổi |

---

## Store State

```ts
tokenFeedStore {
  tokens: DetectedToken[]     // max 200, dedup by mint
  selected: DetectedToken | null
  scoreAlerts: DetectedToken[] // token vừa cross minScoreThreshold
}
```
