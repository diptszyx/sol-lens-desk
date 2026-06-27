use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct PetStateDto {
    pub xp: i64,
    pub level: i64,
    pub total_tokens_seen: i64,
    pub total_trades: i64,
}

#[tauri::command]
pub async fn get_pet_state(db: State<'_, crate::db::DbPool>) -> Result<PetStateDto, String> {
    let state = db.get_pet_state().map_err(|e| e.to_string())?;
    Ok(PetStateDto {
        xp: state.xp,
        level: state.level,
        total_tokens_seen: state.total_tokens_seen,
        total_trades: state.total_trades,
    })
}

#[tauri::command]
pub async fn update_pet_xp(
    db: State<'_, crate::db::DbPool>,
    xp_delta: i64,
    tokens_delta: i64,
    trades_delta: i64,
) -> Result<PetStateDto, String> {
    let state = db
        .update_pet_xp(xp_delta, tokens_delta, trades_delta)
        .map_err(|e| e.to_string())?;

    let new_level = if state.xp >= 2000 {
        3
    } else if state.xp >= 500 {
        2
    } else {
        1
    };

    if new_level != state.level {
        let conn = db.conn.lock().unwrap();
        let _ = conn.execute(
            "UPDATE pet_state SET level = ?1 WHERE id = 1",
            rusqlite::params![new_level],
        );
    }

    Ok(PetStateDto {
        xp: state.xp,
        level: new_level,
        total_tokens_seen: state.total_tokens_seen,
        total_trades: state.total_trades,
    })
}
