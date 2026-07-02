use std::collections::HashMap;
use std::sync::Arc;
use futures_util::SinkExt;
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::{RwLock, mpsc};

use crate::enricher;
use crate::commands::pumpfun_direct;
use crate::rpc::RpcState;
use tauri::Manager;

/// How long to wait between checking whether a BondingCurve position has graduated.
const GRADUATION_CHECK_INTERVAL_SECS: u64 = 30;
/// How long to wait between polling Jupiter for post-graduation prices.
const JUPITER_POLL_INTERVAL_SECS: u64 = 10;
/// How long to wait between RPC polls of the raw bonding curve — a safety net for
/// when the pumpportal WS goes quiet on a low-volume mint (see fetch_curve_price_usd).
const BONDING_CURVE_POLL_INTERVAL_SECS: u64 = 15;

#[derive(Debug, Clone, PartialEq)]
enum PriceSource {
    BondingCurve,
    JupiterPoll,
}

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

#[derive(Debug, Deserialize)]
struct JupiterPriceResponse {
    data: Option<HashMap<String, JupiterPriceData>>,
}

#[derive(Debug, Deserialize)]
struct JupiterPriceData {
    price: String,
}

#[derive(Debug, Clone)]
struct TrackedPosition {
    /// The vault wallet that owns this position. The backend auto-sell signs as
    /// this wallet, so stop-loss protects it even when the UI is focused on a
    /// different wallet.
    owner_address: String,
    entry_price_usd: f64,
    stop_loss_pct: f64,
    price_source: PriceSource,
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
        let app_ws = app.clone();
        tauri::async_runtime::spawn(async move {
            run_ws(app_ws, positions_clone, sub_rx).await;
        });

        let positions_grad = positions.clone();
        let app_grad = app.clone();
        tauri::async_runtime::spawn(async move {
            run_graduation_loop(app_grad, positions_grad).await;
        });

        let positions_jup = positions.clone();
        let app_jup = app.clone();
        tauri::async_runtime::spawn(async move {
            run_jupiter_poll_loop(app_jup, positions_jup).await;
        });

        let positions_curve_poll = positions.clone();
        let app_curve_poll = app.clone();
        tauri::async_runtime::spawn(async move {
            run_bonding_curve_poll_loop(app_curve_poll, positions_curve_poll).await;
        });

        Self { positions, sub_tx }
    }

    pub async fn subscribe(
        &self,
        mint: String,
        owner_address: String,
        entry_price_usd: f64,
        stop_loss_pct: f64,
    ) {
        self.positions.write().await.insert(
            mint.clone(),
            TrackedPosition {
                owner_address,
                entry_price_usd,
                stop_loss_pct,
                price_source: PriceSource::BondingCurve,
            },
        );
        let _ = self.sub_tx.send(mint);
    }

    pub async fn unsubscribe(&self, mint: &str) {
        self.positions.write().await.remove(mint);
    }
}

async fn check_and_emit_sl(
    app: &AppHandle,
    positions: &Arc<RwLock<HashMap<String, TrackedPosition>>>,
    mint: &str,
    price: f64,
    market_cap_usd: Option<f64>,
) {
    let _ = app.emit(
        "price_updated",
        json!({
            "mint": mint,
            "price_usd": price,
            "market_cap_usd": market_cap_usd,
        }),
    );

    let (entry_price, sl_pct) = {
        let guard = positions.read().await;
        match guard.get(mint) {
            Some(t) => (t.entry_price_usd, t.stop_loss_pct),
            None => return,
        }
    };

    let pnl_pct = ((price - entry_price) / entry_price) * 100.0;
    let sl_threshold = entry_price * (1.0 - sl_pct / 100.0);

    if price <= sl_threshold {
        // Remove atomically and only proceed if we won the race — a concurrent
        // price tick (WS vs poll loops) that also crosses the threshold will get
        // None here and skip, preventing a double auto-sell.
        let Some(tp) = positions.write().await.remove(mint) else {
            return;
        };
        tracing::info!(
            "SL triggered for {mint} (owner {}): entry={entry_price:.6}, current={price:.6}, pnl={pnl_pct:.1}%",
            tp.owner_address
        );
        // Sell off the event loop so network latency doesn't stall price updates
        // for other tracked positions.
        let app = app.clone();
        let positions = positions.clone();
        let mint = mint.to_string();
        tauri::async_runtime::spawn(async move {
            auto_sell(app, positions, mint, tp, price, pnl_pct).await;
        });
    }
}

/// Backend stop-loss auto-sell. Signs as the position owner, so it works for any
/// wallet in the vault regardless of the active/UI wallet. On any failure before
/// the sell is confirmed on-chain, the position is re-inserted into the tracker so
/// SL can retry; after confirmation, bookkeeping errors are logged but never
/// re-subscribe (the tokens are already gone).
async fn auto_sell(
    app: AppHandle,
    positions: Arc<RwLock<HashMap<String, TrackedPosition>>>,
    mint: String,
    tp: TrackedPosition,
    exit_price_usd: f64,
    realized_pnl_pct: f64,
) {
    let owner = tp.owner_address.clone();
    match try_auto_sell(&app, &mint, &owner, exit_price_usd, realized_pnl_pct).await {
        Ok(()) => {}
        Err(e) => {
            tracing::warn!("Auto-sell for {mint} (owner {owner}) not completed: {e} — re-tracking");
            positions.write().await.insert(mint, tp);
        }
    }
}

async fn try_auto_sell(
    app: &AppHandle,
    mint: &str,
    owner: &str,
    exit_price_usd: f64,
    realized_pnl_pct: f64,
) -> Result<(), String> {
    use crate::commands::trade::{fetch_best_quote, send_transaction_inner, QuoteParams, TradeDirection};

    // Cheap pre-check: if the owner wallet is locked/timed out we can't sign — bail
    // before spending a network quote so the retry loop stays quiet until unlock.
    let wallet_state = app.state::<std::sync::Mutex<crate::wallet::WalletState>>();
    if !crate::wallet::owner_available(&wallet_state, owner) {
        return Err("owner wallet locked".to_string());
    }

    let db = app.state::<crate::db::DbPool>();
    let pos = db
        .get_open_position(mint, owner)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "open position not found in db".to_string())?;

    let amount_raw = (pos.amount_tokens * 10f64.powi(pos.decimals as i32)).floor() as u64;
    let qp = QuoteParams {
        input_mint: mint,
        output_mint: None,
        amount: amount_raw,
        slippage_bps: 200,
        user_public_key: owner,
    };
    let build = fetch_best_quote(&qp, TradeDirection::Sell).await?;
    let signed = crate::wallet::sign_tx_as(&wallet_state, owner, &build.serialized_tx)?;

    let rpc_url = app.state::<RpcState>().get_url().await;
    let tx = send_transaction_inner(&signed, &rpc_url).await?;
    if tx.status != "confirmed" {
        return Err(format!("sell not confirmed (status: {})", tx.status));
    }

    // ── Past this point the tokens are sold on-chain. Never re-subscribe; only
    //    best-effort bookkeeping remains. ──────────────────────────────────────
    let mint_pk = solana_sdk::pubkey::Pubkey::try_from(
        bs58::decode(mint).into_vec().unwrap_or_default().as_slice(),
    )
    .map_err(|e| e.to_string());

    let sol_received = match mint_pk {
        Ok(pk) => pumpfun_direct::fetch_actual_curve_sol_delta(&rpc_url, &pk, &tx.signature)
            .await
            .unwrap_or(build.out_amount_ui),
        Err(_) => build.out_amount_ui,
    };

    let now = now_ms();

    if let Err(e) = db
        .log_trade(&crate::db::Trade {
            id: None,
            mint: mint.to_string(),
            symbol: pos.symbol.clone(),
            side: "sell".to_string(),
            amount_sol: sol_received,
            amount_tokens: pos.amount_tokens,
            price_usd: Some(exit_price_usd),
            tx_signature: tx.signature.clone(),
            status: "confirmed".to_string(),
            created_at: now,
            wallet_address: owner.to_string(),
        })
        .await
    {
        tracing::error!("Auto-sell {mint}: log_trade failed: {e}");
    }

    // Mirror the frontend's realized-PnL math (implied USD/SOL from the entry
    // snapshot) so auto-sold and manually-sold rows are computed consistently.
    let implied_usd_per_sol = if pos.amount_sol_spent > 0.0 {
        (pos.amount_tokens * pos.entry_price_usd) / pos.amount_sol_spent
    } else {
        0.0
    };
    let realized_pnl_usd = (sol_received - pos.amount_sol_spent) * implied_usd_per_sol;
    let realized_pnl_pct_final = if pos.amount_sol_spent > 0.0 {
        ((sol_received - pos.amount_sol_spent) / pos.amount_sol_spent) * 100.0
    } else {
        realized_pnl_pct
    };

    if let Err(e) = db
        .close_position(&crate::db::ClosedPosition {
            id: None,
            mint: mint.to_string(),
            symbol: pos.symbol.clone(),
            entry_price_usd: pos.entry_price_usd,
            exit_price_usd,
            amount_sol_spent: pos.amount_sol_spent,
            amount_sol_received: sol_received,
            realized_pnl_usd,
            realized_pnl_pct: realized_pnl_pct_final,
            opened_at: pos.opened_at,
            closed_at: now,
            close_reason: "stop_loss".to_string(),
            wallet_address: owner.to_string(),
        })
        .await
    {
        tracing::error!("Auto-sell {mint}: close_position failed: {e}");
    }

    if let Err(e) = db.delete_open_position(mint, owner).await {
        tracing::error!("Auto-sell {mint}: delete_open_position failed: {e}");
    }

    // UI refresh only — DB is already written server-side. `recorded: true` tells
    // the frontend not to re-record (which would double-count and would use the
    // wrong, active wallet address).
    let _ = app.emit(
        "position_closed",
        json!({
            "mint": mint,
            "close_reason": "stop_loss",
            "exit_price_usd": exit_price_usd,
            "realized_pnl_pct": realized_pnl_pct_final,
            "amount_sol_received": sol_received,
            "recorded": true,
        }),
    );

    tracing::info!(
        "Auto-sold {mint} for owner {owner}: {sol_received:.4} SOL, pnl {realized_pnl_pct_final:.1}%"
    );
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn run_graduation_loop(
    app: AppHandle,
    positions: Arc<RwLock<HashMap<String, TrackedPosition>>>,
) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(
        GRADUATION_CHECK_INTERVAL_SECS,
    ));

    loop {
        interval.tick().await;

        // Read the current RPC URL each cycle — respects live changes from Settings
        // instead of freezing whatever was configured at app startup.
        let rpc_url = app.state::<RpcState>().get_url().await;

        let bonding_mints: Vec<String> = {
            positions
                .read()
                .await
                .iter()
                .filter(|(_, p)| p.price_source == PriceSource::BondingCurve)
                .map(|(m, _)| m.clone())
                .collect()
        };

        for mint in bonding_mints {
            let mint_pk = match solana_sdk::pubkey::Pubkey::try_from(
                bs58::decode(&mint).into_vec().unwrap_or_default()
                    .as_slice()
            ) {
                Ok(pk) => pk,
                Err(e) => {
                    tracing::warn!("Invalid mint pubkey for graduation check: {mint}: {e}");
                    continue;
                }
            };

            match pumpfun_direct::is_curve_complete(&rpc_url, &mint_pk).await {
                Ok(true) => {
                    tracing::info!("Detected graduation for {mint}, switching to Jupiter poll");
                    if let Some(pos) = positions.write().await.get_mut(&mint) {
                        pos.price_source = PriceSource::JupiterPoll;
                    }
                }
                Ok(false) => {}
                Err(e) => {
                    tracing::warn!(
                        "Graduation check failed for {mint}: {e} — will retry next cycle"
                    );
                }
            }
        }
    }
}

async fn run_jupiter_poll_loop(
    app: AppHandle,
    positions: Arc<RwLock<HashMap<String, TrackedPosition>>>,
) {
    let client = reqwest::Client::new();
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(
        JUPITER_POLL_INTERVAL_SECS,
    ));

    loop {
        interval.tick().await;

        let jup_mints: Vec<String> = {
            positions
                .read()
                .await
                .iter()
                .filter(|(_, p)| p.price_source == PriceSource::JupiterPoll)
                .map(|(m, _)| m.clone())
                .collect()
        };

        if jup_mints.is_empty() {
            continue;
        }

        let ids = jup_mints.join(",");
        let url = format!("https://api.jup.ag/price/v2?ids={ids}");

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Jupiter price poll failed: {e}");
                continue;
            }
        };

        let parsed: JupiterPriceResponse = match resp.json().await {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("Jupiter price parse failed: {e}");
                continue;
            }
        };

        let Some(data) = parsed.data else { continue };

        for (mint, price_data) in &data {
            let price: f64 = match price_data.price.parse() {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!("Jupiter price parse failed for {mint}: {e}");
                    continue;
                }
            };

            check_and_emit_sl(&app, &positions, mint, price, None).await;
        }
    }
}

// Complements try_run_ws: pumpportal only pushes an update when a trade actually
// crosses its own indexer, so a mint with real on-chain activity (other wallets
// buying/selling) can still go silent on that feed for minutes. Polling the curve
// directly keeps "Current" price and SL checks honest regardless of WS reliability.
async fn run_bonding_curve_poll_loop(
    app: AppHandle,
    positions: Arc<RwLock<HashMap<String, TrackedPosition>>>,
) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(
        BONDING_CURVE_POLL_INTERVAL_SECS,
    ));

    loop {
        interval.tick().await;

        let bonding_mints: Vec<String> = {
            positions
                .read()
                .await
                .iter()
                .filter(|(_, p)| p.price_source == PriceSource::BondingCurve)
                .map(|(m, _)| m.clone())
                .collect()
        };

        if bonding_mints.is_empty() {
            continue;
        }

        let Some(sol_price) = enricher::get_sol_price_usd().await else {
            tracing::warn!("Curve price poll: SOL/USD price unavailable, skipping this cycle");
            continue;
        };
        let rpc_url = app.state::<RpcState>().get_url().await;

        tracing::info!("Curve price poll: checking {} mint(s)", bonding_mints.len());

        for mint in bonding_mints {
            let mint_pk = match solana_sdk::pubkey::Pubkey::try_from(
                bs58::decode(&mint).into_vec().unwrap_or_default().as_slice(),
            ) {
                Ok(pk) => pk,
                Err(e) => {
                    tracing::warn!("Invalid mint pubkey for curve price poll: {mint}: {e}");
                    continue;
                }
            };

            match pumpfun_direct::fetch_curve_price_usd(&rpc_url, &mint_pk, sol_price).await {
                Ok((price, false)) => {
                    tracing::info!("Curve price poll: {mint} = ${price:.9}");
                    check_and_emit_sl(&app, &positions, &mint, price, None).await;
                }
                Ok((_, true)) => {
                    // Graduated — run_graduation_loop will flip price_source to
                    // JupiterPoll on its own cadence; nothing to emit from here.
                }
                Err(e) => {
                    tracing::warn!("Curve price poll failed for {mint}: {e} — will retry next cycle");
                }
            }
        }
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

                check_and_emit_sl(app, positions, &mint, price, market_cap_usd).await;
            }

            mint = sub_rx.recv() => {
                let Some(mint) = mint else {
                    return Ok(());
                };
                tracing::info!("Price tracker: subscribing to {mint}");
                let msg = json!({ "method": "subscribeTokenTrade", "keys": [&mint] }).to_string();
                if let Err(e) = ws.send(Message::Text(msg)).await {
                    return Err(e.into());
                }
            }
        }
    }
}
