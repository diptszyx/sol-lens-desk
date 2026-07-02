use serde::{Deserialize, Serialize};

use super::trade::{BuildTxResult, QuoteParams, TradeDirection, TxResult, fetch_best_quote, send_transaction_inner};

#[derive(Debug, Serialize, Deserialize)]
pub struct SellParams {
    pub input_mint: String,
    pub amount_tokens: u64,
    pub slippage_bps: u32,
    pub user_public_key: String,
    pub input_decimals: u8,
}

#[tauri::command]
pub async fn build_sell_transaction(params: SellParams) -> Result<BuildTxResult, String> {
    let qp = QuoteParams {
        input_mint: &params.input_mint,
        output_mint: None,
        amount: params.amount_tokens,
        slippage_bps: params.slippage_bps,
        user_public_key: &params.user_public_key,
    };
    fetch_best_quote(&qp, TradeDirection::Sell).await
}

#[tauri::command]
pub async fn send_sell_transaction(
    signed_tx_base64: String,
    state: tauri::State<'_, crate::rpc::RpcState>,
) -> Result<TxResult, String> {
    let url = state.get_url().await;
    send_transaction_inner(&signed_tx_base64, &url).await
}
