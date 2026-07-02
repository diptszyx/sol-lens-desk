use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::message::Message;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::transaction::VersionedTransaction;
use std::str::FromStr;

const PUMP_PROGRAM: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const FEE_PROGRAM: &str = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const ASSOCIATED_TOKEN_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";
const WSOL_MINT: &str = "So11111111111111111111111111111111111111112";

const BUY_V2_DISCRIMINATOR: [u8; 8] = [184, 23, 238, 97, 103, 197, 211, 61];
const SELL_V2_DISCRIMINATOR: [u8; 8] = [93, 246, 130, 60, 231, 233, 64, 178];
const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];

const FEE_RECIPIENTS: [&str; 8] = [
    "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
    "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
    "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
    "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
    "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
    "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
    "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
];

const RESERVED_FEE_RECIPIENTS: [&str; 8] = [
    "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS",
    "4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6",
    "8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR",
    "4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH",
    "8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6",
    "Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk",
    "463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq",
    "6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA",
];

const BUYBACK_FEE_RECIPIENTS: [&str; 8] = [
    "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
    "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
    "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
    "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
    "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
    "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
    "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
    "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
];

pub const CURVE_CACHE_STALE_SECS: u64 = 3;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub struct CurveReserves {
    pub v_sol: f64,
    pub v_tokens: f64,
    pub cached_at: std::time::Instant,
}

#[allow(dead_code)]
impl CurveReserves {
    pub fn from_event(v_sol: f64, v_tokens: f64) -> Self {
        Self {
            v_sol,
            v_tokens,
            cached_at: std::time::Instant::now(),
        }
    }

    pub fn is_stale(&self) -> bool {
        self.cached_at.elapsed().as_secs() > CURVE_CACHE_STALE_SECS
    }
}

#[allow(dead_code)]
pub(crate) struct BondingCurve {
    virtual_token_reserves: u64,
    virtual_quote_reserves: u64,
    real_token_reserves: u64,
    real_quote_reserves: u64,
    token_total_supply: u64,
    complete: bool,
    creator: Pubkey,
    is_mayhem_mode: bool,
    is_cashback_coin: bool,
    quote_mint: Pubkey,
}

impl BondingCurve {
    fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < 115 {
            return None;
        }
        if data[..8] != BONDING_CURVE_DISCRIMINATOR {
            return None;
        }
        let read_u64 = |off: usize| u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        let read_pubkey = |off: usize| Pubkey::try_from(&data[off..off + 32]).ok();

        // Live accounts can be 151 bytes (older curves reallocated to add trailing fields
        // for cashback/multi-quote support) with quote_mint left as the zero pubkey for
        // curves predating the multi-quote feature — that decodes to the System Program
        // address (owned by NativeLoader), not a usable mint. Treat zero as "SOL", the
        // implicit default before multi-quote existed, rather than passing it through.
        let quote_mint_raw = read_pubkey(83)?;
        let quote_mint = if quote_mint_raw == Pubkey::default() {
            Pubkey::from_str(WSOL_MINT).ok()?
        } else {
            quote_mint_raw
        };

        Some(Self {
            virtual_token_reserves: read_u64(8),
            virtual_quote_reserves: read_u64(16),
            real_token_reserves: read_u64(24),
            real_quote_reserves: read_u64(32),
            token_total_supply: read_u64(40),
            complete: data[48] != 0,
            creator: read_pubkey(49)?,
            is_mayhem_mode: data[81] != 0,
            is_cashback_coin: data[82] != 0,
            quote_mint,
        })
    }
}

fn derive_pda(seeds: &[&[u8]], program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, program_id)
}

fn derive_ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    let ata_program = Pubkey::from_str(ASSOCIATED_TOKEN_PROGRAM).unwrap();
    let (ata, _) = Pubkey::find_program_address(
        &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ata_program,
    );
    ata
}

fn pick_random_fee_recipient(is_mayhem: bool) -> Pubkey {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let idx = (seed % 8) as usize;
    let list: &[&str; 8] = if is_mayhem {
        &RESERVED_FEE_RECIPIENTS
    } else {
        &FEE_RECIPIENTS
    };
    Pubkey::from_str(list[idx]).unwrap()
}

fn pick_random_buyback() -> Pubkey {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let idx = (seed % 8) as usize;
    Pubkey::from_str(BUYBACK_FEE_RECIPIENTS[idx]).unwrap()
}

fn build_create_ata_ix(
    payer: &Pubkey,
    ata: &Pubkey,
    owner: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    let ata_program = Pubkey::from_str(ASSOCIATED_TOKEN_PROGRAM).unwrap();
    let system_program_id = Pubkey::from_str(SYSTEM_PROGRAM).unwrap();

    Instruction {
        program_id: ata_program,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*ata, false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(system_program_id, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        // instruction index 1 = CreateIdempotent — no-op (not error) if the ATA already
        // exists, so repeat buys of a mint the wallet already holds don't fail the tx.
        data: vec![1],
    }
}

fn build_buy_v2_ix(
    base_mint: &Pubkey,
    amount: u64,
    max_sol_cost: u64,
    user: &Pubkey,
    curve: &BondingCurve,
    base_token_program: &Pubkey,
    quote_token_program: &Pubkey,
) -> anyhow::Result<Instruction> {
    let pump_program = Pubkey::from_str(PUMP_PROGRAM)?;
    let fee_program = Pubkey::from_str(FEE_PROGRAM)?;
    // quote_mint is fixed per bonding curve at creation time (usually WSOL, but not
    // guaranteed) — always read it from the decoded curve, never hardcode.
    let quote_mint = curve.quote_mint;
    let quote_token_program = *quote_token_program;
    let ata_program = Pubkey::from_str(ASSOCIATED_TOKEN_PROGRAM)?;
    let system_program_id = Pubkey::from_str(SYSTEM_PROGRAM)?;

    let (global, _) = derive_pda(&[b"global"], &pump_program);
    let (bonding_curve, _) = derive_pda(&[b"bonding-curve", base_mint.as_ref()], &pump_program);
    let (creator_vault, _) = derive_pda(&[b"creator-vault", curve.creator.as_ref()], &pump_program);
    let (sharing_config, _) = derive_pda(&[b"sharing-config", base_mint.as_ref()], &fee_program);
    let fee_config_seed = pump_program.to_bytes();
    let (fee_config_pda, _) = derive_pda(&[b"fee_config", fee_config_seed.as_ref()], &fee_program);
    let (event_authority, _) = derive_pda(&[b"__event_authority"], &pump_program);
    let (global_volume_accumulator, _) = derive_pda(&[b"global_volume_accumulator"], &pump_program);
    let (user_volume_accumulator, _) = derive_pda(&[b"user_volume_accumulator", user.as_ref()], &pump_program);

    let fee_recipient = pick_random_fee_recipient(curve.is_mayhem_mode);
    let buyback_fee_recipient = pick_random_buyback();

    let associated_quote_fee_recipient =
        derive_ata(&fee_recipient, &quote_mint, &quote_token_program);
    let associated_quote_buyback_fee_recipient =
        derive_ata(&buyback_fee_recipient, &quote_mint, &quote_token_program);
    let associated_base_bonding_curve =
        derive_ata(&bonding_curve, base_mint, base_token_program);
    let associated_quote_bonding_curve =
        derive_ata(&bonding_curve, &quote_mint, &quote_token_program);
    let associated_base_user = derive_ata(user, base_mint, base_token_program);
    let associated_quote_user = derive_ata(user, &quote_mint, &quote_token_program);
    let associated_creator_vault =
        derive_ata(&creator_vault, &quote_mint, &quote_token_program);
    let associated_user_volume_accumulator =
        derive_ata(&user_volume_accumulator, &quote_mint, &quote_token_program);

    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&BUY_V2_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&max_sol_cost.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(global, false),
        AccountMeta::new_readonly(*base_mint, false),
        AccountMeta::new_readonly(quote_mint, false),
        AccountMeta::new_readonly(*base_token_program, false),
        AccountMeta::new_readonly(quote_token_program, false),
        AccountMeta::new_readonly(ata_program, false),
        AccountMeta::new(fee_recipient, false),
        AccountMeta::new(associated_quote_fee_recipient, false),
        AccountMeta::new(buyback_fee_recipient, false),
        AccountMeta::new(associated_quote_buyback_fee_recipient, false),
        AccountMeta::new(bonding_curve, false),
        AccountMeta::new(associated_base_bonding_curve, false),
        AccountMeta::new(associated_quote_bonding_curve, false),
        AccountMeta::new(*user, true),
        AccountMeta::new(associated_base_user, false),
        AccountMeta::new(associated_quote_user, false),
        AccountMeta::new(creator_vault, false),
        AccountMeta::new(associated_creator_vault, false),
        AccountMeta::new_readonly(sharing_config, false),
        AccountMeta::new_readonly(global_volume_accumulator, false),
        AccountMeta::new(user_volume_accumulator, false),
        AccountMeta::new(associated_user_volume_accumulator, false),
        AccountMeta::new_readonly(fee_config_pda, false),
        AccountMeta::new_readonly(fee_program, false),
        AccountMeta::new_readonly(system_program_id, false),
        AccountMeta::new_readonly(event_authority, false),
        AccountMeta::new_readonly(pump_program, false),
    ];

    Ok(Instruction {
        program_id: pump_program,
        accounts,
        data,
    })
}

fn build_sell_v2_ix(
    base_mint: &Pubkey,
    amount: u64,
    min_sol_output: u64,
    user: &Pubkey,
    curve: &BondingCurve,
    base_token_program: &Pubkey,
    quote_token_program: &Pubkey,
) -> anyhow::Result<Instruction> {
    let pump_program = Pubkey::from_str(PUMP_PROGRAM)?;
    let fee_program = Pubkey::from_str(FEE_PROGRAM)?;
    let quote_mint = curve.quote_mint;
    let quote_token_program = *quote_token_program;
    let ata_program = Pubkey::from_str(ASSOCIATED_TOKEN_PROGRAM)?;
    let system_program_id = Pubkey::from_str(SYSTEM_PROGRAM)?;

    let (global, _) = derive_pda(&[b"global"], &pump_program);
    let (bonding_curve, _) = derive_pda(&[b"bonding-curve", base_mint.as_ref()], &pump_program);
    let (creator_vault, _) = derive_pda(&[b"creator-vault", curve.creator.as_ref()], &pump_program);
    let (sharing_config, _) = derive_pda(&[b"sharing-config", base_mint.as_ref()], &fee_program);
    let fee_config_seed = pump_program.to_bytes();
    let (fee_config_pda, _) = derive_pda(&[b"fee_config", fee_config_seed.as_ref()], &fee_program);
    let (event_authority, _) = derive_pda(&[b"__event_authority"], &pump_program);
    let (user_volume_accumulator, _) = derive_pda(&[b"user_volume_accumulator", user.as_ref()], &pump_program);

    let fee_recipient = pick_random_fee_recipient(curve.is_mayhem_mode);
    let buyback_fee_recipient = pick_random_buyback();

    let associated_quote_fee_recipient =
        derive_ata(&fee_recipient, &quote_mint, &quote_token_program);
    let associated_quote_buyback_fee_recipient =
        derive_ata(&buyback_fee_recipient, &quote_mint, &quote_token_program);
    let associated_base_bonding_curve =
        derive_ata(&bonding_curve, base_mint, base_token_program);
    let associated_quote_bonding_curve =
        derive_ata(&bonding_curve, &quote_mint, &quote_token_program);
    let associated_base_user = derive_ata(user, base_mint, base_token_program);
    let associated_quote_user = derive_ata(user, &quote_mint, &quote_token_program);
    let associated_creator_vault =
        derive_ata(&creator_vault, &quote_mint, &quote_token_program);
    let associated_user_volume_accumulator =
        derive_ata(&user_volume_accumulator, &quote_mint, &quote_token_program);

    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&SELL_V2_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&min_sol_output.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(global, false),
        AccountMeta::new_readonly(*base_mint, false),
        AccountMeta::new_readonly(quote_mint, false),
        AccountMeta::new_readonly(*base_token_program, false),
        AccountMeta::new_readonly(quote_token_program, false),
        AccountMeta::new_readonly(ata_program, false),
        AccountMeta::new(fee_recipient, false),
        AccountMeta::new(associated_quote_fee_recipient, false),
        AccountMeta::new(buyback_fee_recipient, false),
        AccountMeta::new(associated_quote_buyback_fee_recipient, false),
        AccountMeta::new(bonding_curve, false),
        AccountMeta::new(associated_base_bonding_curve, false),
        AccountMeta::new(associated_quote_bonding_curve, false),
        AccountMeta::new(*user, true),
        AccountMeta::new(associated_base_user, false),
        AccountMeta::new(associated_quote_user, false),
        AccountMeta::new(creator_vault, false),
        AccountMeta::new(associated_creator_vault, false),
        AccountMeta::new_readonly(sharing_config, false),
        AccountMeta::new(user_volume_accumulator, false),
        AccountMeta::new(associated_user_volume_accumulator, false),
        AccountMeta::new_readonly(fee_config_pda, false),
        AccountMeta::new_readonly(fee_program, false),
        AccountMeta::new_readonly(system_program_id, false),
        AccountMeta::new_readonly(event_authority, false),
        AccountMeta::new_readonly(pump_program, false),
    ];

    Ok(Instruction {
        program_id: pump_program,
        accounts,
        data,
    })
}

/// Resolved on-chain context for a bonding curve trade: the curve itself, plus the
/// actual token program + decimals for both base and quote mints. Both base_mint and
/// quote_mint are read dynamically per-token — pump.fun mints use classic SPL Token or
/// Token-2022 depending on the token, and quote_mint is fixed per curve at creation time
/// (usually WSOL, not guaranteed) — never assume either, always resolve from-chain.
pub struct CurveContext {
    pub curve: BondingCurve,
    pub base_token_program: Pubkey,
    pub quote_token_program: Pubkey,
    pub quote_decimals: u8,
}

/// SPL Mint account layout is identical for the first 82 bytes in both classic Token and
/// Token-2022 (extensions, if any, are appended after) — `decimals` sits at a fixed offset.
const MINT_DECIMALS_OFFSET: usize = 44;

fn resolve_token_program(mint: &Pubkey, owner: &Pubkey, label: &str) -> anyhow::Result<Pubkey> {
    let classic = Pubkey::from_str(TOKEN_PROGRAM)?;
    let token_2022 = Pubkey::from_str(TOKEN_2022_PROGRAM)?;
    if *owner != classic && *owner != token_2022 {
        anyhow::bail!(
            "{label} mint {mint} owned by unexpected program {owner} (not SPL Token or Token-2022)"
        );
    }
    Ok(*owner)
}

pub async fn fetch_curve_context(rpc_url: &str, mint: &Pubkey) -> anyhow::Result<CurveContext> {
    let pump_program = Pubkey::from_str(PUMP_PROGRAM)?;
    let (bonding_curve_addr, _) = derive_pda(&[b"bonding-curve", mint.as_ref()], &pump_program);
    let client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());

    let curve_raw = client.get_account(&bonding_curve_addr).await?;
    let curve = BondingCurve::from_bytes(&curve_raw.data)
        .ok_or_else(|| anyhow::anyhow!("Failed to decode BondingCurve account data"))?;

    // quote_mint is only known after decoding the curve above, so base_mint and
    // quote_mint are fetched together here rather than batched with the curve fetch.
    let mint_accounts = client
        .get_multiple_accounts(&[*mint, curve.quote_mint])
        .await?;

    let base_mint_account = mint_accounts[0]
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Base mint account not found: {mint}"))?;
    let base_token_program = resolve_token_program(mint, &base_mint_account.owner, "Base")?;

    let quote_mint_account = mint_accounts[1].as_ref().ok_or_else(|| {
        anyhow::anyhow!("Quote mint account not found: {}", curve.quote_mint)
    })?;
    let quote_token_program = resolve_token_program(&curve.quote_mint, &quote_mint_account.owner, "Quote")?;
    let quote_decimals = *quote_mint_account
        .data
        .get(MINT_DECIMALS_OFFSET)
        .ok_or_else(|| anyhow::anyhow!("Quote mint account data too short to read decimals"))?;

    Ok(CurveContext {
        curve,
        base_token_program,
        quote_token_program,
        quote_decimals,
    })
}

/// Reads the bonding curve straight from RPC and returns (price_usd, is_complete) —
/// a fallback for the pumpportal WS feed, which only pushes an update when a trade
/// actually crosses its indexer. Low-volume mints can go quiet on that feed for long
/// stretches even while the on-chain curve itself keeps moving from other traders,
/// leaving both the displayed price and stop-loss checks stuck on stale data.
pub async fn fetch_curve_price_usd(
    rpc_url: &str,
    mint: &Pubkey,
    sol_price_usd: f64,
) -> anyhow::Result<(f64, bool)> {
    let ctx = fetch_curve_context(rpc_url, mint).await?;
    if ctx.curve.complete || ctx.curve.virtual_token_reserves == 0 {
        return Ok((0.0, true));
    }

    // pump.fun base mints use 6 decimals in practice (see build_pumpfun_buy_tx).
    let quote_per_token = (ctx.curve.virtual_quote_reserves as f64 / 10f64.powi(ctx.quote_decimals as i32))
        / (ctx.curve.virtual_token_reserves as f64 / 10f64.powi(6));
    Ok((quote_per_token * sol_price_usd, false))
}

pub async fn is_curve_complete(rpc_url: &str, mint: &Pubkey) -> anyhow::Result<bool> {
    let pump_program = Pubkey::from_str(PUMP_PROGRAM)?;
    let (bonding_curve_addr, _) = derive_pda(&[b"bonding-curve", mint.as_ref()], &pump_program);
    let client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
    let curve_raw = client.get_account(&bonding_curve_addr).await?;
    BondingCurve::from_bytes(&curve_raw.data)
        .map(|c| c.complete)
        .ok_or_else(|| anyhow::anyhow!("Failed to decode BondingCurve for {mint}"))
}

#[derive(serde::Deserialize)]
struct RpcAccountKey {
    pubkey: String,
}

#[derive(serde::Deserialize)]
struct RpcParsedMessage {
    #[serde(rename = "accountKeys")]
    account_keys: Vec<RpcAccountKey>,
}

#[derive(serde::Deserialize)]
struct RpcParsedTransaction {
    message: RpcParsedMessage,
}

#[derive(serde::Deserialize)]
struct RpcTxMeta {
    #[serde(rename = "preBalances")]
    pre_balances: Vec<i64>,
    #[serde(rename = "postBalances")]
    post_balances: Vec<i64>,
}

#[derive(serde::Deserialize)]
struct RpcTxResult {
    transaction: RpcParsedTransaction,
    meta: RpcTxMeta,
}

#[derive(serde::Deserialize)]
struct RpcTxEnvelope {
    result: Option<RpcTxResult>,
}

/// BuyV2/SellV2 lock in an exact token amount and let the SOL side float with
/// curve movement between quote and confirmation (see fetch_best_quote /
/// build_pumpfun_buy_tx) — the amount the user typed or the quote estimated can
/// diverge meaningfully from what actually left/entered the wallet. This reads the
/// confirmed tx back from RPC and returns the exact lamport delta on the bonding
/// curve PDA itself — the same figure block explorers show as the swap amount.
pub async fn fetch_actual_curve_sol_delta(
    rpc_url: &str,
    mint: &Pubkey,
    signature: &str,
) -> anyhow::Result<f64> {
    let pump_program = Pubkey::from_str(PUMP_PROGRAM)?;
    let (bonding_curve_addr, _) = derive_pda(&[b"bonding-curve", mint.as_ref()], &pump_program);

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [signature, { "encoding": "jsonParsed", "maxSupportedTransactionVersion": 0 }],
    });
    let envelope: RpcTxEnvelope = client.post(rpc_url).json(&body).send().await?.json().await?;
    let result = envelope
        .result
        .ok_or_else(|| anyhow::anyhow!("Transaction not found: {signature}"))?;

    let curve_str = bonding_curve_addr.to_string();
    let idx = result
        .transaction
        .message
        .account_keys
        .iter()
        .position(|k| k.pubkey == curve_str)
        .ok_or_else(|| anyhow::anyhow!("Curve account not found in tx {signature}"))?;

    let delta_lamports = result.meta.post_balances[idx] - result.meta.pre_balances[idx];
    Ok(delta_lamports.unsigned_abs() as f64 / 1_000_000_000.0)
}

fn sol_to_tokens(sol_lamports: u64, curve: &BondingCurve) -> u64 {
    let vs = curve.virtual_quote_reserves;
    let vt = curve.virtual_token_reserves;

    if sol_lamports == 0 || vt == 0 || vs == 0 {
        return 0;
    }

    let numerator = sol_lamports as u128 * vt as u128;
    let denominator = vs as u128 + sol_lamports as u128;
    (numerator / denominator).min(u64::MAX as u128) as u64
}

#[allow(dead_code)]
fn tokens_to_sol(amount_tokens: u64, curve: &BondingCurve) -> u64 {
    let vt = curve.virtual_token_reserves;
    let vs = curve.virtual_quote_reserves;

    if amount_tokens == 0 || vt <= amount_tokens {
        return u64::MAX;
    }

    let numerator = amount_tokens as u128 * vs as u128;
    let denominator = (vt - amount_tokens) as u128;
    if denominator == 0 {
        return u64::MAX;
    }

    let sol = (numerator + denominator - 1) / denominator + 1;
    sol.min(u64::MAX as u128) as u64
}

fn sell_output(amount_tokens: u64, curve: &BondingCurve) -> u64 {
    let vt = curve.virtual_token_reserves;
    let vs = curve.virtual_quote_reserves;

    if amount_tokens == 0 || vt == 0 || vs == 0 {
        return 0;
    }

    let numerator = amount_tokens as u128 * vs as u128;
    let denominator = (vt + amount_tokens) as u128;
    if denominator == 0 {
        return 0;
    }
    (numerator / denominator).min(u64::MAX as u128) as u64
}

fn serialize_tx(vtx: &VersionedTransaction) -> anyhow::Result<String> {
    let tx_bytes = bincode::serialize(vtx)?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &tx_bytes,
    ))
}

async fn build_and_serialize(
    rpc_url: &str,
    user_pubkey: &Pubkey,
    instructions: Vec<Instruction>,
) -> anyhow::Result<String> {
    let client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
    let blockhash = client.get_latest_blockhash().await?;
    let message = Message::new_with_blockhash(&instructions, Some(user_pubkey), &blockhash);
    let tx = solana_sdk::transaction::Transaction::new_unsigned(message);
    let vtx = VersionedTransaction::from(tx);
    serialize_tx(&vtx)
}

/// Returns (serialized_tx, expected_tokens_out, quote_decimals). expected_tokens_out is in
/// raw base units (pump.fun mints use 6 decimals). quote_decimals is read from the curve's
/// actual quote mint (not assumed to be SOL/9) so the caller can render a correct estimate.
pub async fn build_pumpfun_buy_tx(
    mint_str: &str,
    pay_mint_str: &str,
    user_pubkey: &Pubkey,
    quote_amount: u64,
    slippage_bps: u32,
    rpc_url: &str,
) -> anyhow::Result<(String, u64, u8)> {
    let mint = Pubkey::from_str(mint_str)?;
    let pay_mint = Pubkey::from_str(pay_mint_str)?;
    let ctx = fetch_curve_context(rpc_url, &mint).await?;

    if ctx.curve.complete {
        anyhow::bail!("Bonding curve complete — use PumpSwap (not yet supported)");
    }

    if pay_mint != ctx.curve.quote_mint {
        anyhow::bail!(
            "This token's bonding curve only accepts {} as payment, but {} was selected — swap to the correct asset first",
            ctx.curve.quote_mint,
            pay_mint
        );
    }

    let expected_tokens = sol_to_tokens(quote_amount, &ctx.curve);
    if expected_tokens == 0 {
        anyhow::bail!("Quote amount too small to buy any tokens (check curve reserves)");
    }

    let max_quote_cost = quote_amount
        .saturating_mul(10_000u64.saturating_add(slippage_bps as u64))
        .saturating_div(10_000);

    let buy_ix = build_buy_v2_ix(
        &mint,
        expected_tokens,
        max_quote_cost,
        user_pubkey,
        &ctx.curve,
        &ctx.base_token_program,
        &ctx.quote_token_program,
    )?;

    // Both the base (target token) and quote (payment asset) ATAs must exist before
    // buy_v2 runs — create both idempotently rather than assume the on-chain program
    // creates them via CPI internally (unverified either way, and this is harmless).
    let associated_base_user = derive_ata(user_pubkey, &mint, &ctx.base_token_program);
    let create_base_ata_ix = build_create_ata_ix(
        user_pubkey,
        &associated_base_user,
        user_pubkey,
        &mint,
        &ctx.base_token_program,
    );
    let associated_quote_user = derive_ata(user_pubkey, &ctx.curve.quote_mint, &ctx.quote_token_program);
    let create_quote_ata_ix = build_create_ata_ix(
        user_pubkey,
        &associated_quote_user,
        user_pubkey,
        &ctx.curve.quote_mint,
        &ctx.quote_token_program,
    );

    let tx = build_and_serialize(
        rpc_url,
        user_pubkey,
        vec![create_base_ata_ix, create_quote_ata_ix, buy_ix],
    )
    .await?;
    Ok((tx, expected_tokens, ctx.quote_decimals))
}

/// Returns (serialized_tx, expected_quote_out, quote_decimals).
pub async fn build_pumpfun_sell_tx(
    mint_str: &str,
    user_pubkey: &Pubkey,
    token_amount: u64,
    slippage_bps: u32,
    rpc_url: &str,
) -> anyhow::Result<(String, u64, u8)> {
    let mint = Pubkey::from_str(mint_str)?;
    let ctx = fetch_curve_context(rpc_url, &mint).await?;

    if ctx.curve.complete {
        anyhow::bail!("Bonding curve complete — use PumpSwap (not yet supported)");
    }

    let expected_quote = sell_output(token_amount, &ctx.curve);

    let min_quote_output = expected_quote
        .saturating_mul(10_000u64.saturating_sub(slippage_bps as u64))
        .saturating_div(10_000);

    let sell_ix = build_sell_v2_ix(
        &mint,
        token_amount,
        min_quote_output,
        user_pubkey,
        &ctx.curve,
        &ctx.base_token_program,
        &ctx.quote_token_program,
    )?;

    // The quote (payment asset) ATA receives sale proceeds — must exist first. Created
    // idempotently, harmless if it already does.
    let associated_quote_user = derive_ata(user_pubkey, &ctx.curve.quote_mint, &ctx.quote_token_program);
    let create_quote_ata_ix = build_create_ata_ix(
        user_pubkey,
        &associated_quote_user,
        user_pubkey,
        &ctx.curve.quote_mint,
        &ctx.quote_token_program,
    );

    let tx = build_and_serialize(rpc_url, user_pubkey, vec![create_quote_ata_ix, sell_ix]).await?;
    Ok((tx, expected_quote, ctx.quote_decimals))
}
