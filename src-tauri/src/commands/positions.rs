use tauri::State;
use crate::db::{DbPool, OpenPosition};

#[tauri::command]
pub async fn get_open_positions(db: State<'_, DbPool>) -> Result<Vec<OpenPosition>, String> {
    db.get_open_positions().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_open_position(db: State<'_, DbPool>, position: OpenPosition) -> Result<(), String> {
    db.upsert_open_position(&position).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_open_position(db: State<'_, DbPool>, mint: String) -> Result<(), String> {
    db.delete_open_position(&mint).map_err(|e| e.to_string())
}
