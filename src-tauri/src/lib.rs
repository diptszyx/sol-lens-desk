mod commands;
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

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

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

    let helius_key = std::env::var("HELIUS_API_KEY")
        .expect("HELIUS_API_KEY env var must be set — see apps/desktop/.env.example");
    let rpc_url = format!("https://mainnet.helius-rpc.com/?api-key={helius_key}");
    let rpc_url_for_state = rpc_url.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            build_tray(app)?;

            let app_data_dir = app.path().app_data_dir()?;
            let db_path = app_data_dir.join("sol-lens.db");
            let db_pool = db::DbPool::open(&db_path)?;
            app.manage(db_pool);

            let tracker = price_tracker::PriceTracker::new(app.handle().clone());
            app.manage(tracker);

            let (tx, rx) = tokio::sync::mpsc::channel(detector::pipeline::PENDING_QUEUE_CAP);

            let tx1 = tx.clone();
            tauri::async_runtime::spawn(async move {
                detector::pumpportal::listen(tx1).await.ok();
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
        .manage(rpc::RpcState {
            rpc_url: rpc_url_for_state,
        })
        .manage(std::sync::Mutex::new(wallet::WalletState(None)))
        .invoke_handler(tauri::generate_handler![
            commands::tokens::get_new_tokens,
            commands::tokens::get_token_detail,
            commands::swap::build_swap_transaction,
            commands::swap::send_transaction,
            commands::sell::build_sell_transaction,
            commands::sell::send_sell_transaction,
            commands::pet::get_pet_state,
            commands::pet::update_pet_xp,
            commands::price_tracking::start_price_tracking,
            commands::price_tracking::stop_price_tracking,
            commands::history::log_trade,
            commands::history::record_closed_position,
            commands::history::get_closed_positions,
            commands::history::get_trade_history,
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
            rpc::get_sol_balance,
            rpc::get_spl_balances,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
