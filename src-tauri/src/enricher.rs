use serde::{Deserialize, Serialize};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::signature::Signature;
use std::str::FromStr;
use crate::detector::RawTokenEvent;

// Approximate SOL price for USD conversions (mcap, price, liquidity filters).
// TODO: replace with a cached live SOL/USD feed for accuracy.
const SOL_USD_APPROX: f64 = 150.0;

// pump.fun bonding-curve constants (token UI units, 6 decimals, 1B supply).
const PUMP_TOTAL_SUPPLY: f64 = 1_000_000_000.0;
const PUMP_INIT_VTOKENS: f64 = 1_073_000_000.0;
const PUMP_GRAD_RESERVE: f64 = 206_900_000.0; // tokens left on curve at graduation

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfo {
    pub mint: String,
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub decimals: u8,
    pub price_usd: Option<f64>,
    pub liquidity_sol: f64,
    pub market_cap_usd: Option<f64>,
    pub volume_24h: Option<f64>,
    pub holder_count: Option<u64>,
    pub age_seconds: u64,
    pub source: String,
    pub detected_at: i64,
    // Meme-trade signals (pump.fun)
    pub dev_address: Option<String>,
    pub dev_hold_pct: Option<f64>,
    pub bonding_curve_pct: Option<f64>,
    pub dev_buy_sol: Option<f64>,
    pub has_socials: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct MarketData {
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub decimals: u8,
    pub price_usd: Option<f64>,
    pub liquidity_sol: f64,
    pub market_cap_usd: Option<f64>,
    pub volume_24h: Option<f64>,
    pub holder_count: Option<u64>,
    pub created_at: Option<i64>,
}

/// Enrich a raw detection into a full token record. No filtering here — the
/// client applies per-user filters so it can adjust them without re-detecting.
pub async fn enrich(
    rpc: &RpcClient,
    event: &RawTokenEvent,
) -> anyhow::Result<Option<TokenInfo>> {
    // pump.fun (and other rich WS sources) pre-fill everything we need; build
    // directly from the bonding-curve payload — accurate and zero extra API calls.
    if let Some(mint) = &event.mint {
        return Ok(Some(build_from_event(mint, event).await));
    }

    // Legacy RPC path: extract mint from tx, then fetch market data.
    let mint = extract_mint(rpc, &event.signature).await?;
    let market = match fetch_market_data(&mint).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Market data fetch failed for {mint}: {e}");
            return Ok(None);
        }
    };

    let age_seconds = market.created_at.map_or(0, |ca| {
        let now = unix_now();
        now.saturating_sub(ca as u64)
    });

    Ok(Some(TokenInfo {
        mint,
        symbol: market.symbol.or_else(|| event.symbol.clone()),
        name: market.name.or_else(|| event.name.clone()),
        decimals: market.decimals,
        price_usd: market.price_usd,
        liquidity_sol: market.liquidity_sol,
        market_cap_usd: market.market_cap_usd,
        volume_24h: market.volume_24h,
        holder_count: market.holder_count,
        age_seconds,
        source: event.source.clone(),
        detected_at: event.detected_at,
        dev_address: None,
        dev_hold_pct: None,
        bonding_curve_pct: None,
        dev_buy_sol: None,
        has_socials: None,
    }))
}

/// Build a TokenInfo from a rich pump.fun WS event (bonding-curve math).
async fn build_from_event(mint: &str, event: &RawTokenEvent) -> TokenInfo {
    let v_sol = event.v_sol_in_curve;
    let v_tokens = event.v_tokens_in_curve;

    // Real liquidity is the SOL sitting in the bonding curve (not the mcap).
    let liquidity_sol = v_sol.unwrap_or(0.0);

    // Spot price from the curve: SOL per token * USD/SOL.
    let price_usd = match (v_sol, v_tokens) {
        (Some(s), Some(t)) if t > 0.0 => Some((s / t) * SOL_USD_APPROX),
        _ => None,
    };

    let market_cap_usd = event.market_cap_sol.map(|mc| mc * SOL_USD_APPROX);

    let dev_hold_pct = event
        .dev_token_amount
        .map(|amt| (amt / PUMP_TOTAL_SUPPLY) * 100.0);

    let bonding_curve_pct = v_tokens.map(|vt| {
        let pct = (PUMP_INIT_VTOKENS - vt) / (PUMP_INIT_VTOKENS - PUMP_GRAD_RESERVE) * 100.0;
        pct.clamp(0.0, 100.0)
    });

    let has_socials = match &event.uri {
        Some(uri) => fetch_has_socials(uri).await,
        None => None,
    };

    TokenInfo {
        mint: mint.to_string(),
        symbol: event.symbol.clone(),
        name: event.name.clone(),
        decimals: 6,
        price_usd,
        liquidity_sol,
        market_cap_usd,
        volume_24h: None,
        holder_count: None,
        age_seconds: 0, // brand new at detection
        source: event.source.clone(),
        detected_at: event.detected_at,
        dev_address: event.dev_address.clone(),
        dev_hold_pct,
        bonding_curve_pct,
        dev_buy_sol: event.initial_sol,
        has_socials,
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Best-effort: fetch token metadata JSON and report whether it has any social link.
async fn fetch_has_socials(uri: &str) -> Option<bool> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let json: serde_json::Value = client.get(uri).send().await.ok()?.json().await.ok()?;
    let has = ["twitter", "telegram", "website"]
        .iter()
        .any(|k| json.get(k).and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty()));
    Some(has)
}

async fn extract_mint(rpc: &RpcClient, signature: &str) -> anyhow::Result<String> {
    let sig = Signature::from_str(signature)?;
    let tx = rpc
        .get_transaction_with_config(
            &sig,
            solana_client::rpc_config::RpcTransactionConfig {
                encoding: Some(solana_transaction_status::UiTransactionEncoding::JsonParsed),
                commitment: Some(solana_sdk::commitment_config::CommitmentConfig::confirmed()),
                max_supported_transaction_version: Some(0),
            },
        )
        .await?;

    let meta = tx
        .transaction
        .meta
        .ok_or_else(|| anyhow::anyhow!("no tx meta"))?;

    let balances = meta.post_token_balances.unwrap_or(vec![]);
    for balance in &balances {
        let mint = balance.mint.clone();
        if mint != "So11111111111111111111111111111111111111112" {
            return Ok(mint);
        }
    }

    anyhow::bail!("could not extract mint from tx {}", signature)
}

async fn fetch_market_data(mint: &str) -> anyhow::Result<MarketData> {
    if let Ok(data) = fetch_jupiter(mint).await {
        return Ok(data);
    }
    fetch_birdeye(mint).await
}

async fn fetch_jupiter(mint: &str) -> anyhow::Result<MarketData> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let resp: Vec<serde_json::Value> = client
        .get("https://api.jup.ag/tokens/v2/search")
        .query(&[("query", mint)])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let token = resp
        .iter()
        .find(|t| t.get("address").and_then(|a| a.as_str()) == Some(mint))
        .ok_or_else(|| anyhow::anyhow!("token {} not found on Jupiter", mint))?;

    Ok(MarketData {
        symbol: token.get("symbol").and_then(|s| s.as_str()).map(String::from),
        name: token.get("name").and_then(|n| n.as_str()).map(String::from),
        decimals: token.get("decimals").and_then(|d| d.as_u64()).unwrap_or(9) as u8,
        price_usd: token.get("price").and_then(|p| p.as_f64()),
        liquidity_sol: token.get("liquidity").and_then(|l| l.as_f64()).unwrap_or(0.0),
        market_cap_usd: token.get("market_cap").and_then(|m| m.as_f64()),
        volume_24h: token.get("volume_24h").and_then(|v| v.as_f64()),
        holder_count: token.get("holders").and_then(|h| h.as_u64()),
        created_at: token.get("created_at").and_then(|c| c.as_i64()),
    })
}

async fn fetch_birdeye(mint: &str) -> anyhow::Result<MarketData> {
    let api_key = std::env::var("BIRDEYE_API_KEY")
        .map_err(|_| anyhow::anyhow!("BIRDEYE_API_KEY not set"))?;
    if api_key.is_empty() {
        anyhow::bail!("BIRDEYE_API_KEY is empty");
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let resp: serde_json::Value = client
        .get("https://public-api.birdeye.so/defi/v3/search")
        .query(&[
            ("keyword", mint),
            ("sort_by", "volume_24h_usd"),
            ("sort_type", "desc"),
            ("offset", "0"),
            ("limit", "1"),
            ("list_by_address", "true"),
        ])
        .header("X-API-KEY", &api_key)
        .header("x-chain", "solana")
        .header("accept", "application/json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let items = resp["data"]["items"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("no items in Birdeye response for {}", mint))?;

    let mut candidates: Vec<&serde_json::Value> = Vec::new();
    for item in items {
        if item["type"].as_str() == Some("token") {
            if let Some(arr) = item["result"].as_array() {
                candidates.extend(arr.iter());
            }
        }
    }

    let token = candidates
        .into_iter()
        .find(|t| t["address"].as_str() == Some(mint))
        .ok_or_else(|| anyhow::anyhow!("token {} not found on Birdeye", mint))?;

    let liquidity_usd = token["liquidity"].as_f64().unwrap_or(0.0);
    // Approximate SOL price for USD→SOL conversion used in liquidity filter
    const SOL_USD_APPROX: f64 = 150.0;

    Ok(MarketData {
        symbol: token["symbol"].as_str().map(String::from),
        name: token["name"].as_str().map(String::from),
        decimals: token["decimals"].as_u64().unwrap_or(9) as u8,
        price_usd: token["price"].as_f64(),
        liquidity_sol: liquidity_usd / SOL_USD_APPROX,
        market_cap_usd: token["mc"].as_f64(),
        volume_24h: token["v24hUSD"].as_f64(),
        holder_count: token["holder"].as_u64(),
        created_at: None,
    })
}
