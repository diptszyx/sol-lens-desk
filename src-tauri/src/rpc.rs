use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

const RPC_SETTINGS_FILE: &str = "sol-lens.settings.json";
const RPC_SETTINGS_KEY: &str = "rpcUrl";

pub struct RpcState {
    pub rpc_url: Arc<RwLock<String>>,
    pub app_handle: tauri::AppHandle,
}

impl RpcState {
    pub async fn get_url(&self) -> String {
        self.rpc_url.read().await.clone()
    }

    pub fn client_sync(url: &str) -> RpcClient {
        RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed())
    }

    async fn persist_url(&self, url: &str) -> Result<(), String> {
        let store = self.app_handle
            .store(RPC_SETTINGS_FILE)
            .map_err(|e| e.to_string())?;
        store.set(RPC_SETTINGS_KEY.to_string(), serde_json::Value::String(url.to_string()));
        store.save().map_err(|e| e.to_string())
    }
}

pub async fn fetch_mint_authorities(rpc_url: &str, mint: &str) -> anyhow::Result<(bool, bool)> {
    let client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
    let pubkey = Pubkey::from_str(mint)?;
    let account = client.get_account(&pubkey).await?;

    let data = &account.data;
    if data.len() < 82 {
        anyhow::bail!("account data too short for Mint: {} bytes", data.len());
    }

    const SPL_TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const SPL_TOKEN_2022_PROGRAM: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    let owner_str = account.owner.to_string();
    if owner_str != SPL_TOKEN_PROGRAM && owner_str != SPL_TOKEN_2022_PROGRAM {
        anyhow::bail!("not an SPL token mint account (owner: {})", account.owner);
    }

    let mint_auth_tag = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let freeze_auth_tag = u32::from_le_bytes([data[46], data[47], data[48], data[49]]);

    Ok((mint_auth_tag == 0, freeze_auth_tag == 0))
}

pub async fn load_saved_rpc_url(app_handle: &tauri::AppHandle, default_url: &str) -> String {
    let store = match app_handle.store(RPC_SETTINGS_FILE) {
        Ok(s) => s,
        Err(_) => return default_url.to_string(),
    };
    match store.get(RPC_SETTINGS_KEY) {
        Some(serde_json::Value::String(url)) if !url.is_empty() => url,
        _ => default_url.to_string(),
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn test_rpc_connection(url: String) -> Result<u64, String> {
    let start = std::time::Instant::now();
    let client = RpcClient::new_with_commitment(url.clone(), CommitmentConfig::confirmed());

    // Use get_health as a lightweight ping
    client.get_health().await.map_err(|e| format!("RPC health check failed: {e}"))?;
    let latency_ms = start.elapsed().as_millis() as u64;

    // Quick sanity: try fetching a known account
    let fee_payer = Pubkey::from_str("So11111111111111111111111111111111111111112")
        .map_err(|e| e.to_string())?;
    client.get_balance(&fee_payer).await
        .map_err(|e| format!("RPC balance check failed: {e}"))?;

    Ok(latency_ms)
}

#[tauri::command]
pub async fn set_rpc_url(
    url: String,
    state: tauri::State<'_, RpcState>,
) -> Result<(), String> {
    // Validate URL format
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("RPC URL must start with https:// or http://".to_string());
    }
    // Quick connection test
    test_rpc_connection(url.clone()).await?;

    // Update in-memory state
    *state.rpc_url.write().await = url.clone();

    // Persist to settings
    state.persist_url(&url).await?;

    tracing::info!("RPC URL updated to: {}", url);
    Ok(())
}

#[tauri::command]
pub async fn get_rpc_url(state: tauri::State<'_, RpcState>) -> Result<String, String> {
    let url = state.get_url().await;
    // Mask API key in URL for display safety
    Ok(mask_rpc_url(&url))
}

#[tauri::command]
pub async fn get_sol_balance(
    address: String,
    state: tauri::State<'_, RpcState>,
) -> Result<f64, String> {
    let pubkey = Pubkey::from_str(&address).map_err(|e| e.to_string())?;
    let url = state.get_url().await;
    let client = RpcState::client_sync(&url);
    let lamports = client.get_balance(&pubkey).await.map_err(|e| e.to_string())?;
    Ok(lamports as f64 / 1_000_000_000.0)
}

fn mask_rpc_url(url: &str) -> String {
    // Mask API key query params: key=abc123... → key=abc1***
    if let Some(pos) = url.find("?api-key=").or_else(|| url.find("&api-key=")) {
        let key_start = pos + url[pos..].find('=').unwrap_or(0) + 1;
        let (base, key_part) = url.split_at(key_start);
        if key_part.len() > 4 {
            format!("{}{}***", base, &key_part[..4])
        } else {
            format!("{}***", base)
        }
    } else {
        url.to_string()
    }
}
