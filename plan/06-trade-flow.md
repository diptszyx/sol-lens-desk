# P5 — Trade Flow

## Goal
User selects token → enters SOL amount → clicks BUY → Privy signs → tx sent → confirmation shown.

## Full Flow

```
User clicks BUY (amount: 0.1 SOL)
    │
    ▼ [Tauri invoke]
Rust: build_swap_transaction(SwapParams)
    ├── GET https://quote-api.jup.ag/v6/quote
    │   params: inputMint=SOL, outputMint=TOKEN, amount=100000000 (lamports)
    │   slippage_bps=300 (3%)
    │   → QuoteResponse
    ├── GET https://quote-api.jup.ag/v6/swap-instructions
    │   body: { quoteResponse, userPublicKey, ... }
    │   → SwapInstructions
    ├── Build VersionedTransaction
    │   - fetch recent blockhash
    │   - compose instructions
    │   - serialize → base64
    │   → return base64 to frontend
    │
    ▼ [frontend]
Privy: signTransaction(deserialize(base64))
    → signed base64
    │
    ▼ [Tauri invoke]
Rust: send_transaction(signed_base64)
    ├── deserialize
    ├── rpc.send_and_confirm_transaction()
    └── return { signature, status }
    │
    ▼
UI: show success toast + add to portfolio
```

## Implementation

### commands/swap.rs

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};
use solana_sdk::{
    transaction::VersionedTransaction,
    commitment_config::CommitmentConfig,
};
use base64::{Engine, engine::general_purpose::STANDARD};

const JUPITER_QUOTE_URL: &str = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP_URL: &str = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT: &str = "So11111111111111111111111111111111111111112";

#[derive(Debug, Serialize, Deserialize)]
pub struct SwapParams {
    pub output_mint: String,
    pub amount_lamports: u64,
    pub slippage_bps: u32,
    pub user_public_key: String,
}

#[derive(Debug, Serialize)]
pub struct BuildTxResult {
    pub serialized_tx: String,   // base64 unsigned
    pub out_amount: u64,
    pub price_impact_pct: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TxResult {
    pub signature: String,
    pub status: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn build_swap_transaction(
    params: SwapParams,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BuildTxResult, String> {
    let http = Client::new();

    // 1. Get quote
    let quote_resp = http
        .get(JUPITER_QUOTE_URL)
        .query(&[
            ("inputMint", SOL_MINT),
            ("outputMint", &params.output_mint),
            ("amount", &params.amount_lamports.to_string()),
            ("slippageBps", &params.slippage_bps.to_string()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let quote: serde_json::Value = quote_resp.json().await.map_err(|e| e.to_string())?;
    
    let out_amount: u64 = quote["outAmount"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or("missing outAmount")?;
    
    let price_impact: f64 = quote["priceImpactPct"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);

    // 2. Get swap transaction
    let swap_body = serde_json::json!({
        "quoteResponse": quote,
        "userPublicKey": params.user_public_key,
        "wrapAndUnwrapSol": true,
        "dynamicComputeUnitLimit": true,
        "prioritizationFeeLamports": "auto",
    });

    let swap_resp = http
        .post(JUPITER_SWAP_URL)
        .json(&swap_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let swap_data: serde_json::Value = swap_resp.json().await.map_err(|e| e.to_string())?;
    
    let serialized_tx = swap_data["swapTransaction"]
        .as_str()
        .ok_or("missing swapTransaction")?
        .to_string();

    Ok(BuildTxResult {
        serialized_tx,
        out_amount,
        price_impact_pct: price_impact,
    })
}

#[tauri::command]
pub async fn send_transaction(
    signed_tx_base64: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<TxResult, String> {
    let bytes = STANDARD.decode(&signed_tx_base64).map_err(|e| e.to_string())?;
    let tx: VersionedTransaction = bincode::deserialize(&bytes).map_err(|e| e.to_string())?;

    let sig = state.rpc.client
        .send_and_confirm_transaction_with_spinner_and_config(
            &tx,
            CommitmentConfig::confirmed(),
            solana_client::rpc_config::RpcSendTransactionConfig {
                skip_preflight: false,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(TxResult {
        signature: sig.to_string(),
        status: "confirmed".to_string(),
        error: None,
    })
}
```

### Frontend: TradePanel (src/components/token-detail/TradePanel.tsx)

```tsx
import { invoke } from '@tauri-apps/api/core'
import { useSolanaWallets } from '@privy-io/react-auth'
import { VersionedTransaction } from '@solana/web3.js'
import { useState } from 'react'
import type { TokenInfo, TxResult } from '../../types'

interface Props {
  token: TokenInfo
}

export function TradePanel({ token }: Props) {
  const { wallets } = useSolanaWallets()
  const wallet = wallets.find(w => w.walletClientType === 'privy')
  
  const [amount, setAmount] = useState('0.1')
  const [slippage, setSlippage] = useState(300)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TxResult | null>(null)

  async function handleBuy() {
    if (!wallet) return
    setLoading(true)
    setResult(null)
    
    try {
      // 1. Build unsigned tx
      const { serialized_tx, out_amount, price_impact_pct } = await invoke<{
        serialized_tx: string
        out_amount: number
        price_impact_pct: number
      }>('build_swap_transaction', {
        params: {
          output_mint: token.mint,
          amount_lamports: Math.floor(parseFloat(amount) * 1e9),
          slippage_bps: slippage,
          user_public_key: wallet.address,
        }
      })

      // 2. Deserialize + sign via Privy
      const txBytes = Buffer.from(serialized_tx, 'base64')
      const tx = VersionedTransaction.deserialize(txBytes)
      const signedTx = await wallet.signTransaction(tx)

      // 3. Serialize signed tx + send
      const signedBase64 = Buffer.from(signedTx.serialize()).toString('base64')
      const txResult = await invoke<TxResult>('send_transaction', {
        signedTxBase64: signedBase64,
      })

      setResult(txResult)
    } catch (err) {
      setResult({ signature: '', status: 'failed', error: String(err) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 border-t border-gray-800">
      <div className="flex gap-2 mb-3">
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="SOL amount"
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm"
        />
        <select
          value={slippage}
          onChange={e => setSlippage(Number(e.target.value))}
          className="bg-gray-900 border border-gray-700 rounded px-2 text-white text-sm"
        >
          <option value={100}>1%</option>
          <option value={300}>3%</option>
          <option value={500}>5%</option>
          <option value={1000}>10%</option>
        </select>
      </div>

      <button
        onClick={handleBuy}
        disabled={loading || !wallet}
        className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg py-2.5 font-semibold"
      >
        {loading ? 'Signing...' : `BUY ${token.symbol || token.mint.slice(0, 6)}`}
      </button>

      {result && (
        <div className={`mt-2 text-xs ${
          result.status === 'confirmed' ? 'text-green-400' : 'text-red-400'
        }`}>
          {result.status === 'confirmed'
            ? `✓ ${result.signature.slice(0, 20)}...`
            : `✗ ${result.error}`}
        </div>
      )}
    </div>
  )
}
```

## Acceptance Criteria

- [ ] BUY with 0.1 SOL → tx confirmed on mainnet
- [ ] Price impact shown before confirm (if >5%, show warning)
- [ ] Slippage configurable: 1% / 3% / 5% / 10%
- [ ] Wallet not connected → BUY button disabled
- [ ] Failed tx shows error message, not crash
- [ ] Signature link opens Solscan (optional)
