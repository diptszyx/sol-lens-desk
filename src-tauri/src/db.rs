use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: Option<i64>,
    pub mint: String,
    pub symbol: String,
    pub side: String,
    pub amount_sol: f64,
    pub amount_tokens: f64,
    pub price_usd: Option<f64>,
    pub tx_signature: String,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosedPosition {
    pub id: Option<i64>,
    pub mint: String,
    pub symbol: String,
    pub entry_price_usd: f64,
    pub exit_price_usd: f64,
    pub amount_sol_spent: f64,
    pub amount_sol_received: f64,
    pub realized_pnl_usd: f64,
    pub realized_pnl_pct: f64,
    pub opened_at: i64,
    pub closed_at: i64,
    pub close_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetState {
    pub xp: i64,
    pub level: i64,
    pub total_tokens_seen: i64,
    pub total_trades: i64,
}

pub struct DbPool {
    pub conn: Mutex<Connection>,
}

impl DbPool {
    pub fn open(db_path: &Path) -> anyhow::Result<Self> {
        std::fs::create_dir_all(db_path.parent().unwrap_or(Path::new(".")))?;
        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mint TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL CHECK(side IN ('buy','sell')),
                amount_sol REAL NOT NULL,
                amount_tokens REAL NOT NULL,
                price_usd REAL,
                tx_signature TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('confirmed','failed')),
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS closed_positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mint TEXT NOT NULL,
                symbol TEXT NOT NULL,
                entry_price_usd REAL NOT NULL,
                exit_price_usd REAL NOT NULL,
                amount_sol_spent REAL NOT NULL,
                amount_sol_received REAL NOT NULL,
                realized_pnl_usd REAL NOT NULL,
                realized_pnl_pct REAL NOT NULL,
                opened_at INTEGER NOT NULL,
                closed_at INTEGER NOT NULL,
                close_reason TEXT NOT NULL CHECK(close_reason IN ('manual','stop_loss'))
            );

            CREATE TABLE IF NOT EXISTS pet_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                xp INTEGER NOT NULL DEFAULT 0,
                level INTEGER NOT NULL DEFAULT 1,
                total_tokens_seen INTEGER NOT NULL DEFAULT 0,
                total_trades INTEGER NOT NULL DEFAULT 0
            );
            ",
        )?;

        conn.execute("INSERT OR IGNORE INTO pet_state (id) VALUES (1)", [])?;

        tracing::info!("SQLite initialized at {:?}", db_path);
        Ok(DbPool { conn: Mutex::new(conn) })
    }

    pub fn log_trade(&self, trade: &Trade) -> anyhow::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO trades (mint, symbol, side, amount_sol, amount_tokens, price_usd, tx_signature, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                trade.mint,
                trade.symbol,
                trade.side,
                trade.amount_sol,
                trade.amount_tokens,
                trade.price_usd,
                trade.tx_signature,
                trade.status,
                trade.created_at,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn close_position(&self, pos: &ClosedPosition) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO closed_positions (mint, symbol, entry_price_usd, exit_price_usd, amount_sol_spent, amount_sol_received, realized_pnl_usd, realized_pnl_pct, opened_at, closed_at, close_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                pos.mint,
                pos.symbol,
                pos.entry_price_usd,
                pos.exit_price_usd,
                pos.amount_sol_spent,
                pos.amount_sol_received,
                pos.realized_pnl_usd,
                pos.realized_pnl_pct,
                pos.opened_at,
                pos.closed_at,
                pos.close_reason,
            ],
        )?;
        Ok(())
    }

    pub fn get_closed_positions(&self) -> anyhow::Result<Vec<ClosedPosition>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, mint, symbol, entry_price_usd, exit_price_usd, amount_sol_spent, amount_sol_received, realized_pnl_usd, realized_pnl_pct, opened_at, closed_at, close_reason
             FROM closed_positions ORDER BY closed_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ClosedPosition {
                id: Some(row.get(0)?),
                mint: row.get(1)?,
                symbol: row.get(2)?,
                entry_price_usd: row.get(3)?,
                exit_price_usd: row.get(4)?,
                amount_sol_spent: row.get(5)?,
                amount_sol_received: row.get(6)?,
                realized_pnl_usd: row.get(7)?,
                realized_pnl_pct: row.get(8)?,
                opened_at: row.get(9)?,
                closed_at: row.get(10)?,
                close_reason: row.get(11)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_trade_history(&self, mint: &str) -> anyhow::Result<Vec<Trade>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, mint, symbol, side, amount_sol, amount_tokens, price_usd, tx_signature, status, created_at
             FROM trades WHERE mint = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![mint], |row| {
            Ok(Trade {
                id: Some(row.get(0)?),
                mint: row.get(1)?,
                symbol: row.get(2)?,
                side: row.get(3)?,
                amount_sol: row.get(4)?,
                amount_tokens: row.get(5)?,
                price_usd: row.get(6)?,
                tx_signature: row.get(7)?,
                status: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_pet_state(&self) -> anyhow::Result<PetState> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT xp, level, total_tokens_seen, total_trades FROM pet_state WHERE id = 1",
            [],
            |row| {
                Ok(PetState {
                    xp: row.get(0)?,
                    level: row.get(1)?,
                    total_tokens_seen: row.get(2)?,
                    total_trades: row.get(3)?,
                })
            },
        )
        .map_err(Into::into)
    }

    pub fn update_pet_xp(
        &self,
        xp_delta: i64,
        tokens_delta: i64,
        trades_delta: i64,
    ) -> anyhow::Result<PetState> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pet_state SET xp = xp + ?1, total_tokens_seen = total_tokens_seen + ?2, total_trades = total_trades + ?3 WHERE id = 1",
            params![xp_delta, tokens_delta, trades_delta],
        )?;
        self.get_pet_state()
    }
}
