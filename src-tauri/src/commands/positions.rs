use std::sync::Mutex;
use tauri::State;

use crate::db::{DbPool, OpenPosition};
use crate::wallet::WalletState;

fn resolve_active_address(wallet: &WalletState) -> Result<String, String> {
    wallet.active_address_str()
        .map(String::from)
        .ok_or_else(|| "Wallet is locked".to_string())
}

#[tauri::command]
pub async fn get_open_positions(
    db: State<'_, DbPool>,
    wallet: State<'_, Mutex<WalletState>>,
) -> Result<Vec<OpenPosition>, String> {
    let addr = {
        let w = wallet.lock().unwrap();
        resolve_active_address(&w)?
    };
    db.get_open_positions(&addr).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_open_position(
    db: State<'_, DbPool>,
    wallet: State<'_, Mutex<WalletState>>,
    position: OpenPosition,
) -> Result<(), String> {
    let addr = {
        let w = wallet.lock().unwrap();
        resolve_active_address(&w)?
    };
    let pos = OpenPosition {
        wallet_address: addr,
        ..position
    };
    db.upsert_open_position(&pos).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_open_position(
    db: State<'_, DbPool>,
    wallet: State<'_, Mutex<WalletState>>,
    mint: String,
) -> Result<(), String> {
    let addr = {
        let w = wallet.lock().unwrap();
        resolve_active_address(&w)?
    };
    db.delete_open_position(&mint, &addr).await.map_err(|e| e.to_string())
}
