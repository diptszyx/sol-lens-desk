use tauri::State;

use crate::db::{ClosedPosition, DbPool, Trade};

#[tauri::command]
pub async fn log_trade(
    db: State<'_, DbPool>,
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
    };
    db.log_trade(&trade).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_closed_position(
    db: State<'_, DbPool>,
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
    };
    db.close_position(&pos).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_closed_positions(db: State<'_, DbPool>) -> Result<Vec<ClosedPosition>, String> {
    db.get_closed_positions().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_trade_history(db: State<'_, DbPool>, mint: String) -> Result<Vec<Trade>, String> {
    db.get_trade_history(&mint).map_err(|e| e.to_string())
}
