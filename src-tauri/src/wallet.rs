use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_sdk::{signature::Keypair, signer::Signer, transaction::VersionedTransaction};
use std::sync::Mutex;
use tauri_plugin_store::StoreExt;

// Keypair held in RAM while the wallet is unlocked. Cleared on lock/exit.
pub struct WalletState(pub Option<Keypair>);

#[derive(Debug, Serialize, Deserialize)]
struct StoredWallet {
    salt: String,   // base64
    nonce: String,  // base64
    ciphertext: String, // base64
}

const STORE_KEY: &str = "wallet.json";
const WALLET_FIELD: &str = "encrypted_wallet";
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(password.as_bytes());
    h.update(b"sol-lens-v1");
    h.update(salt);
    h.finalize().into()
}

fn encrypt(keypair: &Keypair, password: &str) -> StoredWallet {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(password, &salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = keypair.to_bytes(); // 64 bytes: secret ++ public
    let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).expect("aes-gcm encrypt");

    StoredWallet {
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    }
}

fn decrypt(stored: &StoredWallet, password: &str) -> Result<Keypair, String> {
    let salt = B64.decode(&stored.salt).map_err(|e| e.to_string())?;
    let nonce_bytes = B64.decode(&stored.nonce).map_err(|e| e.to_string())?;
    let ciphertext = B64.decode(&stored.ciphertext).map_err(|e| e.to_string())?;

    let key_bytes = derive_key(password, &salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Wrong password".to_string())?;

    Keypair::from_bytes(&plaintext).map_err(|e| e.to_string())
}

fn load_stored(app: &tauri::AppHandle) -> Option<StoredWallet> {
    let store = app.store(STORE_KEY).ok()?;
    let val = store.get(WALLET_FIELD)?;
    serde_json::from_value(val).ok()
}

fn save_stored(app: &tauri::AppHandle, stored: &StoredWallet) -> Result<(), String> {
    let store = app.store(STORE_KEY).map_err(|e| e.to_string())?;
    store.set(WALLET_FIELD, serde_json::to_value(stored).unwrap());
    store.save().map_err(|e| e.to_string())
}

// ── commands ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct WalletStatus {
    pub has_wallet: bool,
    pub is_unlocked: bool,
    pub address: Option<String>,
}

#[tauri::command]
pub fn get_wallet_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> WalletStatus {
    let locked = state.lock().unwrap();
    WalletStatus {
        has_wallet: load_stored(&app).is_some(),
        is_unlocked: locked.0.is_some(),
        address: locked.0.as_ref().map(|kp| kp.pubkey().to_string()),
    }
}

#[tauri::command]
pub fn create_wallet(
    password: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<String, String> {
    let keypair = Keypair::new();
    let address = keypair.pubkey().to_string();
    let stored = encrypt(&keypair, &password);
    save_stored(&app, &stored)?;
    state.lock().unwrap().0 = Some(keypair);
    Ok(address)
}

#[tauri::command]
pub fn import_wallet(
    private_key: String,
    password: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<String, String> {
    let trimmed = private_key.trim();
    let bytes = bs58::decode(trimmed)
        .into_vec()
        .map_err(|e| format!("Invalid base58: {e}"))?;

    let keypair = match bytes.len() {
        64 => Keypair::from_bytes(&bytes).map_err(|e| e.to_string())?,
        32 => solana_sdk::signature::keypair_from_seed(&bytes)
            .map_err(|e| e.to_string())?,
        n => return Err(format!("Expected 32 or 64 bytes, got {n}")),
    };

    let address = keypair.pubkey().to_string();
    let stored = encrypt(&keypair, &password);
    save_stored(&app, &stored)?;
    state.lock().unwrap().0 = Some(keypair);
    Ok(address)
}

#[tauri::command]
pub fn unlock_wallet(
    password: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<String, String> {
    let stored = load_stored(&app).ok_or_else(|| "No wallet found".to_string())?;
    let keypair = decrypt(&stored, &password)?;
    let address = keypair.pubkey().to_string();
    state.lock().unwrap().0 = Some(keypair);
    Ok(address)
}

#[tauri::command]
pub fn lock_wallet(state: tauri::State<'_, Mutex<WalletState>>) {
    state.lock().unwrap().0 = None;
}

#[tauri::command]
pub fn sign_transaction(
    tx_base64: String,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<String, String> {
    let locked = state.lock().unwrap();
    let keypair = locked.0.as_ref().ok_or_else(|| "Wallet is locked".to_string())?;

    let tx_bytes = B64.decode(&tx_base64).map_err(|e| format!("base64: {e}"))?;
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
