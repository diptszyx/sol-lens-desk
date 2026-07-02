mod commands;
mod config;
mod db;
mod detector;
mod enricher;
mod price_tracker;
mod rpc;
mod wallet;

#[tauri::command]
fn open_url(url: String) {
    let _ = open::that(url);
}

/// Resolve the Helius API key. Runtime env (dev `.env` via dotenvy) takes
/// precedence so developers can override; otherwise the key baked at build time
/// (see build.rs `cargo:rustc-env`) is used so distributed builds work without a
/// `.env` on the tester's machine. Returns None if neither is set.
pub fn helius_api_key() -> Option<String> {
    std::env::var("HELIUS_API_KEY")
        .ok()
        .or_else(|| option_env!("HELIUS_API_KEY").map(str::to_string))
        .filter(|k| !k.is_empty())
}

/// Full Helius RPC URL: explicit `HELIUS_RPC_URL` env override, else built from
/// the resolved API key. None when no key is available.
pub fn helius_rpc_url() -> Option<String> {
    std::env::var("HELIUS_RPC_URL")
        .ok()
        .filter(|u| !u.is_empty())
        .or_else(|| helius_api_key().map(|k| format!("https://mainnet.helius-rpc.com/?api-key={k}")))
}

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use std::sync::Arc;

/// Reconnecting pumpportal listener loop. Runs until cancelled (via `tokio::select!`).
async fn run_listener(
    tx: tokio::sync::mpsc::Sender<detector::RawTokenEvent>,
    app_handle: tauri::AppHandle,
) {
    loop {
        if let Err(e) = detector::pumpportal::listen(tx.clone()).await {
            tracing::error!("Pumpportal listener died: {e}");
        }
        let _ = app_handle.emit("detector_status", serde_json::json!({ "status": "reconnecting" }));
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

/// Resolves once the detector gate is set to `false`.
async fn wait_until_disabled(gate: &mut tokio::sync::watch::Receiver<bool>) {
    while *gate.borrow() {
        if gate.changed().await.is_err() {
            return;
        }
    }
}

fn focus_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn run() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    // No hard panic: a distributed build with no key still boots on a public RPC,
    // and the user can set a working RPC/key in Settings. Helius (when baked or in
    // env) is strongly preferred — the public endpoint is rate-limited.
    let default_rpc_url = helius_rpc_url().unwrap_or_else(|| {
        tracing::warn!(
            "No HELIUS_API_KEY (baked or env) — falling back to public RPC; \
             detection/trading may be rate-limited until an RPC is set in Settings"
        );
        "https://api.mainnet-beta.solana.com".to_string()
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            build_tray(app)?;

            // Load saved RPC URL from settings, fallback to env default
            let rpc_url_loaded = tauri::async_runtime::block_on(
                rpc::load_saved_rpc_url(&app.handle(), &default_rpc_url)
            );

            let rpc_state = rpc::RpcState {
                rpc_url: Arc::new(tokio::sync::RwLock::new(rpc_url_loaded)),
                app_handle: app.handle().clone(),
            };
            app.manage(rpc_state);

            let app_data_dir = app.path().app_data_dir()?;
            let db_path = app_data_dir.join("sol-lens.db");
            let db_pool = db::DbPool::open(&db_path)?;
            app.manage(db_pool);

            let tracker = price_tracker::PriceTracker::new(app.handle().clone());
            app.manage(tracker);

            let (tx, rx) = tokio::sync::mpsc::channel(detector::pipeline::PENDING_QUEUE_CAP);

            // Detector gate: off until a wallet is unlocked, so we don't consume the
            // token feed pre-login. The frontend flips this via start/stop_detector.
            let (gate_tx, gate_rx) = tokio::sync::watch::channel(false);
            app.manage(commands::detector::DetectorGate { enabled: gate_tx });

            let tx1 = tx.clone();
            let app_handle = app.handle().clone();
            let mut gate = gate_rx.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    // Wait until the detector is enabled (wallet unlocked).
                    while !*gate.borrow() {
                        let _ = app_handle.emit("detector_status", serde_json::json!({ "status": "idle" }));
                        if gate.changed().await.is_err() {
                            return;
                        }
                    }

                    tracing::info!("Starting pumpportal listener...");
                    let _ = app_handle.emit("detector_status", serde_json::json!({ "status": "connected" }));

                    // Run the reconnecting listener until the gate is disabled again.
                    tokio::select! {
                        _ = run_listener(tx1.clone(), app_handle.clone()) => {}
                        _ = wait_until_disabled(&mut gate) => {
                            tracing::info!("Detector disabled, stopping listener");
                            let _ = app_handle.emit("detector_status", serde_json::json!({ "status": "idle" }));
                        }
                    }
                }
            });

            // Warm up SOL price cache before first token arrives.
            tauri::async_runtime::spawn(async move {
                enricher::get_sol_price_usd().await;
            });

            let mut pipeline = detector::pipeline::Pipeline::new(rx, app.handle().clone());
            tauri::async_runtime::spawn(async move {
                pipeline.run().await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(std::sync::Mutex::new(wallet::WalletState::new()))
        .invoke_handler(tauri::generate_handler![
            commands::tokens::get_new_tokens,
            commands::tokens::get_token_detail,
            commands::swap::build_swap_transaction,
            commands::swap::send_transaction,
            commands::trade::get_sol_price_usd,
            commands::trade::get_actual_swap_sol,
            commands::sell::build_sell_transaction,
            commands::sell::send_sell_transaction,
            commands::pet::get_pet_state,
            commands::pet::update_pet_xp,
            commands::price_tracking::start_price_tracking,
            commands::price_tracking::stop_price_tracking,
            commands::detector::start_detector,
            commands::detector::stop_detector,
            commands::history::log_trade,
            commands::history::record_closed_position,
            commands::history::get_closed_positions,
            commands::history::check_tx_signature,
            commands::positions::get_open_positions,
            commands::positions::save_open_position,
            commands::positions::remove_open_position,
            wallet::get_wallet_status,
            wallet::create_wallet,
            wallet::import_wallet,
            wallet::unlock_wallet,
            wallet::lock_wallet,
            wallet::sign_transaction,
            wallet::export_wallet,
            wallet::switch_active_wallet,
            wallet::remove_wallet,
            wallet::rename_wallet,
            rpc::get_sol_balance,
            rpc::test_rpc_connection,
            rpc::set_rpc_url,
            rpc::get_rpc_url,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
