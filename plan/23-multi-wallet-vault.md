# P23: Multi-Wallet Vault + Single App Password

**Status:** Planned
**Depends on:** P16 (wallet encryption, AES-256-GCM + Argon2id), P06/P07/P11 (trade flow, portfolio, DB schema)

---

## Problems (reported)

Current architecture is **single-wallet-per-device**. This causes four user-visible defects:

1. **History leak on wallet switch.** DB tables (`trades`, `closed_positions`, `open_positions`, `pet_state`) have **no wallet column**. Every query is global. A freshly created wallet shows the previous wallet's closed positions / win rate / PnL.
   - `db.rs:68-114` — schema has no `wallet_address`.
   - `db.rs:180` `get_closed_positions`, `db.rs:285` `get_open_positions` — no filter.

2. **Password is per-wallet, not per-app.** The password is the AES key-derivation input for that one wallet's secret (`wallet.rs:85` `encrypt_secrets(secrets, password)`). There is no separate "app password". Each new wallet demands a new password.

3. **Only one wallet is ever saved.** Store `wallet.json` has a single field `encrypted_wallet` (`wallet.rs:59-60`). One slot only.

4. **Switching a wallet destroys the old one.** `create_wallet` / `import_wallet` call `save_stored`, which **overwrites** the single slot (`wallet.rs:221,265`). The previous wallet is gone unless its seed phrase was exported. There is no wallet list.

All four are symptoms of the same root cause: the single-wallet architecture. The fix is a redesign to a **multi-wallet vault** unlocked by **one app password**.

---

## Target architecture

**Vault model:** one app password unlocks one vault holding N wallets. Switching changes the *active* wallet — it never deletes. Trade/position history is scoped per wallet, server-side.

```
wallet.json → field "encrypted_vault"
  AES-256-GCM envelope (Argon2id KDF: salt / nonce / ciphertext)   ← app password
    └─ plaintext JSON:
       {
         "wallets": [
           { "address": "...", "label": "Wallet 1", "keypair_b64": "...", "mnemonic": "..." },
           ...
         ],
         "active_address": "..."
       }
```

**Decision — pet state stays GLOBAL.** The pet is an app-wide mascot; XP/level accumulate across wallets. `pet_state` is **not** scoped. (Revisit later if per-wallet pets are wanted.)

**Decision — active wallet address is resolved server-side** from `WalletState`. DB commands read the active address from state; the frontend does **not** pass an address. This keeps frontend invoke signatures unchanged and prevents a compromised renderer from reading another wallet's rows.

---

## Backend — `wallet.rs`

### In-memory state (while unlocked)

```rust
struct VaultWallet {
    address: String,
    label: String,
    keypair: Keypair,
    mnemonic: Option<String>,
}

pub struct WalletState {
    wallets: Vec<VaultWallet>,
    active_address: Option<String>,
    app_password: Option<String>,   // held to re-encrypt vault on add/remove/rename
    last_activity: Instant,
}
```

Helpers: `active_keypair()`, `active_address()`, `is_timed_out()`, `touch()`, `lock()` (zeroize wallets + password).

### Persistence

- `StoredVault` envelope reuses existing `encrypt_secrets` / `decrypt_secrets` primitives (Argon2id, AES-GCM) — only the plaintext payload changes from `WalletSecrets` to `VaultPayload { wallets, active_address }`.
- `load_vault(app)` / `save_vault(app, &StoredVault)` against store key `wallet.json`, field `encrypted_vault`.
- `re_encrypt_vault(state, app)` — rebuild plaintext from in-memory wallets + active, encrypt with held `app_password`, save. Called after every mutation while unlocked.

### Migration (idempotent)

On `unlock_wallet`, if `encrypted_vault` is absent but the legacy `encrypted_wallet` field exists:
1. Decrypt legacy wallet with the supplied password (this becomes the app password).
2. Wrap into a single-element vault, `active_address = that address`, `label = "Wallet 1"`.
3. Save as `encrypted_vault`. Leave `encrypted_wallet` in place (harmless) or remove after successful write.
4. Trigger **DB backfill** (see below) with the migrated address.

### Commands

| Command | New behavior |
|---|---|
| `get_wallet_status` | returns `{ has_vault, is_unlocked, active_address, wallets: [{address,label}] }` |
| `unlock_wallet(password)` | decrypt vault (or migrate legacy), load all wallets, set active, hold password. Returns active address + list |
| `create_wallet(password?)` | **no vault** → `password` becomes app password, create first wallet. **Unlocked** → add new wallet to vault (password ignored/optional). Returns `{ address, mnemonic }` |
| `import_wallet(secret, password?)` | same dual behavior as create |
| `switch_active_wallet(address)` | set active, persist, return address. **No lock, no data loss** |
| `remove_wallet(address)` | remove from vault (block removing the last one); if it was active, pick another active |
| `rename_wallet(address, label)` | update label, persist |
| `export_wallet(password, address?)` | verify password, export active or specified wallet |
| `sign_transaction(tx_base64)` | sign with **active** keypair |
| `lock_wallet` | clear in-memory wallets + password |

`lib.rs` — register: `switch_active_wallet`, `remove_wallet`, `rename_wallet` (new); keep the rest.

---

## Backend — DB scoping (`db.rs`, `commands/history.rs`, `commands/positions.rs`)

### Schema migration (run in `DbPool::open`, idempotent)

- `ALTER TABLE trades ADD COLUMN wallet_address TEXT;`
- `ALTER TABLE closed_positions ADD COLUMN wallet_address TEXT;`
- `open_positions` — PK is currently `mint`; rebuild to composite `(mint, wallet_address)` so two wallets can hold the same token:
  1. create `open_positions_v2` with `PRIMARY KEY (mint, wallet_address)`
  2. `INSERT INTO open_positions_v2 SELECT *, NULL FROM open_positions`
  3. drop old, rename new
- Guard each `ALTER`/rebuild with a check (pragma `table_info`) so it runs once.

### Query changes

Every read/write gains a `wallet_address` bind:
- `log_trade`, `close_position`, `tx_signature_exists`, `get_closed_positions`, `get_open_positions`, `upsert_open_position`, `delete_open_position` — add `wallet_address: &str` param, add `WHERE wallet_address = ?1` / include column on insert.
- `tx_signature_exists` stays effectively global-safe (signatures are unique) but scope it for consistency.

### Command layer wiring

- Inject `State<'_, Mutex<WalletState>>` into every command in `history.rs` and `positions.rs`.
- Read `active_address()`; error `"Wallet is locked"` if none.
- Pass it into the `db.*` call. **Frontend invoke signatures unchanged.**
- Background auto-sell (price tracker → `record_closed_position`) also resolves active address server-side — no frontend address needed.

### Backfill

New `db.backfill_wallet_address(addr)`:
```sql
UPDATE trades           SET wallet_address = ?1 WHERE wallet_address IS NULL;
UPDATE closed_positions SET wallet_address = ?1 WHERE wallet_address IS NULL;
UPDATE open_positions   SET wallet_address = ?1 WHERE wallet_address IS NULL;
```
Called once after legacy→vault migration with the migrated wallet's address, so pre-existing history belongs to the pre-existing wallet.

---

## Frontend

### `store/wallet.ts`
Add `wallets: {address,label}[]`, `activeAddress: string | null`, and actions `setWallets`, `setActiveAddress`.

### `WalletGate.tsx`
Consume new `get_wallet_status` shape (`has_vault`, `wallets`, `active_address`). Populate store on unlock.

### `WalletDropdown.tsx`
Replace the "Switch wallet" replace-flow (and remove the "This device supports 1 wallet" warning) with a wallet **list**:
- each row: label + truncated address + active radio/check
- click row → `switch_active_wallet(address)` → update store → reload positions & history
- "+ Add wallet" → open setup in add-mode (no password field)
- rename (inline) → `rename_wallet`
- remove → `remove_wallet` (disabled when only one wallet)
- keep Export + Lock

### `WalletSetup.tsx`
Add-mode (already unlocked): hide the password / confirm fields; call `create_wallet` / `import_wallet` without a password. First-time setup keeps the password fields (sets the app password).

### On active-wallet switch
Re-run `restoreOpenPositions()` and refetch `get_closed_positions` so the portfolio column and History panel reflect the new active wallet. Clear stale positions/pet-trade bridge state.

---

## Files touched

**Rust:** `wallet.rs`, `db.rs`, `commands/history.rs`, `commands/positions.rs`, `lib.rs`
**TS:** `store/wallet.ts`, `store/portfolio.ts`, `components/wallet/WalletDropdown.tsx`, `components/auth/WalletSetup.tsx`, `components/auth/WalletGate.tsx`, `hooks/useWallet.ts`

---

## Risks & mitigations

- **Data migration.** Back up `wallet.json` and the SQLite DB before first run. Make every migration step idempotent and guarded.
- **Lost previous wallet.** The wallet overwritten *before* this change is unrecoverable without its seed phrase. Multi-wallet only prevents loss going forward — state this to the user.
- **App password held in memory.** Needed to re-encrypt the vault on mutation; it is no more sensitive than the decrypted keypairs already held. Zeroize on `lock`.
- **Composite PK rebuild.** Test the `open_positions` rebuild against a DB with existing rows.

## Test plan

- [ ] Fresh install: create wallet → app password set, vault has 1 wallet.
- [ ] Legacy DB+wallet: unlock migrates to vault; existing history backfilled to that address; nothing leaks.
- [ ] Add second wallet while unlocked (no password prompt) → appears in list, its history empty.
- [ ] Switch active wallet → positions/history swap correctly, no cross-wallet leak.
- [ ] Trade on wallet B → recorded under B only; switch to A → unaffected.
- [ ] Remove non-active wallet; cannot remove the last wallet.
- [ ] Export active + specified wallet with app password.
- [ ] Lock → in-memory cleared; unlock restores active wallet.
- [ ] `sign_transaction` uses the active keypair after a switch.
