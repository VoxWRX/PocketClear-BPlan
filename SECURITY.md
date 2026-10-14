# Security & Privacy Policy / Politique de Sécurité

![PocketClear Banner](public/banner.png)

**PocketClear** is engineered from the ground up with a **100% Local-First, Zero-Cloud Security Architecture**. Your personal financial records never leave your device.

---

## 1. Zero Network & Zero Telemetry Guarantee

- **100% Offline Execution**: PocketClear makes **zero** outbound HTTP/HTTPS requests, WebSocket connections, or DNS lookups in production.
- **No Cloud Accounts or Third-Party SDKs**: There are no user registration servers, no analytics trackers (no Google Analytics, Sentry, Mixpanel, or telemetry), and no external bank-scraping APIs.
- **Strict Content Security Policy (CSP)**: Configured in [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json):
  ```text
  default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost
  ```
  This policy blocks external script injection, remote stylesheets, and unauthorized network exfiltration at the OS WebView level.

---

## 2. Local SQLite Storage & ACID Integrity

- **OS-Protected App Data Directory**: In the desktop Tauri v2 runtime, the database is stored locally at `<OS_APP_DATA_DIR>/com.bplan.pocketclear/pocketclear.sqlite`.
- **Write-Ahead Logging (`PRAGMA journal_mode = WAL`)**: Protects against database corruption during unexpected power loss or system crashes.
- **Relational Integrity (`PRAGMA foreign_keys = ON`)**: Enforces referential integrity across `accounts`, `categories`, `projects`, and `transactions`.
- **Atomic Balance Recalculation**: Every transaction creation, edit, duplication, or deletion executes inside an atomic database transaction (`BEGIN IMMEDIATE ... COMMIT`) so account balances and project totals never drift out of sync.

---

## 3. Argon2id Cryptographic PIN & Master Password Protection

- **Memory-Hard Key Derivation**: When you configure a local PIN or Master Password in **Settings & Backup**, PocketClear never stores your PIN in cleartext or reversible encryption.
- **PHC Standard Encoding**:
  - **Rust Backend ([`src-tauri/src/auth.rs`](./src-tauri/src/auth.rs))**: Uses the audited `argon2` crate (`Argon2id` v=19) with a 128-bit cryptographic random salt generated via `rand_core::OsRng`.
  - **TypeScript Engine ([`src/lib/argon2-auth.ts`](./src/lib/argon2-auth.ts))**: Uses `@noble/hashes/argon2` (`argon2id`) with a 16-byte random salt and constant-time comparison (`timingSafeEqualHex`) to prevent timing side-channel attacks.
- **Automatic Inactivity Lock**: [`src/context/AppContext.tsx`](./src/context/AppContext.tsx) monitors user interaction (`mousedown`, `keydown`, `touchstart`, `mousemove`) and automatically engages the full-screen [`LockScreen`](./src/components/layout/LockScreen.tsx) after `5`, `15`, or `30` minutes of inactivity—or immediately when clicking **Lock Now**.

---

## 4. Input Validation & Backup Verification

- **Defense-in-Depth Schema Validation**: Every IPC payload is validated at the frontend boundary via **Zod v4** ([`src/lib/schemas.ts`](./src/lib/schemas.ts)) and deserialized with strict type checking via **Rust Serde** ([`src-tauri/src/models.rs`](./src-tauri/src/models.rs)).
- **Protected `pin_hash` Setting**: Direct writes to `pin_hash` via generic settings APIs are explicitly rejected in both TypeScript (`settingUpdateSchema`) and Rust (`update_setting`), requiring callers to pass through the authenticated `verify_or_set_pin` / `disable_pin` commands.
- **Pre-Restore SQLite Verification ([`src-tauri/src/db.rs`](./src-tauri/src/db.rs))**: Before importing any `.sqlite` backup file, `validate_sqlite_backup` executes:
  1. `PRAGMA integrity_check;` to verify low-level B-tree page integrity.
  2. Table and column schema verification across all 5 core tables (`accounts`, `categories`, `projects`, `transactions`, `app_settings`) before replacing the active database.

---

## 5. Reporting a Vulnerability

Because PocketClear is a local-only desktop application, keeping your operating system user account password-protected and storing exported `.sqlite` / `.csv` backups on encrypted volumes (e.g., FileVault on macOS, BitLocker on Windows, LUKS on Linux) provides full disk-level protection alongside PocketClear's Argon2id application lock.
