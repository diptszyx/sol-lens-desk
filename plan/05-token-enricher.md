# P4 — Token Enricher + Filter

## Goal
Nhận `RawTokenEvent` từ P2 pending queue → enrich với market data từ aggregator APIs → apply user filter → emit `token_detected` lên UI nếu pass.

**Không fetch on-chain data (rug flags)** — memecoin trader không cần mint_authority, freeze_authority, top holder. Chỉ cần symbol, price, liquidity, mcap, volume.

## Data Flow

```
RawTokenEvent (signature + source)
    │
    ▼
Step 1: Fetch tx → extract mint address
    │  Solana RPC: get_transaction(signature)
    ▼
Step 2: Fetch market data
    │  Jupiter v2 search → symbol, name, price, liquidity, mcap, volume, decimals
    │  DexScreener fallback → cho token mới chưa lên Jupiter
    ▼
Step 3: Filter (simple — chỉ filter cơ bản)
    │  ├─ liquidity_sol >= min_liquidity_sol (default: 5 SOL)
    │  └─ blocked_mints (user block list)
    ▼
    Pass → emit "token_detected"
    Fail (no market data / below filter) → skip
```

## Data Sources

| Priority | Source | Data | Keyless? |
|----------|--------|------|----------|
| 1 | Jupiter v2 search | symbol, name, price, liquidity, mcap, volume | Yes |
| 2 | DexScreener | fallback cho token mới chưa lên Jupiter | Yes |

**Không dùng RPC `get_account`** — không cần rug flags.

## Filter Config

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterConfig {
    pub min_liquidity_sol: f64,
    pub blocked_mints: Vec<String>,
}

impl Default for FilterConfig {
    fn default() -> Self {
        Self {
            min_liquidity_sol: 5.0,
            blocked_mints: vec![],
        }
    }
}
```

## TokenInfo (simplified — no rug flags)

```rust
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
}
```

## Implementation

### enricher.rs

```rust
use serde::{Deserialize, Serialize};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::signature::Signature;
use std::str::FromStr;
use crate::detector::RawTokenEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
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

pub async fn enrich(
    rpc: &RpcClient,
    event: &RawTokenEvent,
    config: &FilterConfig,
) -> anyhow::Result<Option<TokenInfo>> {
    // 1. Extract mint from tx
    let mint = extract_mint(rpc, &event.signature).await?;

    // 2. Fetch market data (Jupiter → DexScreener)
    let market = fetch_market_data(&mint).await?;

    // 3. Build token info
    let age_seconds = market.created_at.map_or(0, |ca| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        now.saturating_sub(ca as u64)
    });

    let token = TokenInfo {
        mint,
        symbol: market.symbol,
        name: market.name,
        decimals: market.decimals,
        price_usd: market.price_usd,
        liquidity_sol: market.liquidity_sol,
        market_cap_usd: market.market_cap_usd,
        volume_24h: market.volume_24h,
        holder_count: market.holder_count,
        age_seconds,
        source: event.source.clone(),
        detected_at: event.detected_at,
    };

    // 4. Filter
    if token.liquidity_sol < config.min_liquidity_sol {
        return Ok(None);
    }
    if config.blocked_mints.contains(&token.mint) {
        return Ok(None);
    }

    Ok(Some(token))
}

async fn extract_mint(rpc: &RpcClient, signature: &str) -> anyhow::Result<String> {
    let sig = Signature::from_str(signature)?;
    let tx = rpc.get_transaction_with_config(
        &sig,
        solana_client::rpc_config::RpcTransactionConfig {
            encoding: Some(solana_transaction_status::UiTransactionEncoding::JsonParsed),
            commitment: Some(solana_sdk::commitment_config::CommitmentConfig::confirmed()),
            max_supported_transaction_version: Some(0),
        },
    ).await?;

    // Parse transaction instructions to find the mint
    // Pump.fun creates token via its program — extract mint from inner instructions
    let meta = tx.transaction.meta.as_ref()
        .ok_or_else(|| anyhow::anyhow!("no tx meta"))?;

    // Look for token mint in post token balances or inner instructions
    for inner in &meta.inner_instructions {
        for ix in &inner.instructions {
            // Parse instruction for mint creation
            // Pump.fun pattern: the new mint appears in postTokenBalances
        }
    }

    // Fallback: extract from postTokenBalances
    if let Some(balances) = &meta.post_token_balances {
        if let Some(balance) = balances.first() {
            return Ok(balance.mint.clone());
        }
    }

    anyhow::bail!("could not extract mint from tx")
}

async fn fetch_market_data(mint: &str) -> anyhow::Result<MarketData> {
    if let Ok(data) = fetch_jupiter(mint).await {
        return Ok(data);
    }
    fetch_dexscreener(mint).await
}

async fn fetch_jupiter(mint: &str) -> anyhow::Result<MarketData> {
    let client = reqwest::Client::new();
    let resp: Vec<serde_json::Value> = client
        .get("https://api.jup.ag/tokens/v2/search")
        .query(&[("query", mint)])
        .header("Accept", "application/json")
        .send()
        .await?
        .json()
        .await?;

    let token = resp.iter().find(|t| {
        t.get("address").and_then(|a| a.as_str()) == Some(mint)
    });

    match token {
        Some(t) => Ok(MarketData {
            symbol: t.get("symbol").and_then(|s| s.as_str()).map(String::from),
            name: t.get("name").and_then(|n| n.as_str()).map(String::from),
            decimals: t.get("decimals").and_then(|d| d.as_u64()).unwrap_or(9) as u8,
            price_usd: t.get("price").and_then(|p| p.as_f64()),
            liquidity_sol: t.get("liquidity").and_then(|l| l.as_f64()).unwrap_or(0.0),
            market_cap_usd: t.get("market_cap").and_then(|m| m.as_f64()),
            volume_24h: t.get("volume_24h").and_then(|v| v.as_f64()),
            holder_count: t.get("holders").and_then(|h| h.as_u64()),
            created_at: t.get("created_at").and_then(|c| c.as_i64()),
        }),
        None => anyhow::bail!("token not found on Jupiter"),
    }
}

async fn fetch_dexscreener(mint: &str) -> anyhow::Result<MarketData> {
    let client = reqwest::Client::new();
    let url = format!("https://api.dexscreener.com/latest/dex/tokens/{}", mint);
    let resp: serde_json::Value = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await?
        .json()
        .await?;

    let pairs = resp["pairs"].as_array()
        .ok_or_else(|| anyhow::anyhow!("no pairs"))?;

    let pair = pairs.first()
        .ok_or_else(|| anyhow::anyhow!("no pairs found"))?;

    let price = pair["priceUsd"].as_str()
        .and_then(|s| s.parse::<f64>().ok());

    let liquidity = pair["liquidity"]["usd"].as_f64()
        .or_else(|| pair["liquidity"]["base"].as_f64())
        .unwrap_or(0.0);

    Ok(MarketData {
        symbol: pair["baseToken"]["symbol"].as_str().map(String::from),
        name: pair["baseToken"]["name"].as_str().map(String::from),
        decimals: 9, // DexScreener doesn't always return decimals
        price_usd: price,
        liquidity_sol: liquidity / price.unwrap_or(1.0), // rough SOL estimate
        market_cap_usd: pair["marketCap"].as_f64(),
        volume_24h: pair["volume"]["h24"].as_f64(),
        holder_count: None,
        created_at: pair["pairCreatedAt"].as_i64(),
    })
}
```

## Acceptance Criteria

- [ ] Mint extracted from tx signature for Pump.fun tokens
- [ ] Symbol + name + price fetched from Jupiter
- [ ] DexScreener fallback works when Jupiter doesn't have the token
- [ ] Filter: tokens below min_liquidity_sol not emitted
- [ ] Blocked mints not emitted
- [ ] Failed enrichment → token skipped, no crash, no UI notification
- [ ] Enrichment runs per token in spawned task (non-blocking)
- [ ] Market data fetch < 3s per token
