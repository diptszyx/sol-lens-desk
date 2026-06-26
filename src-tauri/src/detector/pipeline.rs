use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter};
use solana_client::nonblocking::rpc_client::RpcClient;

use super::RawTokenEvent;
use crate::enricher;

pub const PENDING_QUEUE_CAP: usize = 500;

pub struct Pipeline {
    rx: mpsc::Receiver<RawTokenEvent>,
    rpc_url: String,
    app: AppHandle,
}

impl Pipeline {
    pub fn new(rx: mpsc::Receiver<RawTokenEvent>, rpc_url: String, app: AppHandle) -> Self {
        Self { rx, rpc_url, app }
    }

    pub async fn run(&mut self) {
        tracing::info!("Pipeline started, waiting for token events...");

        while let Some(event) = self.rx.recv().await {
            let rpc = RpcClient::new(self.rpc_url.clone());
            let app = self.app.clone();

            tokio::spawn(async move {
                match enricher::enrich(&rpc, &event).await {
                    Ok(Some(token)) => {
                        tracing::info!(
                            "Token detected: {} (source: {}, liq: {} SOL)",
                            token.symbol.as_deref().unwrap_or("?"),
                            token.source,
                            token.liquidity_sol,
                        );
                        app.emit("token_detected", &token).ok();
                    }
                    Ok(None) => {
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
