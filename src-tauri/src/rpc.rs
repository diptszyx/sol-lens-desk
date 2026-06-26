use solana_client::nonblocking::rpc_client::RpcClient;

pub struct RpcState {
    pub rpc_url: String,
}

impl RpcState {
    pub fn client(&self) -> RpcClient {
        RpcClient::new(self.rpc_url.clone())
    }
}
