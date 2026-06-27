use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

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
