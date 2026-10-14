//! PocketClear Tauri v2 Library Entry Point.
//! Initializes the local SQLite database (`pocketclear.sqlite` in OS `app_data_dir`)
//! and registers all 25 offline IPC command handlers.

pub mod auth;
pub mod commands;
pub mod db;
pub mod models;

use commands::*;
use db::{init_database, DbState};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve OS app_data_dir");
            let db_path = app_data_dir.join("pocketclear.sqlite");
            let conn = init_database(&db_path).expect("Failed to initialize SQLite database");
            app.manage(DbState {
                conn: Mutex::new(conn),
                db_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard_summary,
            get_transactions,
            create_transaction,
            duplicate_transaction,
            update_transaction,
            delete_transaction,
            get_accounts,
            create_account,
            update_account,
            complete_onboarding,
            get_categories,
            create_category,
            update_category,
            delete_category,
            get_projects,
            create_project,
            update_project,
            delete_project,
            export_backup_db,
            import_backup_db,
            verify_or_set_pin,
            disable_pin,
            check_auth_state,
            get_settings,
            update_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PocketClear Tauri application");
}
