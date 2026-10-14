//! SQLite Database Initialization, Schema Migration & Backup Integrity Verification.
//! Enforces WAL journal mode, foreign keys, and pre-restore schema/integrity validation.

use rusqlite::{Connection, Result as SqlResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
}

pub const SCHEMA_SQL: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    starting_balance REAL NOT NULL DEFAULT 0.0,
    current_balance REAL NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    icon TEXT NOT NULL DEFAULT 'circle',
    color TEXT DEFAULT '#10b981',
    monthly_budget REAL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target_budget REAL NOT NULL DEFAULT 0.0,
    status TEXT CHECK(status IN ('active', 'completed', 'paused')) DEFAULT 'active',
    kind TEXT CHECK(kind IN ('month', 'project')) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    project_id TEXT,
    amount REAL NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    payee TEXT NOT NULL,
    date TEXT NOT NULL, -- ISO-8601 YYYY-MM-DD
    is_recurring INTEGER DEFAULT 0, -- 1 for recurring, 0 for one-off
    recurring_interval TEXT, -- 'monthly', 'weekly', 'yearly'
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
"#;

/// Opens (or creates) the SQLite database at `db_path`, applies WAL journal mode and foreign-key
/// enforcement, runs non-destructive schema migrations, and seeds default application settings.
pub fn init_database(db_path: &Path) -> SqlResult<Connection> {
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA_SQL)?;
    let _ = conn.execute(
        "ALTER TABLE projects ADD COLUMN kind TEXT CHECK(kind IN ('month', 'project')) DEFAULT NULL",
        [],
    );
    let has_category_fk: bool = {
        let mut stmt = conn.prepare("PRAGMA foreign_key_list(transactions);")?;
        let tables = stmt.query_map([], |row| row.get::<_, String>(2))?;
        let mut found = false;
        for t in tables.flatten() {
            if t.eq_ignore_ascii_case("categories") {
                found = true;
                break;
            }
        }
        found
    };
    if has_category_fk {
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = OFF;
            BEGIN IMMEDIATE;
            CREATE TABLE transactions_new (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                category_id TEXT NOT NULL,
                project_id TEXT,
                amount REAL NOT NULL,
                type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
                payee TEXT NOT NULL,
                date TEXT NOT NULL,
                is_recurring INTEGER DEFAULT 0,
                recurring_interval TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
            );
            INSERT INTO transactions_new (id, account_id, category_id, project_id, amount, type, payee, date, is_recurring, recurring_interval, notes, created_at)
            SELECT id, account_id, category_id, project_id, amount, type, payee, date, is_recurring, recurring_interval, notes, created_at FROM transactions;
            DROP TABLE transactions;
            ALTER TABLE transactions_new RENAME TO transactions;
            CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
            CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
            CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
            COMMIT;
            PRAGMA foreign_keys = ON;
            "#,
        )?;
    }
    seed_default_settings(&conn)?;
    Ok(conn)
}

/// Inserts default application settings (`INSERT OR IGNORE`) so existing preferences are preserved.
fn seed_default_settings(conn: &Connection) -> SqlResult<()> {
    let defaults = [
        ("currency", "USD"),
        ("language", "en"),
        ("theme", "system"),
        ("accent", "emerald"),
        ("decimal_separator", "."),
        ("date_format", "YYYY-MM-DD"),
        ("auto_lock_minutes", "15"),
    ];
    for (k, v) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![k, v],
        )?;
    }
    Ok(())
}

/// Verifies that `source_path` is an uncorrupted SQLite database (`PRAGMA integrity_check`)
/// and contains all required PocketClear tables and columns before restoring a backup.
pub fn validate_sqlite_backup(source_path: &Path) -> Result<(), String> {
    if !source_path.exists() {
        return Err("Backup file does not exist.".to_string());
    }
    let conn = Connection::open(source_path).map_err(|e| format!("Invalid SQLite file: {}", e))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check;", [], |row| row.get(0))
        .map_err(|e| format!("Integrity check failed: {}", e))?;
    if integrity.to_lowercase() != "ok" {
        return Err(format!("Database integrity check failed: {}", integrity));
    }

    let required_schema: &[(&str, &[&str])] = &[
        (
            "accounts",
            &[
                "id",
                "name",
                "starting_balance",
                "current_balance",
                "currency",
                "created_at",
            ],
        ),
        (
            "categories",
            &["id", "name", "type", "icon", "color", "monthly_budget"],
        ),
        (
            "projects",
            &["id", "name", "target_budget", "status", "created_at"],
        ),
        (
            "transactions",
            &[
                "id",
                "account_id",
                "category_id",
                "project_id",
                "amount",
                "type",
                "payee",
                "date",
                "is_recurring",
                "recurring_interval",
                "notes",
                "created_at",
            ],
        ),
        ("app_settings", &["key", "value"]),
    ];

    for (tbl, expected_cols) in required_schema {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                rusqlite::params![tbl],
                |row| row.get(0),
            )
            .map_err(|e| format!("Schema check failed: {}", e))?;
        if count == 0 {
            return Err(format!("Backup database is missing required table: {}", tbl));
        }

        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", tbl))
            .map_err(|e| format!("Table info check failed for {}: {}", tbl, e))?;
        let col_iter = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("Column read failed for {}: {}", tbl, e))?;
        let mut present_cols = Vec::new();
        for col_res in col_iter {
            present_cols.push(col_res.map_err(|e| format!("Column parse failed: {}", e))?);
        }

        for req_col in *expected_cols {
            if !present_cols.iter().any(|c| c == req_col) {
                return Err(format!(
                    "Backup database table '{}' is missing required column '{}'",
                    tbl, req_col
                ));
            }
        }
    }
    Ok(())
}
