use std::collections::HashMap;
use std::sync::Arc;
use futures_util::SinkExt;
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::{RwLock, mpsc};

use crate::enricher;

#[derive(Debug, Deserialize)]
struct TradeEvent {
    mint: Option<String>,
    #[serde(rename = "vSolInBondingCurve")]
    v_sol_in_curve: Option<f64>,
    #[serde(rename = "vTokensInBondingCurve")]
    v_tokens_in_curve: Option<f64>,
    #[serde(rename = "marketCapSol")]
    market_cap_sol: Option<f64>,
}

#[derive(Debug, Clone)]
struct TrackedPosition {
    entry_price_usd: f64,
    stop_loss_pct: f64,
}

pub struct PriceTracker {
    positions: Arc<RwLock<HashMap<String, TrackedPosition>>>,
    sub_tx: mpsc::UnboundedSender<String>,
}

impl PriceTracker {
    pub fn new(app: AppHandle) -> Self {
        let (sub_tx, sub_rx) = mpsc::unbounded_channel::<String>();
        let positions = Arc::new(RwLock::new(HashMap::new()));

        let positions_clone = positions.clone();
        tauri::async_runtime::spawn(async move {
            run_ws(app, positions_clone, sub_rx).await;
        });

        Self { positions, sub_tx }
    }

    pub async fn subscribe(&self, mint: String, entry_price_usd: f64, stop_loss_pct: f64) {
        self.positions.write().await.insert(
            mint.clone(),
            TrackedPosition { entry_price_usd, stop_loss_pct },
        );
        let _ = self.sub_tx.send(mint);
    }

    pub async fn unsubscribe(&self, mint: &str) {
        self.positions.write().await.remove(mint);
        // pumpportal has no unsubscribe; removing from map stops processing
    }
}

async fn run_ws(
    app: AppHandle,
    positions: Arc<RwLock<HashMap<String, TrackedPosition>>>,
    mut sub_rx: mpsc::UnboundedReceiver<String>,
) {
    loop {
        if let Err(e) = try_run_ws(&app, &positions, &mut sub_rx).await {
            tracing::warn!("Price tracker WS disconnected: {e}. Reconnecting in 5s...");
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    }
}

async fn try_run_ws(
    app: &AppHandle,
    positions: &Arc<RwLock<HashMap<String, TrackedPosition>>>,
    sub_rx: &mut mpsc::UnboundedReceiver<String>,
) -> anyhow::Result<()> {
    use futures_util::StreamExt;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let (mut ws, _) = connect_async("wss://pumpportal.fun/api/data").await?;

    // Re-subscribe all tracked mints on every (re)connect
    let mints: Vec<String> = positions.read().await.keys().cloned().collect();
    if !mints.is_empty() {
        let msg = json!({ "method": "subscribeTokenTrade", "keys": mints }).to_string();
        ws.send(Message::Text(msg)).await?;
    }

    tracing::info!("Price tracker WS connected, tracking {} mints", mints.len());

    loop {
        tokio::select! {
            msg = ws.next() => {
                let text = match msg {
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return Err(e.into()),
                    None => return Ok(()),
                };

                let Ok(event) = serde_json::from_str::<TradeEvent>(&text) else {
                    continue;
                };

                let Some(mint) = event.mint else { continue };

                let sol_price = enricher::get_sol_price_usd().await;

                let Some(price) = (match (event.v_sol_in_curve, event.v_tokens_in_curve, sol_price) {
                    (Some(s), Some(t), Some(sp)) if t > 0.0 => Some((s / t) * sp),
                    _ => None,
                }) else { continue };

                let market_cap_usd = event.market_cap_sol.zip(sol_price).map(|(mc, sp)| mc * sp);

                // Snapshot entry/SL under a short read lock, then drop it
                let (entry_price, sl_pct) = {
                    let guard = positions.read().await;
                    match guard.get(&mint) {
                        Some(t) => (t.entry_price_usd, t.stop_loss_pct),
                        None => continue,
                    }
                };

                let _ = app.emit(
                    "price_updated",
                    json!({
                        "mint": &mint,
                        "price_usd": price,
                        "market_cap_usd": market_cap_usd,
                    }),
                );

                let pnl_pct = ((price - entry_price) / entry_price) * 100.0;
                let sl_threshold = entry_price * (1.0 - sl_pct / 100.0);

                if price <= sl_threshold {
                    // Remove first — prevents repeated SL events for same mint
                    positions.write().await.remove(&mint);
                    tracing::info!(
                        "SL triggered for {mint}: entry={entry_price:.6}, current={price:.6}, pnl={pnl_pct:.1}%"
                    );
                    let _ = app.emit(
                        "sl_triggered",
                        json!({
                            "mint": &mint,
                            "entry_price_usd": entry_price,
                            "exit_price_usd": price,
                            "realized_pnl_pct": pnl_pct,
                        }),
                    );
                }
            }

            mint = sub_rx.recv() => {
                let Some(mint) = mint else {
                    return Ok(()); // tracker dropped
                };
                tracing::info!("Price tracker: subscribing to {mint}");
                let msg = json!({ "method": "subscribeTokenTrade", "keys": [&mint] }).to_string();
                if let Err(e) = ws.send(Message::Text(msg)).await {
                    // WS broken — reconnect will re-subscribe from HashMap
                    return Err(e.into());
                }
            }
        }
    }
}
