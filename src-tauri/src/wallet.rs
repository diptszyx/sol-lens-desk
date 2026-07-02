use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Argon2, Algorithm, Version, Params};
use base64::Engine;
use bip39::{Language, Mnemonic};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_sdk::{signature::Keypair, signer::Signer, transaction::VersionedTransaction};
use std::sync::Mutex;
use std::time::Instant;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

const INACTIVITY_TIMEOUT_SECS: u64 = 900; // 15 minutes

// ── in-memory state ──────────────────────────────────────────────────────────

pub struct VaultWallet {
    pub address: String,
    pub label: String,
    pub keypair: Keypair,
    pub mnemonic: Option<String>,
}

pub struct WalletState {
    pub wallets: Vec<VaultWallet>,
    pub active_address: Option<String>,
    pub app_password: Option<String>,
    pub last_activity: Instant,
}

impl WalletState {
    pub fn new() -> Self {
        Self {
            wallets: Vec::new(),
            active_address: None,
            app_password: None,
            last_activity: Instant::now(),
        }
    }

    pub fn active_keypair(&self) -> Option<&Keypair> {
        let addr = self.active_address.as_ref()?;
        self.wallets.iter().find(|w| &w.address == addr).map(|w| &w.keypair)
    }

    pub fn active_address_str(&self) -> Option<&str> {
        self.active_address.as_deref()
    }

    pub fn is_unlocked(&self) -> bool {
        self.active_address.is_some() && !self.is_timed_out()
    }

    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    pub fn is_timed_out(&self) -> bool {
        self.active_address.is_some()
            && self.last_activity.elapsed().as_secs() > INACTIVITY_TIMEOUT_SECS
    }

    pub fn lock(&mut self) {
        self.wallets.clear();
        self.active_address = None;
        self.app_password = None;
    }
}

// ── stored envelope (encryption layer) ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct StoredWallet {
    #[serde(default = "default_kdf")]
    kdf: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn default_kdf() -> String {
    "sha256".to_string()
}

// ── vault plaintext (what gets encrypted) ────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct VaultPayloadWallet {
    address: String,
    label: String,
    keypair_b64: String,
    mnemonic: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct VaultPayload {
    wallets: Vec<VaultPayloadWallet>,
    active_address: Option<String>,
}

// ── legacy single-wallet plaintext (for migration) ───────────────────────────

#[derive(Serialize, Deserialize)]
struct WalletSecrets {
    keypair_b64: String,
    mnemonic: Option<String>,
}

// ── store keys ───────────────────────────────────────────────────────────────

const STORE_KEY: &str = "wallet.json";
const VAULT_FIELD: &str = "encrypted_vault";
const LEGACY_FIELD: &str = "encrypted_wallet";
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

// ── KDF ──────────────────────────────────────────────────────────────────────

fn derive_key_argon2(password: &str, salt: &[u8]) -> anyhow::Result<[u8; 32]> {
    let params = Params::new(65536, 3, 1, Some(32))
        .map_err(|e| anyhow::anyhow!("KDF params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| anyhow::anyhow!("KDF failed: {e}"))?;
    Ok(key)
}

fn derive_key_sha256(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(password.as_bytes());
    h.update(b"sol-lens-v1");
    h.update(salt);
    h.finalize().into()
}

fn derive_key(password: &str, salt: &[u8]) -> anyhow::Result<[u8; 32]> {
    derive_key_argon2(password, salt)
}

// ── encrypt / decrypt (generic over any serializable plaintext) ──────────────

fn encrypt_payload<T: Serialize>(payload: &T, password: &str) -> anyhow::Result<StoredWallet> {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = serde_json::to_vec(payload).expect("serialize payload");
    let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).expect("aes-gcm encrypt");

    Ok(StoredWallet {
        kdf: "argon2id".to_string(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    })
}

fn try_decrypt_with(stored: &StoredWallet, password: &str, kdf: &str) -> Result<Vec<u8>, String> {
    let salt = B64.decode(&stored.salt).map_err(|e| e.to_string())?;
    let nonce_bytes = B64.decode(&stored.nonce).map_err(|e| e.to_string())?;
    let ciphertext = B64.decode(&stored.ciphertext).map_err(|e| e.to_string())?;

    let key_bytes = match kdf {
        "argon2id" => derive_key_argon2(password, &salt).map_err(|e| e.to_string())?,
        _ => derive_key_sha256(password, &salt),
    };
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Wrong password".to_string())
}

fn decrypt_payload<T: for<'de> Deserialize<'de>>(stored: &StoredWallet, password: &str) -> Result<T, String> {
    let kdf = stored.kdf.as_str();
    if let Ok(bytes) = try_decrypt_with(stored, password, kdf) {
        return serde_json::from_slice(&bytes).map_err(|_| "Corrupt vault data".to_string());
    }
    // Fallback: if stored KDF is missing or sha256, try the other one.
    if kdf != "argon2id" {
        let bytes = try_decrypt_with(stored, password, "argon2id")?;
        return serde_json::from_slice(&bytes).map_err(|_| "Corrupt vault data".to_string());
    }
    if kdf != "sha256" {
        let bytes = try_decrypt_with(stored, password, "sha256")?;
        return serde_json::from_slice(&bytes).map_err(|_| "Corrupt vault data".to_string());
    }
    Err("Wrong password".to_string())
}

// ── storage helpers ──────────────────────────────────────────────────────────

fn payload_to_keypair(keypair_b64: &str) -> Result<Keypair, String> {
    let kb = B64.decode(keypair_b64).map_err(|e| e.to_string())?;
    Keypair::try_from(kb.as_slice()).map_err(|e| e.to_string())
}

fn keypair_to_b64(keypair: &Keypair) -> String {
    B64.encode(keypair.to_bytes())
}

fn load_stored_vault(app: &tauri::AppHandle) -> Option<StoredWallet> {
    let store = app.store(STORE_KEY).ok()?;
    let val = store.get(VAULT_FIELD)?;
    serde_json::from_value(val).ok()
}

fn load_legacy_wallet(app: &tauri::AppHandle) -> Option<StoredWallet> {
    let store = app.store(STORE_KEY).ok()?;
    let val = store.get(LEGACY_FIELD)?;
    serde_json::from_value(val).ok()
}

fn save_stored_vault(app: &tauri::AppHandle, stored: &StoredWallet) -> Result<(), String> {
    let store = app.store(STORE_KEY).map_err(|e| e.to_string())?;
    store.set(VAULT_FIELD, serde_json::to_value(stored).unwrap());
    store.save().map_err(|e| e.to_string())
}

fn rebuild_vault_plaintext(state: &WalletState) -> VaultPayload {
    VaultPayload {
        wallets: state.wallets.iter().map(|w| VaultPayloadWallet {
            address: w.address.clone(),
            label: w.label.clone(),
            keypair_b64: keypair_to_b64(&w.keypair),
            mnemonic: w.mnemonic.clone(),
        }).collect(),
        active_address: state.active_address.clone(),
    }
}

fn re_encrypt_vault(state: &WalletState, app: &tauri::AppHandle) -> Result<(), String> {
    let payload = rebuild_vault_plaintext(state);
    let password = state.app_password.as_ref()
        .ok_or_else(|| "Vault is locked".to_string())?;
    let stored = encrypt_payload(&payload, password).map_err(|e| e.to_string())?;
    save_stored_vault(app, &stored)
}

// ── serializable response types ──────────────────────────────────────────────

#[derive(Serialize)]
pub struct WalletStatus {
    pub has_vault: bool,
    pub is_unlocked: bool,
    pub active_address: Option<String>,
    pub wallets: Vec<WalletInfo>,
}

#[derive(Serialize, Clone)]
pub struct WalletInfo {
    pub address: String,
    pub label: String,
}

#[derive(Serialize)]
pub struct UnlockResult {
    pub active_address: String,
    pub wallets: Vec<WalletInfo>,
}

#[derive(Serialize)]
pub struct CreateResult {
    pub address: String,
    pub mnemonic: String,
    pub wallets: Vec<WalletInfo>,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub address: String,
    pub wallets: Vec<WalletInfo>,
}

#[derive(Serialize)]
pub struct ExportResult {
    pub address: String,
    pub mnemonic: Option<String>,
    pub private_key_b58: String,
}

#[derive(Serialize)]
pub struct SwitchResult {
    pub active_address: String,
}

#[derive(Serialize)]
pub struct RemoveResult {
    pub active_address: String,
    pub wallets: Vec<WalletInfo>,
}

fn wallets_to_info(wallets: &[VaultWallet]) -> Vec<WalletInfo> {
    wallets.iter().map(|w| WalletInfo {
        address: w.address.clone(),
        label: w.label.clone(),
    }).collect()
}

// ── commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_wallet_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> WalletStatus {
    let locked = state.lock().unwrap();
    let has_vault = load_stored_vault(&app).is_some() || load_legacy_wallet(&app).is_some();
    let wallets = wallets_to_info(&locked.wallets);
    WalletStatus {
        has_vault,
        is_unlocked: locked.is_unlocked(),
        active_address: locked.active_address.clone(),
        wallets,
    }
}

#[tauri::command]
pub async fn unlock_wallet(
    password: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<UnlockResult, String> {
    {
        let w = state.lock().unwrap();
        // Already unlocked? just return current state
        if w.is_unlocked() {
            return Ok(UnlockResult {
                active_address: w.active_address.clone().unwrap(),
                wallets: wallets_to_info(&w.wallets),
            });
        }
    }

    // 1. Try vault first
    if let Some(stored) = load_stored_vault(&app) {
        let payload: VaultPayload = decrypt_payload(&stored, &password)?;

        // KDF migration if needed (synchronous)
        if stored.kdf != "argon2id" {
            let migrated = encrypt_payload(&payload, &password).map_err(|e| e.to_string())?;
            save_stored_vault(&app, &migrated).ok();
        }

        let mut wallets: Vec<VaultWallet> = Vec::with_capacity(payload.wallets.len());
        for pw in &payload.wallets {
            wallets.push(VaultWallet {
                address: pw.address.clone(),
                label: pw.label.clone(),
                keypair: payload_to_keypair(&pw.keypair_b64)?,
                mnemonic: pw.mnemonic.clone(),
            });
        }

        let active = payload.active_address.clone();
        let info = wallets_to_info(&wallets);

        let mut w = state.lock().unwrap();
        w.wallets = wallets;
        w.active_address = active.clone();
        w.app_password = Some(password);
        w.last_activity = Instant::now();

        return Ok(UnlockResult {
            active_address: active.unwrap_or_else(|| "".to_string()),
            wallets: info,
        });
    }

    // 2. Legacy migration: decrypt old single wallet, wrap into vault
    if let Some(legacy) = load_legacy_wallet(&app) {
        let secrets: WalletSecrets = decrypt_payload(&legacy, &password)?;
        let keypair = payload_to_keypair(&secrets.keypair_b64)?;
        let address = keypair.pubkey().to_string();

        // Build vault payload
        let payload = VaultPayload {
            wallets: vec![VaultPayloadWallet {
                address: address.clone(),
                label: "Wallet 1".to_string(),
                keypair_b64: secrets.keypair_b64.clone(),
                mnemonic: secrets.mnemonic.clone(),
            }],
            active_address: Some(address.clone()),
        };

        // Encrypt with potentially migrated KDF (synchronous)
        let stored = encrypt_payload(&payload, &password).map_err(|e| e.to_string())?;
        save_stored_vault(&app, &stored)?;

        // DB backfill — this can be async since we've already saved
        let db = app.try_state::<crate::db::DbPool>();
        if let Some(db) = db {
            if let Err(e) = crate::db::backfill_wallet_address(db.inner(), &address).await {
                tracing::warn!("Legacy migration: db backfill failed: {e}");
            }
        }

        let info = {
            let mut w = state.lock().unwrap();
            w.wallets = vec![VaultWallet {
                address: address.clone(),
                label: "Wallet 1".to_string(),
                keypair,
                mnemonic: secrets.mnemonic,
            }];
            w.active_address = Some(address.clone());
            w.app_password = Some(password);
            w.last_activity = Instant::now();
            wallets_to_info(&w.wallets)
        };

        return Ok(UnlockResult {
            active_address: address,
            wallets: info,
        });
    }

    Err("No wallet found".to_string())
}

#[tauri::command]
pub async fn create_wallet(
    password: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<CreateResult, String> {
    let (address, mnemonic_phrase, _label, is_first) = {
        let mut w = state.lock().unwrap();

        let is_first_wallet = !w.is_unlocked() && load_stored_vault(&app).is_none() && load_legacy_wallet(&app).is_none();

        let app_password: String;
        if is_first_wallet {
            let pw = password.ok_or_else(|| "Password is required for first wallet".to_string())?;
            if pw.len() < 6 {
                return Err("Password must be at least 6 characters".to_string());
            }
            app_password = pw;
        } else if !w.is_unlocked() {
            return Err("Wallet is locked — unlock first or create with password".to_string());
        } else {
            app_password = w.app_password.clone().unwrap_or_default();
        }

        let mnemonic = Mnemonic::generate_in(Language::English, 12).map_err(|e| e.to_string())?;
        let seed = mnemonic.to_seed("");
        let keypair = solana_sdk::signature::keypair_from_seed(&seed[..32])
            .map_err(|e| e.to_string())?;
        let addr = keypair.pubkey().to_string();
        let mnem_phrase = mnemonic.to_string();
        let lbl = format!("Wallet {}", w.wallets.len() + 1);

        let is_first = w.wallets.is_empty();
        w.wallets.push(VaultWallet {
            address: addr.clone(),
            label: lbl.clone(),
            keypair,
            mnemonic: Some(mnem_phrase.clone()),
        });
        if w.active_address.is_none() {
            w.active_address = Some(addr.clone());
        }
        if w.app_password.is_none() {
            w.app_password = Some(app_password);
        }
        w.last_activity = Instant::now();

        re_encrypt_vault(&w, &app)?;

        (addr, mnem_phrase, lbl, is_first)
    };

    // DB backfill outside lock
    if is_first {
        let db = app.try_state::<crate::db::DbPool>();
        if let Some(db) = db {
            crate::db::backfill_wallet_address(db.inner(), &address).await.ok();
        }
    }

    let info = wallets_to_info(&state.lock().unwrap().wallets);
    Ok(CreateResult {
        address,
        mnemonic: mnemonic_phrase,
        wallets: info,
    })
}

#[tauri::command]
pub async fn import_wallet(
    secret: String,
    password: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<ImportResult, String> {
    let (address, is_first) = {
        let mut w = state.lock().unwrap();

        let is_first_wallet = !w.is_unlocked() && load_stored_vault(&app).is_none() && load_legacy_wallet(&app).is_none();

        let app_password: String;
        if is_first_wallet {
            let pw = password.ok_or_else(|| "Password is required for first wallet".to_string())?;
            if pw.len() < 6 {
                return Err("Password must be at least 6 characters".to_string());
            }
            app_password = pw;
        } else if !w.is_unlocked() {
            return Err("Wallet is locked — unlock first or import with password".to_string());
        } else {
            app_password = w.app_password.clone().unwrap_or_default();
        }

        let trimmed = secret.trim();
        let word_count = trimmed.split_whitespace().count();

        let (keypair, mnemonic) = if word_count >= 3 {
            let m = Mnemonic::parse_in(Language::English, trimmed)
                .map_err(|e| format!("Invalid mnemonic: {e}"))?;
            let seed = m.to_seed("");
            let kp = solana_sdk::signature::keypair_from_seed(&seed[..32])
                .map_err(|e| e.to_string())?;
            (kp, Some(m.to_string()))
        } else {
            let bytes = bs58::decode(trimmed)
                .into_vec()
                .map_err(|e| format!("Invalid base58: {e}"))?;
            let kp = match bytes.len() {
                64 => Keypair::try_from(bytes.as_slice()).map_err(|e| e.to_string())?,
                32 => solana_sdk::signature::keypair_from_seed(&bytes)
                    .map_err(|e| e.to_string())?,
                n => return Err(format!("Expected 32 or 64 bytes, got {n}")),
            };
            (kp, None)
        };

        let addr = keypair.pubkey().to_string();
        let lbl = format!("Wallet {}", w.wallets.len() + 1);

        let is_first = w.wallets.is_empty();
        w.wallets.push(VaultWallet {
            address: addr.clone(),
            label: lbl,
            keypair,
            mnemonic,
        });
        if w.active_address.is_none() {
            w.active_address = Some(addr.clone());
        }
        if w.app_password.is_none() {
            w.app_password = Some(app_password);
        }
        w.last_activity = Instant::now();

        re_encrypt_vault(&w, &app)?;

        (addr, is_first)
    };

    // DB backfill outside lock
    if is_first {
        let db = app.try_state::<crate::db::DbPool>();
        if let Some(db) = db {
            crate::db::backfill_wallet_address(db.inner(), &address).await.ok();
        }
    }

    let info = wallets_to_info(&state.lock().unwrap().wallets);
    Ok(ImportResult {
        address,
        wallets: info,
    })
}

#[tauri::command]
pub fn switch_active_wallet(
    address: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<SwitchResult, String> {
    let mut w = state.lock().unwrap();
    if !w.is_unlocked() {
        return Err("Wallet is locked".to_string());
    }
    if !w.wallets.iter().any(|wal| wal.address == address) {
        return Err("Wallet not found in vault".to_string());
    }
    w.active_address = Some(address.clone());
    w.last_activity = Instant::now();
    re_encrypt_vault(&w, &app)?;
    Ok(SwitchResult { active_address: address })
}

#[tauri::command]
pub fn remove_wallet(
    address: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<RemoveResult, String> {
    let mut w = state.lock().unwrap();
    if !w.is_unlocked() {
        return Err("Wallet is locked".to_string());
    }
    if w.wallets.len() <= 1 {
        return Err("Cannot remove the last wallet".to_string());
    }
    let idx = w.wallets.iter().position(|wal| wal.address == address)
        .ok_or_else(|| "Wallet not found in vault".to_string())?;
    w.wallets.remove(idx);

    // If the removed wallet was active, pick the first remaining one
    if w.active_address.as_deref() == Some(&address) {
        w.active_address = w.wallets.first().map(|wal| wal.address.clone());
    }

    w.last_activity = Instant::now();
    re_encrypt_vault(&w, &app)?;

    let active = w.active_address.clone().unwrap_or_default();
    Ok(RemoveResult {
        active_address: active,
        wallets: wallets_to_info(&w.wallets),
    })
}

#[tauri::command]
pub fn rename_wallet(
    address: String,
    label: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<(), String> {
    let mut w = state.lock().unwrap();
    if !w.is_unlocked() {
        return Err("Wallet is locked".to_string());
    }
    let wal = w.wallets.iter_mut().find(|wal| wal.address == address)
        .ok_or_else(|| "Wallet not found in vault".to_string())?;
    wal.label = label;
    w.last_activity = Instant::now();
    re_encrypt_vault(&w, &app)
}

#[tauri::command]
pub fn export_wallet(
    password: String,
    address: Option<String>,
    app: tauri::AppHandle,
) -> Result<ExportResult, String> {
    // Try vault first, then legacy
    if let Some(stored) = load_stored_vault(&app) {
        let payload: VaultPayload = decrypt_payload(&stored, &password)?;
        let target_addr = address.unwrap_or_else(|| payload.active_address.clone().unwrap_or_default());
        let pw = payload.wallets.iter()
            .find(|pw| pw.address == target_addr)
            .ok_or_else(|| "Wallet not found in vault".to_string())?;

        let keypair = payload_to_keypair(&pw.keypair_b64)?;
        return Ok(ExportResult {
            address: pw.address.clone(),
            private_key_b58: bs58::encode(keypair.to_bytes()).into_string(),
            mnemonic: pw.mnemonic.clone(),
        });
    }

    // Legacy fallback
    if let Some(legacy) = load_legacy_wallet(&app) {
        let secrets: WalletSecrets = decrypt_payload(&legacy, &password)?;
        let keypair = payload_to_keypair(&secrets.keypair_b64)?;
        return Ok(ExportResult {
            address: keypair.pubkey().to_string(),
            private_key_b58: bs58::encode(keypair.to_bytes()).into_string(),
            mnemonic: secrets.mnemonic,
        });
    }

    Err("No wallet found".to_string())
}

#[tauri::command]
pub fn lock_wallet(state: tauri::State<'_, Mutex<WalletState>>) {
    let mut w = state.lock().unwrap();
    w.lock();
}

/// Sign a base64-encoded VersionedTransaction with the given keypair, replacing
/// signature slot 0. Pure helper shared by the active-wallet command path and the
/// backend auto-sell path (which signs as a specific position owner).
fn sign_message_tx(keypair: &Keypair, tx_base64: &str) -> Result<String, String> {
    let tx_bytes = B64.decode(tx_base64).map_err(|e| format!("base64: {e}"))?;
    let mut tx: VersionedTransaction =
        bincode::deserialize(&tx_bytes).map_err(|e| format!("deserialize tx: {e}"))?;

    let message_bytes = tx.message.serialize();
    let sig = keypair.sign_message(&message_bytes);

    if tx.signatures.is_empty() {
        tx.signatures.push(sig);
    } else {
        tx.signatures[0] = sig;
    }

    let signed_bytes = bincode::serialize(&tx).map_err(|e| format!("serialize: {e}"))?;
    Ok(B64.encode(signed_bytes))
}

#[tauri::command]
pub fn sign_transaction(
    tx_base64: String,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<String, String> {
    let mut locked = state.lock().unwrap();
    // Manual (user-initiated) signing still honors the inactivity timeout — but we
    // do NOT clear keys here. Keys remain resident so the background stop-loss
    // tracker keeps its independent signing authority; the UI just re-prompts for
    // the app password (see WalletGate re-lock polling). Explicit lock_wallet or
    // app exit is what actually wipes keys.
    if locked.is_timed_out() {
        return Err("Session expired — unlock again to sign".to_string());
    }
    let keypair = locked.active_keypair().ok_or_else(|| "Wallet is locked".to_string())?;
    let signed = sign_message_tx(keypair, &tx_base64)?;
    locked.touch();
    Ok(signed)
}

/// True when `owner`'s keypair is resident in the vault. Deliberately ignores the
/// inactivity timeout: the background stop-loss tracker holds an independent
/// signing authority so SL keeps protecting positions even after the UI idle
/// window elapses. Keys stay resident until an explicit `lock_wallet` or app exit.
pub fn owner_available(state: &Mutex<WalletState>, owner: &str) -> bool {
    let locked = state.lock().unwrap();
    locked.wallets.iter().any(|w| w.address == owner)
}

/// Sign a transaction as a specific vault wallet (the position owner), not the
/// active wallet. Used by the backend stop-loss auto-sell so SL protects every
/// wallet in the vault regardless of which one the UI is focused on.
///
/// Independent of the UI inactivity timeout by design — the tracker must be able
/// to cut losses on an unattended, idle app. Does NOT `touch()`: automated sells
/// are not user activity and must not extend the UI's manual-signing session.
pub fn sign_tx_as(
    state: &Mutex<WalletState>,
    owner: &str,
    tx_base64: &str,
) -> Result<String, String> {
    let locked = state.lock().unwrap();
    let keypair = locked
        .wallets
        .iter()
        .find(|w| w.address == owner)
        .map(|w| &w.keypair)
        .ok_or_else(|| "Owner wallet not unlocked".to_string())?;
    sign_message_tx(keypair, tx_base64)
}
