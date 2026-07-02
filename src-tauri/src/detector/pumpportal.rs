use tokio_tungstenite::connect_async;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use serde::Deserialize;
use serde_json::json;
use anyhow::Result;

use super::RawTokenEvent;

#[derive(Debug, Deserialize)]
struct PumpPortalEvent {
    signature: Option<String>,
    mint: Option<String>,
    name: Option<String>,
    symbol: Option<String>,
    uri: Option<String>,
    #[serde(rename = "solAmount")]
    sol_amount: Option<f64>,
    #[serde(rename = "marketCapSol")]
    market_cap_sol: Option<f64>,
    #[serde(rename = "txType")]
    tx_type: Option<String>,
    pool: Option<String>,
    #[serde(rename = "traderPublicKey")]
    trader_public_key: Option<String>,
    #[serde(rename = "initialBuy")]
    initial_buy: Option<f64>,
    #[serde(rename = "vSolInBondingCurve")]
    v_sol_in_bonding_curve: Option<f64>,
    #[serde(rename = "vTokensInBondingCurve")]
    v_tokens_in_bonding_curve: Option<f64>,
}

pub async fn listen(tx: mpsc::Sender<RawTokenEvent>) -> Result<()> {
    loop {
        match try_listen(&tx).await {
            Ok(_) => {
                tracing::info!("PumpPortal WS closed cleanly. Reconnecting in 3s...");
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
            Err(e) => {
                tracing::warn!("PumpPortal WS disconnected: {e}. Reconnecting in 5s...");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn try_listen(tx: &mpsc::Sender<RawTokenEvent>) -> Result<()> {
    let (mut ws, _) = connect_async("wss://pumpportal.fun/api/data").await?;

    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({ "method": "subscribeNewToken" }).to_string(),
    ))
    .await?;

    tracing::info!("PumpPortal WS connected, listening for new tokens...");

    loop {
        let msg = match tokio::time::timeout(std::time::Duration::from_secs(15), ws.next()).await {
            Ok(Some(m)) => m,
            Ok(None) => break, // stream closed cleanly
            Err(_) => {
                tracing::warn!("PumpPortal WS idle for 15s, reconnecting...");
                return Err(anyhow::anyhow!("idle timeout"));
            }
        };

        let text = match msg? {
            tokio_tungstenite::tungstenite::Message::Text(t) => t,
            tokio_tungstenite::tungstenite::Message::Ping(payload) => {
                let _ = ws.send(tokio_tungstenite::tungstenite::Message::Pong(payload)).await;
                continue;
            }
            _ => continue,
        };

        let Ok(event) = serde_json::from_str::<PumpPortalEvent>(&text) else {
            continue;
        };

        if event.tx_type.as_deref() != Some("create") {
            continue;
        }
        // Only bonding-curve creates are tradeable right now (pumpfun_direct.rs has no
        // PumpSwap/Raydium path yet) — skip other pool types instead of enriching them
        // and dropping later, wastes an RPC round-trip and produces confusing noise.
        match event.pool.as_deref() {
            Some("pump") | None => {}
            Some(other) => {
                tracing::debug!("Skipping non-bonding-curve create event (pool={other})");
                continue;
            }
        }
        let (Some(mint), Some(sig)) = (event.mint, event.signature) else {
            continue;
        };

        let source = "pump_fun".to_string();

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        tracing::debug!("PumpPortal new token: {} ({})", event.symbol.as_deref().unwrap_or("?"), mint);

        let _ = tx
            .send(RawTokenEvent {
                signature: sig,
                source,
                detected_at: now_ms,
                mint: Some(mint),
                symbol: event.symbol,
                name: event.name,
                uri: event.uri,
                market_cap_sol: event.market_cap_sol,
                initial_sol: event.sol_amount,
                dev_address: event.trader_public_key,
                dev_token_amount: event.initial_buy,
                v_sol_in_curve: event.v_sol_in_bonding_curve,
                v_tokens_in_curve: event.v_tokens_in_bonding_curve,
            })
            .await;
    }

    Ok(())
}
