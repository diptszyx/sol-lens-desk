use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter, Manager};

use super::RawTokenEvent;
use crate::enricher;
use crate::rpc::RpcState;

pub const PENDING_QUEUE_CAP: usize = 500;

pub struct Pipeline {
    rx: mpsc::Receiver<RawTokenEvent>,
    app: AppHandle,
}

impl Pipeline {
    pub fn new(rx: mpsc::Receiver<RawTokenEvent>, app: AppHandle) -> Self {
        Self { rx, app }
    }

    pub async fn run(&mut self) {
        tracing::info!("Pipeline started, waiting for token events...");

        while let Some(event) = self.rx.recv().await {
            let app = self.app.clone();
            let rpc_state = app.state::<RpcState>();
            let rpc_url = rpc_state.rpc_url.clone();

            tokio::spawn(async move {
                match enricher::enrich(&event, &rpc_url).await {
                    Some(token) => {
                        tracing::info!(
                            "Token detected: {} (source: {}, score: {}, liq: {} SOL)",
                            token.symbol.as_deref().unwrap_or("?"),
                            token.source,
                            token.score,
                            token.liquidity_sol,
                        );
                        app.emit("token_detected", &token).ok();
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
