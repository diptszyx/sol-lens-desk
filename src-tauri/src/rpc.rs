use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use serde::Serialize;
use std::str::FromStr;

const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

#[derive(Debug, Clone, Serialize)]
pub struct SplTokenBalance {
    pub mint: String,
    pub symbol: String,
    pub amount_ui: f64,
    pub decimals: u8,
}

pub struct RpcState {
    pub rpc_url: String,
}

impl RpcState {
    pub fn client(&self) -> RpcClient {
        RpcClient::new(self.rpc_url.clone())
    }
}

pub async fn fetch_mint_authorities(rpc_url: &str, mint: &str) -> anyhow::Result<(bool, bool)> {
    let client = RpcClient::new(rpc_url.to_string());
    let pubkey = Pubkey::from_str(mint)?;
    let account = client.get_account(&pubkey).await?;

    let data = &account.data;
    if data.len() < 82 {
        anyhow::bail!("account data too short for Mint: {} bytes", data.len());
    }

    let mint_auth_tag = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let freeze_auth_tag = u32::from_le_bytes([data[46], data[47], data[48], data[49]]);

    Ok((mint_auth_tag == 0, freeze_auth_tag == 0))
}

#[tauri::command]
pub async fn get_sol_balance(
    address: String,
    state: tauri::State<'_, RpcState>,
) -> Result<f64, String> {
    let pubkey = Pubkey::from_str(&address).map_err(|e| e.to_string())?;
    let client = state.client();
    let lamports = client.get_balance(&pubkey).await.map_err(|e| e.to_string())?;
    Ok(lamports as f64 / 1_000_000_000.0)
}

#[tauri::command]
pub async fn get_spl_balances(
    address: String,
    state: tauri::State<'_, RpcState>,
) -> Result<Vec<SplTokenBalance>, String> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "sol-lens",
        "method": "getAssetsByOwner",
        "params": {
            "ownerAddress": address,
            "page": 1,
            "limit": 1000,
            "displayOptions": {
                "showFungible": true,
                "showNativeBalance": true
            }
        }
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&state.rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Helius DAS fetch failed: {e}"))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Helius DAS parse failed: {e}"))?;

    let items = match json["result"]["items"].as_array() {
        Some(arr) => arr,
        None => return Ok(vec![]),
    };

    let mut balances: Vec<SplTokenBalance> = Vec::new();

    for item in items {
        let iface = item["interface"].as_str().unwrap_or("");
        if iface != "FungibleToken" && iface != "FungibleAsset" {
            continue;
        }
        let mint = item["id"].as_str().unwrap_or("");
        if mint.is_empty() {
            continue;
        }
        let token_info = &item["token_info"];
        let balance_raw = token_info["balance"].as_f64().unwrap_or(0.0);
        let decimals = token_info["decimals"].as_u64().unwrap_or(0) as u8;
        if balance_raw == 0.0 {
            continue;
        }
        let amount_ui = balance_raw / 10f64.powi(decimals as i32);
        let symbol = token_info["symbol"].as_str().unwrap_or("").to_string();

        balances.push(SplTokenBalance { mint: mint.to_string(), symbol, amount_ui, decimals });
    }

    // Sort: stablecoins first, then by amount desc
    balances.sort_by(|a, b| {
        let a_stable = a.mint == USDC_MINT || a.mint == USDT_MINT;
        let b_stable = b.mint == USDC_MINT || b.mint == USDT_MINT;
        b_stable
            .cmp(&a_stable)
            .then(b.amount_ui.partial_cmp(&a.amount_ui).unwrap_or(std::cmp::Ordering::Equal))
    });

    balances.truncate(50);
    Ok(balances)
}
