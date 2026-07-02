use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::sync::Mutex;

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
    pub wallet_address: String,
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
    pub wallet_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenPosition {
    pub mint: String,
    pub wallet_address: String,
    pub symbol: String,
    pub decimals: i64,
    pub entry_price_usd: f64,
    pub amount_tokens: f64,
    pub amount_sol_spent: f64,
    pub stop_loss_pct: f64,
    pub opened_at: i64,
    pub tx_signature: String,
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
    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        let sql = format!("PRAGMA table_info({})", table);
        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let exists = stmt
            .query_map([], |row| {
                let name: String = row.get(1)?;
                Ok(name)
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).any(|n| n == column))
            .unwrap_or(false);
        exists
    }

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

            CREATE TABLE IF NOT EXISTS open_positions (
                mint TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                decimals INTEGER NOT NULL,
                entry_price_usd REAL NOT NULL,
                amount_tokens REAL NOT NULL,
                amount_sol_spent REAL NOT NULL,
                stop_loss_pct REAL NOT NULL,
                opened_at INTEGER NOT NULL,
                tx_signature TEXT NOT NULL
            );
            ",
        )?;

        conn.execute("INSERT OR IGNORE INTO pet_state (id) VALUES (1)", [])?;

        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS trades_tx_sig_idx ON trades(tx_signature);",
        )?;

        // ── Schema migration: add wallet_address columns ────────────────────────

        if !Self::column_exists(&conn, "trades", "wallet_address") {
            conn.execute("ALTER TABLE trades ADD COLUMN wallet_address TEXT", [])?;
            tracing::info!("Migrated trades: added wallet_address column");
        }

        if !Self::column_exists(&conn, "closed_positions", "wallet_address") {
            conn.execute("ALTER TABLE closed_positions ADD COLUMN wallet_address TEXT", [])?;
            tracing::info!("Migrated closed_positions: added wallet_address column");
        }

        // open_positions: rebuild to composite PK (mint, wallet_address)
        if !Self::column_exists(&conn, "open_positions", "wallet_address") {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS open_positions_v2 (
                    mint TEXT NOT NULL,
                    wallet_address TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    decimals INTEGER NOT NULL,
                    entry_price_usd REAL NOT NULL,
                    amount_tokens REAL NOT NULL,
                    amount_sol_spent REAL NOT NULL,
                    stop_loss_pct REAL NOT NULL,
                    opened_at INTEGER NOT NULL,
                    tx_signature TEXT NOT NULL,
                    PRIMARY KEY (mint, wallet_address)
                );

                INSERT INTO open_positions_v2
                    (mint, wallet_address, symbol, decimals, entry_price_usd, amount_tokens, amount_sol_spent, stop_loss_pct, opened_at, tx_signature)
                    SELECT mint, NULL, symbol, decimals, entry_price_usd, amount_tokens, amount_sol_spent, stop_loss_pct, opened_at, tx_signature
                    FROM open_positions;

                DROP TABLE open_positions;
                ALTER TABLE open_positions_v2 RENAME TO open_positions;",
            )?;
            tracing::info!("Migrated open_positions: rebuilt to composite PK (mint, wallet_address)");
        }

        tracing::info!("SQLite initialized at {:?}", db_path);
        Ok(DbPool { conn: Mutex::new(conn) })
    }

    pub async fn log_trade(&self, trade: &Trade) -> anyhow::Result<i64> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT OR IGNORE INTO trades (mint, symbol, side, amount_sol, amount_tokens, price_usd, tx_signature, status, created_at, wallet_address)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
                trade.wallet_address,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub async fn tx_signature_exists(&self, sig: &str, wallet_address: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().await;
        let exists: bool = conn.query_row(
            "SELECT 1 FROM trades WHERE tx_signature = ?1 AND wallet_address = ?2 LIMIT 1",
            params![sig, wallet_address],
            |_| Ok(true),
        ).unwrap_or(false);
        Ok(exists)
    }

    pub async fn close_position(&self, pos: &ClosedPosition) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO closed_positions (mint, symbol, entry_price_usd, exit_price_usd, amount_sol_spent, amount_sol_received, realized_pnl_usd, realized_pnl_pct, opened_at, closed_at, close_reason, wallet_address)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
                pos.wallet_address,
            ],
        )?;
        Ok(())
    }

    pub async fn get_closed_positions(&self, wallet_address: &str) -> anyhow::Result<Vec<ClosedPosition>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, mint, symbol, entry_price_usd, exit_price_usd, amount_sol_spent, amount_sol_received, realized_pnl_usd, realized_pnl_pct, opened_at, closed_at, close_reason, wallet_address
             FROM closed_positions WHERE wallet_address = ?1 ORDER BY closed_at DESC",
        )?;
        let rows = stmt.query_map(params![wallet_address], |row| {
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
                wallet_address: row.get(12)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub async fn get_pet_state(&self) -> anyhow::Result<PetState> {
        let conn = self.conn.lock().await;
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

    pub async fn update_pet_xp(
        &self,
        xp_delta: i64,
        tokens_delta: i64,
        trades_delta: i64,
    ) -> anyhow::Result<PetState> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE pet_state SET
                xp = xp + ?1,
                total_tokens_seen = total_tokens_seen + ?2,
                total_trades = total_trades + ?3,
                level = CASE
                    WHEN xp + ?1 >= 2000 THEN 3
                    WHEN xp + ?1 >= 500  THEN 2
                    ELSE 1
                END
             WHERE id = 1",
            params![xp_delta, tokens_delta, trades_delta],
        )?;
        drop(conn);
        self.get_pet_state().await
    }

    pub async fn upsert_open_position(&self, p: &OpenPosition) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO open_positions (mint, wallet_address, symbol, decimals, entry_price_usd, amount_tokens, amount_sol_spent, stop_loss_pct, opened_at, tx_signature)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(mint, wallet_address) DO UPDATE SET
                symbol = excluded.symbol,
                decimals = excluded.decimals,
                entry_price_usd = excluded.entry_price_usd,
                amount_tokens = excluded.amount_tokens,
                amount_sol_spent = excluded.amount_sol_spent,
                stop_loss_pct = excluded.stop_loss_pct,
                opened_at = excluded.opened_at,
                tx_signature = excluded.tx_signature",
            params![
                p.mint,
                p.wallet_address,
                p.symbol,
                p.decimals,
                p.entry_price_usd,
                p.amount_tokens,
                p.amount_sol_spent,
                p.stop_loss_pct,
                p.opened_at,
                p.tx_signature,
            ],
        )?;
        Ok(())
    }

    pub async fn delete_open_position(&self, mint: &str, wallet_address: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM open_positions WHERE mint = ?1 AND wallet_address = ?2",
            params![mint, wallet_address],
        )?;
        Ok(())
    }

    pub async fn get_open_position(
        &self,
        mint: &str,
        wallet_address: &str,
    ) -> anyhow::Result<Option<OpenPosition>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT mint, wallet_address, symbol, decimals, entry_price_usd, amount_tokens, amount_sol_spent, stop_loss_pct, opened_at, tx_signature
             FROM open_positions WHERE mint = ?1 AND wallet_address = ?2",
        )?;
        let mut rows = stmt.query_map(params![mint, wallet_address], |row| {
            Ok(OpenPosition {
                mint: row.get(0)?,
                wallet_address: row.get(1)?,
                symbol: row.get(2)?,
                decimals: row.get(3)?,
                entry_price_usd: row.get(4)?,
                amount_tokens: row.get(5)?,
                amount_sol_spent: row.get(6)?,
                stop_loss_pct: row.get(7)?,
                opened_at: row.get(8)?,
                tx_signature: row.get(9)?,
            })
        })?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    pub async fn get_open_positions(&self, wallet_address: &str) -> anyhow::Result<Vec<OpenPosition>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT mint, wallet_address, symbol, decimals, entry_price_usd, amount_tokens, amount_sol_spent, stop_loss_pct, opened_at, tx_signature
             FROM open_positions WHERE wallet_address = ?1",
        )?;
        let rows = stmt.query_map(params![wallet_address], |row| {
            Ok(OpenPosition {
                mint: row.get(0)?,
                wallet_address: row.get(1)?,
                symbol: row.get(2)?,
                decimals: row.get(3)?,
                entry_price_usd: row.get(4)?,
                amount_tokens: row.get(5)?,
                amount_sol_spent: row.get(6)?,
                stop_loss_pct: row.get(7)?,
                opened_at: row.get(8)?,
                tx_signature: row.get(9)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }
}

pub async fn backfill_wallet_address(db: &DbPool, addr: &str) -> anyhow::Result<()> {
    let conn = db.conn.lock().await;
    conn.execute(
        "UPDATE trades SET wallet_address = ?1 WHERE wallet_address IS NULL",
        params![addr],
    )?;
    conn.execute(
        "UPDATE closed_positions SET wallet_address = ?1 WHERE wallet_address IS NULL",
        params![addr],
    )?;
    conn.execute(
        "UPDATE open_positions SET wallet_address = ?1 WHERE wallet_address IS NULL",
        params![addr],
    )?;
    tracing::info!("Backfilled wallet_address = {addr} for all NULL rows");
    Ok(())
}
