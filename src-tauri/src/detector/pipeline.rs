use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter, Manager};

use super::RawTokenEvent;
use crate::enricher;
use crate::rpc::RpcState;

pub const PENDING_QUEUE_CAP: usize = 500;

const WATCH_WINDOW_SECS: i64 = 600; // 10 minutes
const MAX_WATCH_LIST_SIZE: usize = 500;
const REENRICH_INTERVAL_SECS: u64 = 30;
const REENRICH_CONCURRENCY: usize = 5;

pub struct Pipeline {
    rx: mpsc::Receiver<RawTokenEvent>,
    app: AppHandle,
    watch_list: Arc<Mutex<HashMap<String, RawTokenEvent>>>,
}

impl Pipeline {
    pub fn new(rx: mpsc::Receiver<RawTokenEvent>, app: AppHandle) -> Self {
        Self {
            rx,
            app,
            watch_list: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn run(&mut self) {
        tracing::info!("Pipeline started, waiting for token events...");

        {
            let watch_list = self.watch_list.clone();
            let app = self.app.clone();
            tokio::spawn(async move {
                re_enrich_loop(watch_list, app).await;
            });
        }

        while let Some(event) = self.rx.recv().await {
            let is_new = if let Some(mint) = &event.mint {
                let mut list = self.watch_list.lock().await;
                let is_new = !list.contains_key(mint);
                list.insert(mint.clone(), event.clone());
                if list.len() > MAX_WATCH_LIST_SIZE {
                    if let Some(oldest) = list
                        .iter()
                        .min_by_key(|(_, e)| e.detected_at)
                        .map(|(k, _)| k.clone())
                    {
                        list.remove(&oldest);
                    }
                }
                is_new
            } else {
                true
            };

            let app = self.app.clone();
            let rpc_state = app.state::<RpcState>();
            let rpc_url = rpc_state.rpc_url.clone();

            tokio::spawn(async move {
                match enricher::enrich(&event, &rpc_url).await {
                    Some(token) => {
                        if is_new {
                            tracing::info!(
                                "Token detected: {} | {} | score:{} liq:{:.1}◎ | pump.fun/coin/{}",
                                token.symbol.as_deref().unwrap_or("?"),
                                token.source,
                                token.score,
                                token.liquidity_sol,
                                token.mint,
                            );
                            app.emit("token_detected", &token).ok();
                        } else {
                            tracing::debug!(
                                "Token updated: {} (source: {}, score: {}, liq: {} SOL)",
                                token.symbol.as_deref().unwrap_or("?"),
                                token.source,
                                token.score,
                                token.liquidity_sol,
                            );
                            app.emit("token_updated", &token).ok();
                        }
                    }
                    None => {
                        tracing::debug!(
                            "Token {} skipped (no mint or authority gate)",
                            event.signature
                        );
                    }
                }
            });
        }
    }
}

async fn re_enrich_loop(
    watch_list: Arc<Mutex<HashMap<String, RawTokenEvent>>>,
    app: AppHandle,
) {
    let sem = Arc::new(Semaphore::new(REENRICH_CONCURRENCY));

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(REENRICH_INTERVAL_SECS)).await;

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let cutoff_ms = now_ms - WATCH_WINDOW_SECS * 1000;

        let events: Vec<RawTokenEvent> = {
            let mut list = watch_list.lock().await;
            list.retain(|_, e| e.detected_at > cutoff_ms);
            list.values().cloned().collect()
        };

        if events.is_empty() {
            continue;
        }

        tracing::debug!("Re-enriching {} watched tokens", events.len());

        let rpc_state = app.state::<RpcState>();
        let rpc_url = rpc_state.rpc_url.clone();

        for event in events {
            let permit = sem.clone().acquire_owned().await.ok();
            let rpc_url = rpc_url.clone();
            let app = app.clone();
            tokio::spawn(async move {
                let _permit = permit;
                if let Some(token) = enricher::enrich(&event, &rpc_url).await {
                    app.emit("token_updated", &token).ok();
                }
            });
        }
    }
}
