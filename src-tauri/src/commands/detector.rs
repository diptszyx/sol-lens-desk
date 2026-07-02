use tauri::State;
use tokio::sync::watch;

/// Controls whether the token detector (pumpportal websocket) is running.
///
/// Starts disabled so the app does not consume the token feed before a wallet
/// is unlocked. The frontend flips this on after login and off on logout.
pub struct DetectorGate {
    pub enabled: watch::Sender<bool>,
}

#[tauri::command]
pub fn start_detector(gate: State<'_, DetectorGate>) {
    let _ = gate.enabled.send(true);
}

#[tauri::command]
pub fn stop_detector(gate: State<'_, DetectorGate>) {
    let _ = gate.enabled.send(false);
}
