use base64::Engine;
use serde::{Deserialize, Serialize};
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey, transaction::VersionedTransaction};
use std::str::FromStr;

use super::pumpfun_direct;

/// Exposes the cached SOL/USD rate to the frontend so it can compute entry_price_usd
/// from the actual executed swap (amount spent / tokens received) instead of reusing
/// the token feed's last enrichment snapshot, which can be stale by several seconds
/// or more by the time the user actually clicks buy.
#[tauri::command]
pub async fn get_sol_price_usd() -> Option<f64> {
    crate::enricher::get_sol_price_usd().await
}

/// Returns the exact SOL amount that moved through the bonding curve for a
/// confirmed buy/sell — see fetch_actual_curve_sol_delta for why this can't be
/// taken from the quote or the user's typed amount.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_actual_swap_sol(
    mint: String,
    signature: String,
    state: tauri::State<'_, crate::rpc::RpcState>,
) -> Result<f64, String> {
    let mint_pk = Pubkey::from_str(&mint).map_err(|e| e.to_string())?;
    let url = state.get_url().await;
    pumpfun_direct::fetch_actual_curve_sol_delta(&url, &mint_pk, &signature)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy)]
pub enum TradeDirection { Buy, Sell }

#[derive(Debug, Serialize)]
pub struct BuildTxResult {
    pub serialized_tx: String,
    pub out_amount: u64,
    pub out_amount_ui: f64,
    pub price_impact_pct: f64,
    pub provider: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TxResult {
    pub signature: String,
    pub status: String,
    pub error: Option<String>,
}

pub struct QuoteParams<'a> {
    /// Buy: the asset the user is paying with (must match the target curve's quote_mint).
    /// Sell: unused — the sold asset is always the target mint itself.
    pub input_mint: &'a str,
    /// Buy: the pump.fun mint being purchased. Sell: unused (`input_mint` carries it instead).
    pub output_mint: Option<&'a str>,
    pub amount: u64,
    pub slippage_bps: u32,
    pub user_public_key: &'a str,
}

pub async fn fetch_best_quote(
    params: &QuoteParams<'_>,
    direction: TradeDirection,
) -> Result<BuildTxResult, String> {
    let user_pubkey = Pubkey::from_str(params.user_public_key)
        .map_err(|e| format!("Invalid public key: {e}"))?;

    let rpc_url = crate::helius_rpc_url()
        .ok_or_else(|| "No Helius RPC configured — set a Helius API key/RPC URL in Settings".to_string())?;

    match direction {
        TradeDirection::Buy => {
            let output_mint = params
                .output_mint
                .ok_or_else(|| "output_mint is required for buy".to_string())?;

            let (tx, expected_tokens, _quote_decimals) = pumpfun_direct::build_pumpfun_buy_tx(
                output_mint,
                params.input_mint,
                &user_pubkey,
                params.amount,
                params.slippage_bps,
                &rpc_url,
            )
            .await
            .map_err(|e| {
                tracing::warn!("Buy build failed for {output_mint}: {e}");
                format!("PumpFun buy failed: {e}")
            })?;

            // pump.fun mints use 6 decimals; swap.rs recomputes out_amount_ui with the
            // frontend-supplied output_decimals, this is just a reasonable default.
            let out_amount_ui = expected_tokens as f64 / 10f64.powi(6);

            Ok(BuildTxResult {
                serialized_tx: tx,
                out_amount: expected_tokens,
                out_amount_ui,
                price_impact_pct: 0.0,
                provider: "pumpfun_direct".to_string(),
            })
        }
        TradeDirection::Sell => {
            let (tx, expected_quote, quote_decimals) = pumpfun_direct::build_pumpfun_sell_tx(
                params.input_mint,
                &user_pubkey,
                params.amount,
                params.slippage_bps,
                &rpc_url,
            )
            .await
            .map_err(|e| {
                tracing::warn!("Sell build failed for {}: {e}", params.input_mint);
                format!("PumpFun sell failed: {e}")
            })?;

            // quote_decimals read from the curve's actual quote mint — do not assume
            // SOL/9 decimals, some curves may be quoted in a different asset.
            let out_amount_ui = expected_quote as f64 / 10f64.powi(quote_decimals as i32);

            Ok(BuildTxResult {
                serialized_tx: tx,
                out_amount: expected_quote,
                out_amount_ui,
                price_impact_pct: 0.0,
                provider: "pumpfun_direct".to_string(),
            })
        }
    }
}

pub async fn send_transaction_inner(
    signed_tx_base64: &str,
    rpc_url: &str,
) -> Result<TxResult, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(signed_tx_base64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    let tx: VersionedTransaction =
        bincode::deserialize(&bytes).map_err(|e| format!("tx deserialize failed: {e}"))?;

    let rpc = solana_client::nonblocking::rpc_client::RpcClient::new_with_commitment(
        rpc_url.to_string(),
        CommitmentConfig::confirmed(),
    );

    let sig = rpc
        .send_and_confirm_transaction_with_spinner_and_config(
            &tx,
            CommitmentConfig::confirmed(),
            solana_client::rpc_config::RpcSendTransactionConfig {
                // Preflight simulation runs against whichever RPC node answers the call,
                // which can lag behind the node that served get_latest_blockhash during
                // build (common on load-balanced providers) — causing spurious "Blockhash
                // not found" rejections for transactions that are actually still valid.
                // Skipping preflight submits straight to the cluster; a genuinely invalid
                // blockhash still fails the same way on-chain, no funds move either way.
                skip_preflight: true,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| {
            tracing::warn!("Send tx failed: {e}");
            format!("Send tx failed: {e}")
        })?;

    Ok(TxResult {
        signature: sig.to_string(),
        status: "confirmed".to_string(),
        error: None,
    })
}
