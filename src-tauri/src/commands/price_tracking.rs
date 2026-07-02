use std::sync::Mutex;
use tauri::State;

use crate::price_tracker::PriceTracker;
use crate::wallet::WalletState;

// snake_case: 4 of 5 frontend call sites send entry_price_usd/stop_loss_pct as-is,
// which mismatches Tauri's default camelCase IPC arg naming and was failing this
// command silently every time (invoke() rejects into a swallowed .catch(console.error)
// with no trace on the Rust side) — positions were never actually entering the tracker.
#[tauri::command(rename_all = "snake_case")]
pub async fn start_price_tracking(
    tracker: State<'_, PriceTracker>,
    wallet: State<'_, Mutex<WalletState>>,
    mint: String,
    entry_price_usd: f64,
    stop_loss_pct: f64,
) -> Result<(), String> {
    // The active wallet at subscribe time is the position's owner — positions are
    // only ever opened on the active wallet. The tracker persists this so the
    // backend auto-sell can sign as the owner even when the UI later switches
    // to a different wallet.
    let owner = {
        let w = wallet.lock().unwrap();
        w.active_address_str()
            .map(String::from)
            .ok_or_else(|| "Wallet is locked".to_string())?
    };
    tracker.subscribe(mint, owner, entry_price_usd, stop_loss_pct).await;
    Ok(())
}

#[tauri::command]
pub async fn stop_price_tracking(
    tracker: State<'_, PriceTracker>,
    mint: String,
) -> Result<(), String> {
    tracker.unsubscribe(&mint).await;
    Ok(())
}
