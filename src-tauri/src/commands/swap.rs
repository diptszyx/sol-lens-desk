use base64::Engine;
use serde::{Deserialize, Serialize};
use solana_sdk::{commitment_config::CommitmentConfig, transaction::VersionedTransaction};
use tokio::time::{timeout, Duration};

const JUPITER_QUOTE_URL: &str = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_URL: &str = "https://api.jup.ag/swap/v1/swap";
const KAMINO_SWAP_URL: &str = "https://api.kamino.finance/kswap/swap/";
const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
const QUOTE_TIMEOUT_MS: u64 = 800;

#[derive(Debug, Serialize, Deserialize)]
pub struct SwapParams {
    pub output_mint: String,
    pub amount_lamports: u64,
    pub slippage_bps: u32,
    pub user_public_key: String,
    pub output_decimals: u8,
}

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

struct Quote {
    provider: &'static str,
    out_amount: u64,
    price_impact_pct: f64,
    /// Pre-built tx (Kamino always provides one; Jupiter provides after build step)
    serialized_tx: Option<String>,
    /// Jupiter raw quote needed to call /swap build
    raw_quote: Option<serde_json::Value>,
}

async fn quote_jupiter(http: &reqwest::Client, params: &SwapParams) -> anyhow::Result<Quote> {
    let resp: serde_json::Value = http
        .get(JUPITER_QUOTE_URL)
        .query(&[
            ("inputMint", SOL_MINT),
            ("outputMint", &params.output_mint),
            ("amount", &params.amount_lamports.to_string()),
            ("slippageBps", &params.slippage_bps.to_string()),
            ("swapMode", "ExactIn"),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let out_amount: u64 = resp["outAmount"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow::anyhow!("Jupiter: missing outAmount"))?;

    let price_impact: f64 = resp["priceImpactPct"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);

    Ok(Quote {
        provider: "jupiter",
        out_amount,
        price_impact_pct: price_impact,
        serialized_tx: None,
        raw_quote: Some(resp),
    })
}

async fn quote_kamino(http: &reqwest::Client, params: &SwapParams) -> anyhow::Result<Quote> {
    let resp: serde_json::Value = http
        .get(KAMINO_SWAP_URL)
        .query(&[
            ("tokenIn", SOL_MINT),
            ("tokenOut", &params.output_mint),
            ("amountIn", &params.amount_lamports.to_string()),
            ("maxSlippageBps", &params.slippage_bps.to_string()),
            ("wallet", &params.user_public_key),
            ("includeSetupIxs", "true"),
            ("wrapAndUnwrapSol", "true"),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let data = &resp["data"];
    let out_amount: u64 = data["expectedAmountOut"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow::anyhow!("Kamino: no route found"))?;

    let tx = data["transaction"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Kamino: no prebuilt transaction"))?
        .to_string();

    Ok(Quote {
        provider: "kamino",
        out_amount,
        price_impact_pct: 0.0,
        serialized_tx: Some(tx),
        raw_quote: None,
    })
}

async fn build_jupiter_tx(
    http: &reqwest::Client,
    raw_quote: serde_json::Value,
    user_public_key: &str,
) -> anyhow::Result<String> {
    let body = serde_json::json!({
        "quoteResponse": raw_quote,
        "userPublicKey": user_public_key,
        "wrapAndUnwrapSol": true,
        "dynamicComputeUnitLimit": true,
        "prioritizationFeeLamports": "auto",
    });

    let resp: serde_json::Value = http
        .post(JUPITER_SWAP_URL)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    resp["swapTransaction"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow::anyhow!("Jupiter: missing swapTransaction"))
}

#[tauri::command]
pub async fn build_swap_transaction(params: SwapParams) -> Result<BuildTxResult, String> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let dur = Duration::from_millis(QUOTE_TIMEOUT_MS);
    let (jup_res, kam_res) = tokio::join!(
        timeout(dur, quote_jupiter(&http, &params)),
        timeout(dur, quote_kamino(&http, &params)),
    );

    let mut quotes: Vec<Quote> = Vec::new();
    if let Ok(Ok(q)) = jup_res {
        quotes.push(q);
    }
    if let Ok(Ok(q)) = kam_res {
        quotes.push(q);
    }

    let best = quotes
        .into_iter()
        .max_by_key(|q| q.out_amount)
        .ok_or_else(|| "No swap route found (Jupiter and Kamino both failed)".to_string())?;

    let serialized_tx = if let Some(tx) = best.serialized_tx {
        tx
    } else {
        build_jupiter_tx(&http, best.raw_quote.unwrap(), &params.user_public_key)
            .await
            .map_err(|e| format!("Jupiter build tx failed: {e}"))?
    };

    let out_amount_ui = best.out_amount as f64 / 10f64.powi(params.output_decimals as i32);

    Ok(BuildTxResult {
        serialized_tx,
        out_amount: best.out_amount,
        out_amount_ui,
        price_impact_pct: best.price_impact_pct,
        provider: best.provider.to_string(),
    })
}

#[tauri::command]
pub async fn send_transaction(
    signed_tx_base64: String,
    state: tauri::State<'_, crate::rpc::RpcState>,
) -> Result<TxResult, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&signed_tx_base64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    let tx: VersionedTransaction =
        bincode::deserialize(&bytes).map_err(|e| format!("tx deserialize failed: {e}"))?;

    let rpc = state.client();

    let sig = rpc
        .send_and_confirm_transaction_with_spinner_and_config(
            &tx,
            CommitmentConfig::confirmed(),
            solana_client::rpc_config::RpcSendTransactionConfig {
                skip_preflight: false,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("Send tx failed: {e}"))?;

    Ok(TxResult {
        signature: sig.to_string(),
        status: "confirmed".to_string(),
        error: None,
    })
}
