pub mod pumpportal;
pub mod pipeline;

use serde::{Deserialize, Serialize};

/// Raw event from a detector. May carry pre-filled fields to skip RPC calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawTokenEvent {
    pub signature: String,
    pub source: String,
    pub detected_at: i64,
    // Pre-filled from rich sources (e.g. pumpportal.fun) — skip RPC if present
    pub mint: Option<String>,
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub uri: Option<String>,
    pub market_cap_sol: Option<f64>,
    pub initial_sol: Option<f64>,
    // Rich pump.fun fields for meme-trade signals
    pub dev_address: Option<String>,
    pub dev_token_amount: Option<f64>,
    pub v_sol_in_curve: Option<f64>,
    pub v_tokens_in_curve: Option<f64>,
}
