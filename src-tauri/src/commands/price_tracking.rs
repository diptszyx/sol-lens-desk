use tauri::State;

use crate::price_tracker::PriceTracker;

#[tauri::command]
pub async fn start_price_tracking(
    tracker: State<'_, PriceTracker>,
    mint: String,
    entry_price_usd: f64,
    stop_loss_pct: f64,
) -> Result<(), String> {
    tracker.subscribe(mint, entry_price_usd, stop_loss_pct).await;
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
