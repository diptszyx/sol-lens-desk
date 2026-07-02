use serde::{Deserialize, Serialize};

use super::trade::{BuildTxResult, QuoteParams, TradeDirection, TxResult, fetch_best_quote, send_transaction_inner};

#[derive(Debug, Serialize, Deserialize)]
pub struct SwapParams {
    pub input_mint: String,
    pub output_mint: String,
    pub amount_lamports: u64,
    pub slippage_bps: u32,
    pub user_public_key: String,
    pub output_decimals: u8,
}

#[tauri::command]
pub async fn build_swap_transaction(params: SwapParams) -> Result<BuildTxResult, String> {
    let qp = QuoteParams {
        input_mint: &params.input_mint,
        output_mint: Some(&params.output_mint),
        amount: params.amount_lamports,
        slippage_bps: params.slippage_bps,
        user_public_key: &params.user_public_key,
    };
    let mut result = fetch_best_quote(&qp, TradeDirection::Buy).await?;
    result.out_amount_ui = result.out_amount as f64 / 10f64.powi(params.output_decimals as i32);
    Ok(result)
}

#[tauri::command]
pub async fn send_transaction(
    signed_tx_base64: String,
    state: tauri::State<'_, crate::rpc::RpcState>,
) -> Result<TxResult, String> {
    let url = state.get_url().await;
    send_transaction_inner(&signed_tx_base64, &url).await
}
