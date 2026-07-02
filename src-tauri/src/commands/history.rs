use std::sync::Mutex;
use tauri::State;

use crate::db::{ClosedPosition, DbPool, Trade};
use crate::wallet::WalletState;

fn resolve_active_address(wallet: &WalletState) -> Result<String, String> {
    wallet.active_address_str()
        .map(String::from)
        .ok_or_else(|| "Wallet is locked".to_string())
}

#[tauri::command]
pub async fn log_trade(
    db: State<'_, DbPool>,
    wallet: State<'_, Mutex<WalletState>>,
    mint: String,
    symbol: String,
    side: String,
    amount_sol: f64,
    amount_tokens: f64,
    price_usd: Option<f64>,
    tx_signature: String,
    status: String,
    created_at: i64,
) -> Result<i64, String> {
    let addr = {
        let w = wallet.lock().unwrap();
        resolve_active_address(&w)?
    };
    let trade = Trade {
        id: None,
        mint,
        symbol,
        side,
        amount_sol,
        amount_tokens,
        price_usd,
        tx_signature,
        status,
        created_at,
        wallet_address: addr,
    };
    db.log_trade(&trade).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_closed_position(
    db: State<'_, DbPool>,
    wallet: State<'_, Mutex<WalletState>>,
    mint: String,
    symbol: String,
    entry_price_usd: f64,
    exit_price_usd: f64,
    amount_sol_spent: f64,
    amount_sol_received: f64,
    realized_pnl_usd: f64,
    realized_pnl_pct: f64,
    opened_at: i64,
    closed_at: i64,
    close_reason: String,
) -> Result<(), String> {
    let addr = {
        let w = wallet.lock().unwrap();
        resolve_active_address(&w)?
    };
    let pos = ClosedPosition {
        id: None,
        mint,
        symbol,
        entry_price_usd,
        exit_price_usd,
        amount_sol_spent,
        amount_sol_received,
        realized_pnl_usd,
        realized_pnl_pct,
        opened_at,
        closed_at,
        close_reason,
        wallet_address: addr,
    };
    db.close_position(&pos).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_closed_positions(
    db: State<'_, DbPool>,
    wallet: State<'_, Mutex<WalletState>>,
) -> Result<Vec<ClosedPosition>, String> {
    let addr = {
        let w = wallet.lock().unwrap();
        resolve_active_address(&w)?
    };
    db.get_closed_positions(&addr).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_tx_signature(
    db: State<'_, DbPool>,
    wallet: State<'_, Mutex<WalletState>>,
    sig: String,
) -> Result<bool, String> {
    let addr = {
        let w = wallet.lock().unwrap();
        resolve_active_address(&w)?
    };
    db.tx_signature_exists(&sig, &addr).await.map_err(|e| e.to_string())
}
