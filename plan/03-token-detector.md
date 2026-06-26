# P2 — Token Detector (Rust)

## Goal
Rust backend listens to Solana logs via WebSocket. Subscribe trực tiếp vào **launch platform programs** để bắt sự kiện tạo token mới (tín hiệu sớm nhất). Token được detect → đưa vào pending queue → đợi enricher + filter → mới emit lên UI.

## Strategy: Hybrid WS + Filter

```
WS subscribe program (Pump.fun, LetsBONK.fun, ...)
       │
       ▼
Raw event (signature + program)
       │
       ▼
Pending Queue (tokio::mpsc channel)
       │
       ▼
Enricher (P4): fetch tx → extract mint → fetch metadata → rug flags
       │
       ▼
Filter Layer: check user config (min_liquidity_sol, hide_flagged, min_age)
       │
       ├── Pass → emit "token_detected" (full TokenInfo) → UI
       └── Fail → stay in buffer (không emit, nhưng giữ lại)
```

**Lý do:**
- Token mới ra chưa có liquidity/price → enrich trước khi filter
- User không bị spam token rác
- Filter thay đổi → token trong buffer có thể hiện lại nếu pass filter mới

## Sources — Launch Platforms

| Platform | Program Address | Event | Notes |
|----------|----------------|-------|-------|
| Pump.fun | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `create` instruction | Token được tạo trên bonding curve |
| LetsBONK.fun | TBD | TBD | Cần tìm program address |

> **Không subscribe Raydium AMM v4 nữa** — Raydium là DEX layer (token đã có từ launch platform). Bắt ở launch platform sớm hơn vài giây.

> Khi token graduate từ bonding curve → Raydium pool, điều đó xảy ra sau. Không cần bắt lại vì token đã được detect từ lúc tạo.

## Implementation

### Shared types (detector/mod.rs)

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawTokenEvent {
    pub signature: String,
    pub source: String,       // "pump_fun" | "letsbonk_fun" | ...
    pub detected_at: i64,     // unix ms
}
```

### detector/pump_fun.rs

```rust
use tokio_tungstenite::{connect_async, tungstenite::Message};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use anyhow::Result;

const PUMP_FUN_PROGRAM: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/// Subscribe to Pump.fun program logs, send raw events to pending queue
pub async fn listen(tx: mpsc::Sender<RawTokenEvent>, ws_url: String) -> Result<()> {
    loop {
        match try_listen(&tx, &ws_url).await {
            Ok(_) => {},
            Err(e) => {
                tracing::warn!("Pump.fun WS disconnected: {e}. Reconnecting in 3s...");
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        }
    }
}

async fn try_listen(tx: &mpsc::Sender<RawTokenEvent>, ws_url: &str) -> Result<()> {
    let (mut ws, _) = connect_async(ws_url).await?;

    let sub = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "logsSubscribe",
        "params": [
            { "mentions": [PUMP_FUN_PROGRAM] },
            { "commitment": "processed" }
        ]
    });
    ws.send(Message::Text(sub.to_string().into())).await?;

    use futures_util::StreamExt;
    while let Some(msg) = ws.next().await {
        let msg = msg?;
        if let Message::Text(text) = msg {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if let Some(event) = parse_create_event(&v) {
                    let _ = tx.send(event).await;
                }
            }
        }
    }
    Ok(())
}

fn parse_create_event(v: &Value) -> Option<RawTokenEvent> {
    let logs = v["params"]["result"]["value"]["logs"].as_array()?;

    // Pump.fun emits "Program log: Create" when new token is created
    let is_create = logs.iter().any(|l| {
        l.as_str().map(|s| s.contains("Create")).unwrap_or(false)
    });
    if !is_create { return None; }

    let signature = v["params"]["result"]["value"]["signature"]
        .as_str()?
        .to_string();

    Some(RawTokenEvent {
        signature,
        source: "pump_fun".to_string(),
        detected_at: chrono::Utc::now().timestamp_millis(),
    })
}
```

### detector/letsbonk_fun.rs (same pattern, different program + log keyword)

```rust
// Program address TBD
// const LETSBONK_PROGRAM: &str = "...";

// Same structure as pump_fun.rs
// Parse log keyword specific to LetsBONK (TBD)
```

### Pending Queue + Dispatcher (detector/pipeline.rs)

```rust
use tokio::sync::mpsc;
use tauri::AppHandle;
use std::sync::Arc;
use solana_client::nonblocking::rpc_client::RpcClient;

/// Capacity: 500 pending tokens max — protects memory
const PENDING_QUEUE_CAP: usize = 500;

pub struct Pipeline {
    rx: mpsc::Receiver<RawTokenEvent>,
    rpc: Arc<RpcClient>,
    app: AppHandle,
}

impl Pipeline {
    pub fn new(
        rx: mpsc::Receiver<RawTokenEvent>,
        rpc: Arc<RpcClient>,
        app: AppHandle,
    ) -> Self {
        Self { rx, rpc, app }
    }

    /// Drain pending queue, enrich each token, filter, emit
    pub async fn run(&mut self) {
        while let Some(event) = self.rx.recv().await {
            let rpc = self.rpc.clone();
            let app = self.app.clone();

            // Enrich concurrently per token (tokio::spawn)
            tokio::spawn(async move {
                match crate::enricher::enrich_and_filter(&rpc, &app, &event).await {
                    Ok(Some(token)) => {
                        app.emit("token_detected", &token).ok();
                    }
                    Ok(None) => {
                        // Filtered out — no UI update
                        tracing::debug!("Token {} filtered out", event.signature);
                    }
                    Err(e) => {
                        tracing::warn!("Enrich failed for {}: {e}", event.signature);
                    }
                }
            });
        }
    }
}
```

### Startup in lib.rs

```rust
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let ws_url = // from user config
            let rpc = Arc::new(RpcClient::new(rpc_url));

            // Pending queue channel
            let (tx, rx) = mpsc::channel(PENDING_QUEUE_CAP);

            // Start detectors → send to queue
            let tx1 = tx.clone();
            let tx2 = tx.clone();
            tokio::spawn(detector::pump_fun::listen(tx1, ws_url.clone()));
            // tokio::spawn(detector::letsbonk_fun::listen(tx2, ws_url.clone()));

            // Pipeline: drain queue → enrich → filter → emit
            let mut pipeline = detector::pipeline::Pipeline::new(rx, rpc.clone(), app.handle().clone());
            tokio::spawn(async move { pipeline.run().await });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

## Acceptance Criteria

- [ ] WS connects on startup, subscribes to Pump.fun program
- [ ] Token creation event → pending queue within 1-2s
- [ ] WS auto-reconnects with exponential backoff
- [ ] No panic on malformed WS message
- [ ] Pending queue bounded at 500, drops oldest if full (protect memory)
- [ ] Multiple detectors run concurrently (1 tokio task per platform)
