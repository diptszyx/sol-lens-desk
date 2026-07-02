use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use crate::config;
use crate::detector::RawTokenEvent;
use crate::rpc;

const PUMP_TOTAL_SUPPLY: f64 = 1_000_000_000.0;
const PUMP_INIT_VTOKENS: f64 = 1_073_000_000.0;
const PUMP_GRAD_RESERVE: f64 = 206_900_000.0;

static SOL_PRICE_CACHE: Mutex<Option<(f64, Instant)>> = Mutex::new(None);
static SOL_PRICE_WARN_LOGGED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreBreakdown {
    pub dev_hold_safety: u32,
    pub bonding_curve_signal: u32,
    pub dev_buy_signal: u32,
    pub socials_signal: u32,
}

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
    pub twitter_url: Option<String>,
    pub telegram_url: Option<String>,
    pub website_url: Option<String>,
    pub mint_authority_revoked: bool,
    pub freeze_authority_revoked: bool,
    pub score: u8,
    pub score_breakdown: ScoreBreakdown,
}

pub(crate) async fn get_sol_price_usd() -> Option<f64> {
    {
        if let Ok(cache) = SOL_PRICE_CACHE.lock() {
            if let Some((price, ts)) = *cache {
                if ts.elapsed() < Duration::from_secs(config::SOL_PRICE_CACHE_TTL_SECS) {
                    return Some(price);
                }
            }
        }
    }

    let url = "https://api.jup.ag/tokens/v2/search?query=So11111111111111111111111111111111111111112";
    if let Ok(resp) = reqwest::get(url).await {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            if let Some(price) = json[0]["usdPrice"].as_f64() {
                if let Ok(mut cache) = SOL_PRICE_CACHE.lock() {
                    *cache = Some((price, Instant::now()));
                }
                SOL_PRICE_WARN_LOGGED.store(false, Ordering::Relaxed);
                return Some(price);
            }
        }
    }

    if let Ok(cache) = SOL_PRICE_CACHE.lock() {
        if let Some((price, ts)) = *cache {
            tracing::warn!("Jupiter price fetch failed — using stale SOL price ${price:.2} ({:.0}s old)", ts.elapsed().as_secs());
            return Some(price);
        }
    }

    if !SOL_PRICE_WARN_LOGGED.swap(true, Ordering::Relaxed) {
        tracing::warn!("SOL price unavailable — USD values will be None");
    }
    None
}

pub async fn enrich(event: &RawTokenEvent, rpc_url: &str) -> Option<TokenInfo> {
    let mint = event.mint.as_ref()?;
    tracing::debug!("enrich: received {mint}");

    let (mint_authority_revoked, freeze_authority_revoked) =
        match rpc::fetch_mint_authorities(rpc_url, mint).await {
            Ok((ma, fa)) => {
                if !ma || !fa {
                    tracing::info!(
                        "Dropped {mint} — authority not revoked (mint_revoked={ma}, freeze_revoked={fa})"
                    );
                    return None;
                }
                (ma, fa)
            }
            Err(e) => {
                let err_str = e.to_string().to_lowercase();
                if err_str.contains("account not found") || err_str.contains("accountnotfound") {
                    // Timing race — pump.fun WS fires before on-chain confirmation.
                    // Retry once after 2.5 s; silent drop if still not found.
                    tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
                    match rpc::fetch_mint_authorities(rpc_url, mint).await {
                        Ok((ma, fa)) => {
                            if !ma || !fa {
                                tracing::info!(
                                    "Dropped {mint} — authority not revoked after retry (mint_revoked={ma}, freeze_revoked={fa})"
                                );
                                return None;
                            }
                            (ma, fa)
                        }
                        Err(e2) => {
                            tracing::info!("Dropped {mint} — still not found after retry: {e2}");
                            return None;
                        }
                    }
                } else if err_str.contains("not an spl token mint account") {
                    tracing::warn!("Dropped {mint} — owner is neither SPL Token nor Token-2022: {e}");
                    return None;
                } else {
                    tracing::warn!("Dropped {mint} — fetch_mint_authorities failed: {e}");
                    return None;
                }
            }
        };

    let sol_price_opt = get_sol_price_usd().await;
    let mut token = build_from_event(mint, event, sol_price_opt).await;
    token.mint_authority_revoked = mint_authority_revoked;
    token.freeze_authority_revoked = freeze_authority_revoked;
    let (score, breakdown) = compute_score(&token);
    token.score = score;
    token.score_breakdown = breakdown;
    Some(token)
}

async fn build_from_event(mint: &str, event: &RawTokenEvent, sol_price: Option<f64>) -> TokenInfo {
    let v_sol = event.v_sol_in_curve;
    let v_tokens = event.v_tokens_in_curve;

    let liquidity_sol = v_sol.map(|s| (s - config::PUMP_INIT_VSOL).max(0.0)).unwrap_or(0.0);

    let price_usd = match (v_sol, v_tokens, sol_price) {
        (Some(s), Some(t), Some(sp)) if t > 0.0 => Some((s / t) * sp),
        _ => None,
    };

    let market_cap_usd = event.market_cap_sol.zip(sol_price).map(|(mc, sp)| mc * sp);

    let dev_hold_pct = event
        .dev_token_amount
        .map(|amt| (amt / PUMP_TOTAL_SUPPLY) * 100.0);

    let bonding_curve_pct = v_tokens.map(|vt| {
        let pct = (PUMP_INIT_VTOKENS - vt) / (PUMP_INIT_VTOKENS - PUMP_GRAD_RESERVE) * 100.0;
        pct.clamp(0.0, 100.0)
    });

    let socials = match &event.uri {
        Some(uri) => fetch_socials(uri).await,
        None => None,
    };
    let (has_socials, twitter_url, telegram_url, website_url) = match socials {
        Some((tw, tg, ws)) => {
            let has = tw.is_some() || tg.is_some() || ws.is_some();
            (Some(has), tw, tg, ws)
        }
        None => (None, None, None, None),
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
        twitter_url,
        telegram_url,
        website_url,
        mint_authority_revoked: true,
        freeze_authority_revoked: true,
        score: 0,
        score_breakdown: ScoreBreakdown {
            dev_hold_safety: 0,
            bonding_curve_signal: 0,
            dev_buy_signal: 0,
            socials_signal: 0,
        },
    }
}

fn compute_score(token: &TokenInfo) -> (u8, ScoreBreakdown) {
    let mut dev_hold_safety: u32 = 0;
    let mut bonding_curve_signal: u32 = 0;
    let mut dev_buy_signal: u32 = 0;
    let mut socials_signal: u32 = 0;

    // max 40
    if let Some(dhp) = token.dev_hold_pct {
        if dhp < 5.0 {
            dev_hold_safety = 40;
        } else if dhp < 10.0 {
            dev_hold_safety = 20;
        }
    }

    // max 30
    if let Some(bcp) = token.bonding_curve_pct {
        if bcp >= 30.0 && bcp < 50.0 {
            bonding_curve_signal = 30;
        } else if bcp >= 50.0 && bcp < 70.0 {
            bonding_curve_signal = 20;
        } else if bcp >= 70.0 {
            bonding_curve_signal = 5;
        }
    }

    // max 20
    if let Some(dbs) = token.dev_buy_sol {
        if dbs >= 1.0 {
            dev_buy_signal = 20;
        } else if dbs >= 0.5 {
            dev_buy_signal = 10;
        }
    }

    // max 10
    if token.has_socials == Some(true) {
        socials_signal = 10;
    }

    let breakdown = ScoreBreakdown {
        dev_hold_safety,
        bonding_curve_signal,
        dev_buy_signal,
        socials_signal,
    };

    let score = (dev_hold_safety + bonding_curve_signal + dev_buy_signal + socials_signal) as u8;
    (score, breakdown)
}

async fn fetch_socials(uri: &str) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let json: serde_json::Value = client.get(uri).send().await.ok()?.json().await.ok()?;

    let extract = |key: &str| -> Option<String> {
        json.get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    };

    Some((extract("twitter"), extract("telegram"), extract("website")))
}
