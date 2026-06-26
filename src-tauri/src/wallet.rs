use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine;
use bip39::{Language, Mnemonic};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_sdk::{signature::Keypair, signer::Signer, transaction::VersionedTransaction};
use std::sync::Mutex;
use tauri_plugin_store::StoreExt;

pub struct WalletState(pub Option<Keypair>);

#[derive(Debug, Serialize, Deserialize)]
struct StoredWallet {
    salt: String,
    nonce: String,
    ciphertext: String,
}

/// Plaintext stored inside the AES-GCM envelope (JSON).
#[derive(Serialize, Deserialize)]
struct WalletSecrets {
    /// base64-encoded 64-byte Solana keypair.
    keypair_b64: String,
    /// BIP39 mnemonic, present when the wallet was created or imported via phrase.
    mnemonic: Option<String>,
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

fn encrypt_secrets(secrets: &WalletSecrets, password: &str) -> StoredWallet {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(password, &salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = serde_json::to_vec(secrets).expect("serialize wallet secrets");
    let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).expect("aes-gcm encrypt");

    StoredWallet {
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    }
}

fn decrypt_secrets(stored: &StoredWallet, password: &str) -> Result<(Keypair, Option<String>), String> {
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

    let secrets: WalletSecrets = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("Corrupt wallet data: {e}"))?;

    let kb = B64.decode(&secrets.keypair_b64).map_err(|e| e.to_string())?;
    let keypair = Keypair::try_from(kb.as_slice()).map_err(|e| e.to_string())?;

    Ok((keypair, secrets.mnemonic))
}

fn keypair_to_secrets(keypair: &Keypair, mnemonic: Option<String>) -> WalletSecrets {
    WalletSecrets {
        keypair_b64: B64.encode(keypair.to_bytes()),
        mnemonic,
    }
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

#[derive(Serialize)]
pub struct CreateResult {
    pub address: String,
    pub mnemonic: String,
}

#[derive(Serialize)]
pub struct ExportResult {
    pub address: String,
    pub mnemonic: Option<String>,
    pub private_key_b58: String,
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
) -> Result<CreateResult, String> {
    if password.len() < 6 {
        return Err("Password must be at least 6 characters".to_string());
    }
    let mnemonic = Mnemonic::generate_in(Language::English, 12).map_err(|e| e.to_string())?;
    let seed = mnemonic.to_seed("");
    let keypair = solana_sdk::signature::keypair_from_seed(&seed[..32])
        .map_err(|e| e.to_string())?;
    let address = keypair.pubkey().to_string();
    let mnemonic_phrase = mnemonic.to_string();
    let secrets = keypair_to_secrets(&keypair, Some(mnemonic_phrase.clone()));
    save_stored(&app, &encrypt_secrets(&secrets, &password))?;
    state.lock().unwrap().0 = Some(keypair);
    Ok(CreateResult { address, mnemonic: mnemonic_phrase })
}

#[tauri::command]
pub fn import_wallet(
    secret: String,
    password: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<WalletState>>,
) -> Result<String, String> {
    if password.len() < 6 {
        return Err("Password must be at least 6 characters".to_string());
    }
    let trimmed = secret.trim();
    let word_count = trimmed.split_whitespace().count();

    let (keypair, mnemonic) = if word_count >= 3 {
        // Treat as BIP39 mnemonic
        let m = Mnemonic::parse_in(Language::English, trimmed)
            .map_err(|e| format!("Invalid mnemonic: {e}"))?;
        let seed = m.to_seed("");
        let kp = solana_sdk::signature::keypair_from_seed(&seed[..32])
            .map_err(|e| e.to_string())?;
        (kp, Some(m.to_string()))
    } else {
        // Treat as base58 private key
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

    let address = keypair.pubkey().to_string();
    let secrets = keypair_to_secrets(&keypair, mnemonic);
    save_stored(&app, &encrypt_secrets(&secrets, &password))?;
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
    let (keypair, _) = decrypt_secrets(&stored, &password)?;
    let address = keypair.pubkey().to_string();
    state.lock().unwrap().0 = Some(keypair);
    Ok(address)
}

#[tauri::command]
pub fn lock_wallet(state: tauri::State<'_, Mutex<WalletState>>) {
    state.lock().unwrap().0 = None;
}

#[tauri::command]
pub fn export_wallet(
    password: String,
    app: tauri::AppHandle,
) -> Result<ExportResult, String> {
    let stored = load_stored(&app).ok_or_else(|| "No wallet found".to_string())?;
    let (keypair, mnemonic) = decrypt_secrets(&stored, &password)?;
    Ok(ExportResult {
        address: keypair.pubkey().to_string(),
        private_key_b58: bs58::encode(keypair.to_bytes()).into_string(),
        mnemonic,
    })
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
