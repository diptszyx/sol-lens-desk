mod commands;
mod detector;
mod enricher;
mod rpc;
mod wallet;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Bring the dashboard window to the foreground (used by tray click + menu).
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

            let (tx, rx) = tokio::sync::mpsc::channel(detector::pipeline::PENDING_QUEUE_CAP);

            let tx1 = tx.clone();
            tauri::async_runtime::spawn(async move {
                detector::pumpportal::listen(tx1).await.ok();
            });

            let mut pipeline = detector::pipeline::Pipeline::new(
                rx,
                rpc_url.clone(),
                app.handle().clone(),
            );
            tauri::async_runtime::spawn(async move { pipeline.run().await });

            Ok(())
        })
        // Closing the dashboard hides it instead of quitting — the app keeps
        // running in the tray with the capybara overlay alive. Quit via tray.
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(rpc::RpcState { rpc_url: rpc_url_for_state })
        .manage(std::sync::Mutex::new(wallet::WalletState(None)))
        .invoke_handler(tauri::generate_handler![
            commands::tokens::get_new_tokens,
            commands::tokens::get_token_detail,
            commands::swap::build_swap_transaction,
            commands::swap::send_transaction,
            wallet::get_wallet_status,
            wallet::create_wallet,
            wallet::import_wallet,
            wallet::unlock_wallet,
            wallet::lock_wallet,
            wallet::sign_transaction,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
