use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use crate::detector::RawTokenEvent;
use crate::rpc;

const PUMP_TOTAL_SUPPLY: f64 = 1_000_000_000.0;
const PUMP_INIT_VTOKENS: f64 = 1_073_000_000.0;
const PUMP_GRAD_RESERVE: f64 = 206_900_000.0;

const FALLBACK_SOL_USD: f64 = 150.0;

static SOL_PRICE_CACHE: Mutex<Option<(f64, Instant)>> = Mutex::new(None);

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
    pub dev_address: Option<String>,
    pub dev_hold_pct: Option<f64>,
    pub bonding_curve_pct: Option<f64>,
    pub dev_buy_sol: Option<f64>,
    pub has_socials: Option<bool>,
    pub mint_authority_revoked: bool,
    pub freeze_authority_revoked: bool,
    pub score: u8,
}

pub(crate) async fn get_sol_price_usd() -> f64 {
    {
        if let Ok(cache) = SOL_PRICE_CACHE.lock() {
            if let Some((price, ts)) = *cache {
                if ts.elapsed() < Duration::from_secs(30) {
                    return price;
                }
            }
        }
    }

    let url = "https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112";
    if let Ok(resp) = reqwest::get(url).await {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            if let Some(price_str) = json["data"]["So11111111111111111111111111111111111111112"]["price"].as_str() {
                if let Ok(price) = price_str.parse::<f64>() {
                    if let Ok(mut cache) = SOL_PRICE_CACHE.lock() {
                        *cache = Some((price, Instant::now()));
                    }
                    return price;
                }
            }
        }
    }

    if let Ok(cache) = SOL_PRICE_CACHE.lock() {
        if let Some((price, _)) = *cache {
            return price;
        }
    }
    FALLBACK_SOL_USD
}

pub async fn enrich(event: &RawTokenEvent, rpc_url: &str) -> Option<TokenInfo> {
    let mint = event.mint.as_ref()?;

    let (mint_authority_revoked, freeze_authority_revoked) =
        match rpc::fetch_mint_authorities(rpc_url, mint).await {
            Ok((ma, fa)) => {
                if !ma || !fa {
                    return None;
                }
                (ma, fa)
            }
            Err(_) => (true, true),
        };

    let sol_price = get_sol_price_usd().await;
    let mut token = build_from_event(mint, event, sol_price).await;
    token.mint_authority_revoked = mint_authority_revoked;
    token.freeze_authority_revoked = freeze_authority_revoked;
    token.score = compute_score(&token);
    Some(token)
}

async fn build_from_event(mint: &str, event: &RawTokenEvent, sol_price: f64) -> TokenInfo {
    let v_sol = event.v_sol_in_curve;
    let v_tokens = event.v_tokens_in_curve;

    let liquidity_sol = v_sol.unwrap_or(0.0);

    let price_usd = match (v_sol, v_tokens) {
        (Some(s), Some(t)) if t > 0.0 => Some((s / t) * sol_price),
        _ => None,
    };

    let market_cap_usd = event.market_cap_sol.map(|mc| mc * sol_price);

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
        age_seconds: 0,
        source: event.source.clone(),
        detected_at: event.detected_at,
        dev_address: event.dev_address.clone(),
        dev_hold_pct,
        bonding_curve_pct,
        dev_buy_sol: event.initial_sol,
        has_socials,
        mint_authority_revoked: true,
        freeze_authority_revoked: true,
        score: 0,
    }
}

fn compute_score(token: &TokenInfo) -> u8 {
    let mut safety: u8 = 0;
    let mut signal: u8 = 0;

    if let Some(dhp) = token.dev_hold_pct {
        if dhp < 5.0 {
            safety += 30;
        } else if dhp < 10.0 {
            safety += 15;
        }
    }

    if let Some(bcp) = token.bonding_curve_pct {
        if bcp >= 30.0 && bcp < 50.0 {
            signal += 25;
        } else if bcp >= 50.0 && bcp < 70.0 {
            signal += 15;
        } else if bcp >= 70.0 {
            signal += 5;
        }
    }

    if let Some(dbs) = token.dev_buy_sol {
        if dbs >= 1.0 {
            signal += 15;
        } else if dbs >= 0.5 {
            signal += 8;
        }
    }

    if token.has_socials == Some(true) {
        signal += 10;
    }

    safety + signal
}

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
