use crate::enricher::TokenInfo;

#[tauri::command]
pub async fn get_new_tokens() -> Result<Vec<TokenInfo>, String> {
    // Tokens arrive via "token_detected" events from the Rust pipeline
    Ok(vec![])
}

#[tauri::command]
pub async fn get_token_detail(_mint: String) -> Result<TokenInfo, String> {
    Err("not yet implemented — see P4".to_string())
}
