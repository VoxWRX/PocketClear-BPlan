//! Tauri v2 IPC Command Handlers for PocketClear.
//! Implements ACID SQLite transactions, balance recalculation, dashboard analytics,
//! Argon2id PIN management, and verified SQLite backup/restore operations.

use crate::auth::{hash_pin_argon2id, verify_pin_argon2id};
use crate::db::{init_database, validate_sqlite_backup, DbState};
use crate::models::*;
use chrono::{Datelike, Duration, Local, NaiveDate};
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn step_recurring_date(d: NaiveDate, interval: &str, orig_day: u32) -> NaiveDate {
    match interval {
        "weekly" => d + Duration::days(7),
        "yearly" => {
            let target_year = d.year() + 1;
            let max_d = days_in_month(target_year, d.month());
            NaiveDate::from_ymd_opt(target_year, d.month(), orig_day.min(max_d))
                .unwrap_or(d + Duration::days(365))
        }
        _ => {
            // monthly default
            let (target_year, target_month) = if d.month() == 12 {
                (d.year() + 1, 1)
            } else {
                (d.year(), d.month() + 1)
            };
            let max_d = days_in_month(target_year, target_month);
            NaiveDate::from_ymd_opt(target_year, target_month, orig_day.min(max_d))
                .unwrap_or(d + Duration::days(30))
        }
    }
}

fn compute_next_due_date(last_date_str: &str, interval: &str, today: NaiveDate) -> NaiveDate {
    let parsed = NaiveDate::parse_from_str(last_date_str, "%Y-%m-%d").unwrap_or(today);
    let orig_day = parsed.day();
    // Always advance at least one cycle beyond the last recorded payment date
    let mut next = step_recurring_date(parsed, interval, orig_day);
    // Keep recently overdue occurrences (within the past 7 days) visible so the user is alerted
    let grace_cutoff = today - Duration::days(7);
    let max_iters = 240;
    let mut iter = 0;
    while next < grace_cutoff && iter < max_iters {
        iter += 1;
        next = step_recurring_date(next, interval, orig_day);
    }
    next
}

#[tauri::command]
pub fn get_dashboard_summary(
    reference_date: Option<String>,
    state: State<'_, DbState>,
) -> Result<DashboardSummary, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let today = reference_date
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| Local::now().date_naive());

    let current_month_prefix = format!("{:04}-{:02}", today.year(), today.month());

    let account_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
        .unwrap_or(0);

    let total_balance: f64 = conn
        .query_row(
            "SELECT ROUND(COALESCE(SUM(current_balance), 0.0), 2) FROM accounts",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let currency: String = conn
        .query_row(
            "SELECT currency FROM accounts ORDER BY created_at ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .or_else(|_| {
            conn.query_row(
                "SELECT value FROM app_settings WHERE key = 'currency'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap_or_else(|_| "USD".to_string());

    if let Ok(mut proj_stmt) = conn.prepare("SELECT id, name FROM projects WHERE kind IS NULL") {
        let null_projs: Vec<(String, String)> = proj_stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .collect();
        for (pid, pname) in null_projs {
            let inferred = infer_project_kind(&pname, None);
            let _ = conn.execute(
                "UPDATE projects SET kind = ?1 WHERE id = ?2",
                params![inferred, pid],
            );
        }
    }

    let money_in_this_month: f64 = conn
        .query_row(
            r#"
            SELECT ROUND(COALESCE(SUM(t.amount), 0.0), 2)
            FROM transactions t
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.type = 'income'
              AND substr(t.date, 1, 7) = ?1
              AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
            "#,
            params![current_month_prefix],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let money_out_this_month: f64 = conn
        .query_row(
            r#"
            SELECT ROUND(COALESCE(SUM(t.amount), 0.0), 2)
            FROM transactions t
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.type = 'expense'
              AND substr(t.date, 1, 7) = ?1
              AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
            "#,
            params![current_month_prefix],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let total_days = days_in_month(today.year(), today.month()) as i64;
    let elapsed_days = (today.day() as i64).max(1);
    let days_remaining_in_month = (total_days - today.day() as i64 + 1).max(1);

    let raw_left_to_spend =
        ((money_in_this_month - money_out_this_month) * 100.0).round() / 100.0;
    let left_to_spend_this_month = if raw_left_to_spend == 0.0 {
        0.0
    } else {
        raw_left_to_spend
    };

    let spendable_pool = if money_in_this_month > 0.0 {
        (money_in_this_month - money_out_this_month).min(total_balance)
    } else {
        total_balance
    };

    let daily_allowance = if spendable_pool > 0.0 {
        (spendable_pool / days_remaining_in_month as f64 * 100.0).round() / 100.0
    } else {
        0.0
    };

    // Determine "Can I Spend This?" Smart Health Status:
    // - "attention" (Red): Expenses exceed money in (when money_in > 0) or total_balance <= 0
    // - "heads_up" (Yellow): Spending faster than normal daily pace
    // - "safe" (Green): On track for the month
    let health_status = if total_balance < 0.0
        || (money_in_this_month > 0.0 && money_out_this_month > money_in_this_month)
        || (money_in_this_month == 0.0 && total_balance == 0.0 && money_out_this_month > 0.0)
    {
        "attention".to_string()
    } else {
        let baseline_pool = if money_in_this_month > 0.0 {
            money_in_this_month
        } else {
            total_balance + money_out_this_month
        };
        let expected_ratio = elapsed_days as f64 / total_days as f64;
        let actual_ratio = if baseline_pool > 0.0 {
            money_out_this_month / baseline_pool
        } else {
            0.0
        };
        if actual_ratio > (expected_ratio + 0.12) || actual_ratio > 0.85 {
            "heads_up".to_string()
        } else {
            "safe".to_string()
        }
    };

    // Top 5 Expense Categories + "Other" slice for this month
    let mut stmt = conn
        .prepare(
            r#"
            SELECT COALESCE(c.id, 'uncategorized'),
                   COALESCE(c.name, 'Uncategorized'),
                   COALESCE(c.icon, 'circle'),
                   COALESCE(c.color, '#10b981'),
                   ROUND(COALESCE(SUM(t.amount), 0.0), 2) as total
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.type = 'expense'
              AND substr(t.date, 1, 7) = ?1
              AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
            GROUP BY COALESCE(c.id, 'uncategorized'), COALESCE(c.name, 'Uncategorized'), COALESCE(c.icon, 'circle'), COALESCE(c.color, '#10b981')
            ORDER BY total DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, String, String, f64)> = stmt
        .query_map(params![current_month_prefix], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let total_cat_spend: f64 = rows.iter().map(|r| r.4).sum();
    let mut category_breakdown = Vec::new();
    let mut other_amount = 0.0;

    for (idx, (cid, name, icon, color, amt)) in rows.into_iter().enumerate() {
        if idx < 5 {
            let pct = if total_cat_spend > 0.0 {
                (amt / total_cat_spend * 1000.0).round() / 10.0
            } else {
                0.0
            };
            category_breakdown.push(CategoryBreakdown {
                category_id: cid,
                name,
                icon,
                color,
                amount: amt,
                percentage: pct,
            });
        } else {
            other_amount += amt;
        }
    }

    if other_amount > 0.0 {
        let rounded_other = (other_amount * 100.0).round() / 100.0;
        let pct = if total_cat_spend > 0.0 {
            (rounded_other / total_cat_spend * 1000.0).round() / 10.0
        } else {
            0.0
        };
        category_breakdown.push(CategoryBreakdown {
            category_id: "other".to_string(),
            name: "Other".to_string(),
            icon: "more-horizontal".to_string(),
            color: "#64748b".to_string(),
            amount: rounded_other,
            percentage: pct,
        });
    }

    // Last 6 months timeline
    let month_names = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let mut monthly_cashflow = Vec::with_capacity(6);
    for offset in (0..6).rev() {
        let mut y = today.year();
        let mut m = today.month() as i32 - offset;
        while m <= 0 {
            m += 12;
            y -= 1;
        }
        let ym = format!("{:04}-{:02}", y, m);
        let m_in: f64 = conn
            .query_row(
                r#"
                SELECT ROUND(COALESCE(SUM(t.amount), 0.0), 2)
                FROM transactions t
                LEFT JOIN projects p ON t.project_id = p.id
                WHERE t.type = 'income'
                  AND substr(t.date, 1, 7) = ?1
                  AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
                "#,
                params![ym],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let m_out: f64 = conn
            .query_row(
                r#"
                SELECT ROUND(COALESCE(SUM(t.amount), 0.0), 2)
                FROM transactions t
                LEFT JOIN projects p ON t.project_id = p.id
                WHERE t.type = 'expense'
                  AND substr(t.date, 1, 7) = ?1
                  AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
                "#,
                params![ym],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let label = month_names.get((m - 1) as usize).unwrap_or(&"").to_string();
        monthly_cashflow.push(MonthlyCashflow {
            month: ym,
            label,
            money_in: m_in,
            money_out: m_out,
        });
    }

    // Upcoming recurring reminders
    let mut rec_stmt = conn
        .prepare(
            r#"
            SELECT t.id, t.payee, t.amount, t.type, t.category_id,
                   COALESCE(c.name, 'General'),
                   COALESCE(c.icon, 'circle'),
                   COALESCE(c.color, '#10b981'),
                   COALESCE(t.recurring_interval, 'monthly'),
                   COALESCE((
                     SELECT MAX(t2.date)
                     FROM transactions t2
                     WHERE LOWER(TRIM(t2.payee)) = LOWER(TRIM(t.payee))
                       AND t2.category_id = t.category_id
                       AND t2.type = t.type
                   ), t.date) as latest_any_date
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.is_recurring = 1
            ORDER BY t.date DESC, t.created_at DESC, t.rowid DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let raw_rec_rows: Vec<(String, String, f64, String, String, String, String, String, String, String)> =
        rec_stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

    let mut seen_series = HashSet::new();
    let mut upcoming_recurring = Vec::new();
    for (
        tid,
        payee,
        amount,
        tx_type,
        category_id,
        category_name,
        category_icon,
        category_color,
        interval,
        last_date,
    ) in raw_rec_rows
    {
        let series_key = format!(
            "{}::{}::{}",
            payee.trim().to_lowercase(),
            category_id,
            tx_type
        );
        if !seen_series.insert(series_key) {
            continue;
        }
        let next_due = compute_next_due_date(&last_date, &interval, today);
        let days_until = (next_due - today).num_days();
        if days_until <= 14 {
            upcoming_recurring.push(UpcomingRecurringItem {
                transaction_id: tid,
                payee,
                amount,
                tx_type,
                category_id,
                category_name,
                category_icon,
                category_color,
                recurring_interval: interval,
                last_date,
                next_due_date: next_due.format("%Y-%m-%d").to_string(),
                days_until_due: days_until,
            });
        }
    }

    upcoming_recurring.sort_by_key(|i| i.days_until_due);

    Ok(DashboardSummary {
        total_balance,
        money_in_this_month,
        money_out_this_month,
        left_to_spend_this_month,
        daily_allowance,
        days_remaining_in_month,
        health_status,
        currency,
        category_breakdown,
        monthly_cashflow,
        upcoming_recurring,
        has_accounts: account_count > 0,
    })
}

#[tauri::command]
pub fn get_transactions(
    filter: Option<TransactionFilter>,
    state: State<'_, DbState>,
) -> Result<Vec<Transaction>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let f = filter.unwrap_or_default();

    let mut sql = String::from(
        r#"
        SELECT t.id, t.account_id, t.category_id, c.name, c.icon, c.color,
               t.project_id, p.name, t.amount, t.type, t.payee, t.date,
               t.is_recurring, t.recurring_interval, t.notes, t.created_at
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE 1 = 1
        "#,
    );

    let mut string_params: Vec<String> = Vec::new();

    if let Some(ref s) = f.search {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            let pattern = format!("%{}%", trimmed.to_lowercase());
            string_params.push(pattern);
            let idx = string_params.len();
            sql.push_str(&format!(
                " AND (LOWER(t.payee) LIKE ?{idx} OR LOWER(COALESCE(t.notes, '')) LIKE ?{idx} OR LOWER(COALESCE(c.name, '')) LIKE ?{idx})"
            ));
        }
    }

    if let Some(ref tx_type) = f.tx_type {
        if tx_type == "income" || tx_type == "expense" {
            string_params.push(tx_type.clone());
            sql.push_str(&format!(" AND t.type = ?{}", string_params.len()));
        }
    }

    if let Some(ref cid) = f.category_id {
        if !cid.is_empty() {
            string_params.push(cid.clone());
            sql.push_str(&format!(" AND t.category_id = ?{}", string_params.len()));
        }
    }

    if let Some(ref pid) = f.project_id {
        if !pid.is_empty() {
            string_params.push(pid.clone());
            sql.push_str(&format!(" AND t.project_id = ?{}", string_params.len()));
        }
    }

    if f.only_recurring == Some(true) {
        sql.push_str(" AND t.is_recurring = 1");
    }

    if f.only_projects == Some(true) {
        sql.push_str(" AND t.project_id IS NOT NULL AND t.project_id != ''");
    }

    if let Some(ref df) = f.date_from {
        if !df.is_empty() {
            string_params.push(df.clone());
            sql.push_str(&format!(" AND t.date >= ?{}", string_params.len()));
        }
    }

    if let Some(ref dt) = f.date_to {
        if !dt.is_empty() {
            string_params.push(dt.clone());
            sql.push_str(&format!(" AND t.date <= ?{}", string_params.len()));
        }
    }

    sql.push_str(" ORDER BY t.date DESC, t.created_at DESC");

    if let Some(limit) = f.limit {
        sql.push_str(&format!(" LIMIT {}", limit.max(1)));
        if let Some(offset) = f.offset {
            sql.push_str(&format!(" OFFSET {}", offset.max(0)));
        }
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = string_params
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let is_rec: i64 = row.get(12)?;
            Ok(Transaction {
                id: row.get(0)?,
                account_id: row.get(1)?,
                category_id: row.get(2)?,
                category_name: row.get(3)?,
                category_icon: row.get(4)?,
                category_color: row.get(5)?,
                project_id: row.get(6)?,
                project_name: row.get(7)?,
                amount: row.get(8)?,
                tx_type: row.get(9)?,
                payee: row.get(10)?,
                date: row.get(11)?,
                is_recurring: is_rec != 0,
                recurring_interval: row.get(13)?,
                notes: row.get(14)?,
                created_at: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn create_transaction(
    payload: NewTransaction,
    state: State<'_, DbState>,
) -> Result<Transaction, String> {
    if payload.amount <= 0.0 || !payload.amount.is_finite() {
        return Err("Transaction amount must be a positive number.".to_string());
    }
    if payload.payee.trim().is_empty() {
        return Err("Payee name is required.".to_string());
    }
    if payload.tx_type != "income" && payload.tx_type != "expense" {
        return Err("Transaction type must be 'income' or 'expense'.".to_string());
    }
    let clean_date = payload.date.trim().to_string();
    if NaiveDate::parse_from_str(&clean_date, "%Y-%m-%d").is_err() {
        return Err("Transaction date must be a valid YYYY-MM-DD date.".to_string());
    }

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let amount = (payload.amount * 100.0).round() / 100.0;
    let is_rec = if payload.is_recurring.unwrap_or(false) { 1 } else { 0 };
    let rec_interval = if is_rec == 1 {
        Some(
            payload
                .recurring_interval
                .clone()
                .unwrap_or_else(|| "monthly".to_string()),
        )
    } else {
        None
    };

    let clean_project_id = payload
        .project_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let clean_notes = payload
        .notes
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    tx.execute(
        r#"
        INSERT INTO transactions (
            id, account_id, category_id, project_id, amount, type, payee, date,
            is_recurring, recurring_interval, notes
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            id,
            payload.account_id,
            payload.category_id,
            clean_project_id,
            amount,
            payload.tx_type,
            payload.payee.trim(),
            clean_date,
            is_rec,
            rec_interval,
            clean_notes
        ],
    )
    .map_err(|e| format!("Failed to insert transaction: {}", e))?;

    let delta = if payload.tx_type == "income" {
        amount
    } else {
        -amount
    };

    let updated = tx
        .execute(
            "UPDATE accounts SET current_balance = ROUND(current_balance + ?1, 2) WHERE id = ?2",
            params![delta, payload.account_id],
        )
        .map_err(|e| format!("Failed to update account balance: {}", e))?;

    if updated == 0 {
        return Err("Target account does not exist.".to_string());
    }

    tx.commit().map_err(|e| e.to_string())?;

    let created = conn
        .query_row(
            r#"
            SELECT t.id, t.account_id, t.category_id, c.name, c.icon, c.color,
                   t.project_id, p.name, t.amount, t.type, t.payee, t.date,
                   t.is_recurring, t.recurring_interval, t.notes, t.created_at
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?1
            "#,
            params![id],
            |row| {
                let is_rec_val: i64 = row.get(12)?;
                Ok(Transaction {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    category_id: row.get(2)?,
                    category_name: row.get(3)?,
                    category_icon: row.get(4)?,
                    category_color: row.get(5)?,
                    project_id: row.get(6)?,
                    project_name: row.get(7)?,
                    amount: row.get(8)?,
                    tx_type: row.get(9)?,
                    payee: row.get(10)?,
                    date: row.get(11)?,
                    is_recurring: is_rec_val != 0,
                    recurring_interval: row.get(13)?,
                    notes: row.get(14)?,
                    created_at: row.get(15)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(created)
}

#[tauri::command]
pub fn duplicate_transaction(
    id: String,
    new_date: Option<String>,
    mark_recurring: Option<bool>,
    recurring_interval: Option<String>,
    state: State<'_, DbState>,
) -> Result<Transaction, String> {
    let source = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT account_id, category_id, project_id, amount, type, payee, date,
                   is_recurring, recurring_interval, notes
            FROM transactions WHERE id = ?1
            "#,
            params![id],
            |row| {
                let is_rec_val: i64 = row.get(7)?;
                let resolved_date = new_date
                    .clone()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| Local::now().date_naive().format("%Y-%m-%d").to_string());
                Ok(NewTransaction {
                    account_id: row.get(0)?,
                    category_id: row.get(1)?,
                    project_id: row.get(2)?,
                    amount: row.get(3)?,
                    tx_type: row.get(4)?,
                    payee: row.get(5)?,
                    date: resolved_date,
                    is_recurring: Some(mark_recurring.unwrap_or(is_rec_val != 0)),
                    recurring_interval: recurring_interval
                        .clone()
                        .or_else(|| row.get(8).ok().flatten()),
                    notes: row.get(9)?,
                })
            },
        )
        .map_err(|_| "Original transaction not found.".to_string())?
    };

    create_transaction(source, state)
}

#[tauri::command]
pub fn update_transaction(
    payload: UpdateTransaction,
    state: State<'_, DbState>,
) -> Result<Transaction, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (
        old_account_id,
        old_category_id,
        old_project_id,
        old_amount,
        old_type,
        old_payee,
        old_date,
        old_is_rec,
        old_rec_int,
        old_notes,
    ): (
        String,
        String,
        Option<String>,
        f64,
        String,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
    ) = tx
        .query_row(
            r#"
            SELECT account_id, category_id, project_id, amount, type, payee, date,
                   is_recurring, recurring_interval, notes
            FROM transactions WHERE id = ?1
            "#,
            params![payload.id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                ))
            },
        )
        .map_err(|_| "Transaction not found.".to_string())?;

    let new_account_id = payload.account_id.unwrap_or_else(|| old_account_id.clone());
    let new_category_id = payload.category_id.unwrap_or(old_category_id);
    let new_project_id = if payload.clear_project_id == Some(true) {
        None
    } else {
        payload
            .project_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or(old_project_id)
    };
    let raw_amount = payload.amount.unwrap_or(old_amount);
    if raw_amount <= 0.0 || !raw_amount.is_finite() {
        return Err("Transaction amount must be positive.".to_string());
    }
    let new_amount = (raw_amount * 100.0).round() / 100.0;
    let new_type = payload.tx_type.unwrap_or_else(|| old_type.clone());
    if new_type != "income" && new_type != "expense" {
        return Err("Invalid transaction type.".to_string());
    }
    let new_payee = payload.payee.map(|p| p.trim().to_string()).unwrap_or(old_payee);
    if new_payee.is_empty() {
        return Err("Payee cannot be empty.".to_string());
    }
    let new_date = payload
        .date
        .map(|d| d.trim().to_string())
        .unwrap_or(old_date);
    if NaiveDate::parse_from_str(&new_date, "%Y-%m-%d").is_err() {
        return Err("Transaction date must be a valid YYYY-MM-DD date.".to_string());
    }
    let new_is_rec = payload
        .is_recurring
        .map(|b| if b { 1 } else { 0 })
        .unwrap_or(old_is_rec);
    let new_rec_int = if new_is_rec == 1 {
        payload
            .recurring_interval
            .or(old_rec_int)
            .or_else(|| Some("monthly".to_string()))
    } else {
        None
    };
    let new_notes = match payload.notes {
        Some(opt) => opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        None => old_notes,
    };

    // Revert old balance impact
    let old_delta = if old_type == "income" {
        old_amount
    } else {
        -old_amount
    };
    let reverted = tx
        .execute(
            "UPDATE accounts SET current_balance = ROUND(current_balance - ?1, 2) WHERE id = ?2",
            params![old_delta, old_account_id],
        )
        .map_err(|e| e.to_string())?;
    if reverted == 0 {
        return Err("Original account not found.".to_string());
    }

    // Apply new balance impact
    let new_delta = if new_type == "income" {
        new_amount
    } else {
        -new_amount
    };
    let applied = tx
        .execute(
            "UPDATE accounts SET current_balance = ROUND(current_balance + ?1, 2) WHERE id = ?2",
            params![new_delta, new_account_id],
        )
        .map_err(|e| e.to_string())?;
    if applied == 0 {
        return Err("Target account does not exist.".to_string());
    }

    tx.execute(
        r#"
        UPDATE transactions
        SET account_id = ?1, category_id = ?2, project_id = ?3, amount = ?4,
            type = ?5, payee = ?6, date = ?7, is_recurring = ?8,
            recurring_interval = ?9, notes = ?10
        WHERE id = ?11
        "#,
        params![
            new_account_id,
            new_category_id,
            new_project_id,
            new_amount,
            new_type,
            new_payee,
            new_date,
            new_is_rec,
            new_rec_int,
            new_notes,
            payload.id
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let updated = conn
        .query_row(
            r#"
            SELECT t.id, t.account_id, t.category_id, c.name, c.icon, c.color,
                   t.project_id, p.name, t.amount, t.type, t.payee, t.date,
                   t.is_recurring, t.recurring_interval, t.notes, t.created_at
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?1
            "#,
            params![payload.id],
            |row| {
                let is_rec_val: i64 = row.get(12)?;
                Ok(Transaction {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    category_id: row.get(2)?,
                    category_name: row.get(3)?,
                    category_icon: row.get(4)?,
                    category_color: row.get(5)?,
                    project_id: row.get(6)?,
                    project_name: row.get(7)?,
                    amount: row.get(8)?,
                    tx_type: row.get(9)?,
                    payee: row.get(10)?,
                    date: row.get(11)?,
                    is_recurring: is_rec_val != 0,
                    recurring_interval: row.get(13)?,
                    notes: row.get(14)?,
                    created_at: row.get(15)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub fn delete_transaction(id: String, state: State<'_, DbState>) -> Result<bool, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (account_id, amount, tx_type): (String, f64, String) = tx
        .query_row(
            "SELECT account_id, amount, type FROM transactions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Transaction not found.".to_string())?;

    let delta = if tx_type == "income" { amount } else { -amount };
    tx.execute(
        "UPDATE accounts SET current_balance = ROUND(current_balance - ?1, 2) WHERE id = ?2",
        params![delta, account_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM transactions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_accounts(state: State<'_, DbState>) -> Result<Vec<Account>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Account {
                id: r.get(0)?,
                name: r.get(1)?,
                starting_balance: r.get(2)?,
                current_balance: r.get(3)?,
                currency: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_account(payload: NewAccount, state: State<'_, DbState>) -> Result<Account, String> {
    if payload.name.trim().is_empty() {
        return Err("Account name is required.".to_string());
    }
    let bal = ((payload.starting_balance) * 100.0).round() / 100.0;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO accounts (id, name, starting_balance, current_balance, currency) VALUES (?1, ?2, ?3, ?3, ?4)",
        params![id, payload.name.trim(), bal, payload.currency.trim()],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts WHERE id = ?1",
        params![id],
        |r| {
            Ok(Account {
                id: r.get(0)?,
                name: r.get(1)?,
                starting_balance: r.get(2)?,
                current_balance: r.get(3)?,
                currency: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_account(
    payload: UpdateAccount,
    state: State<'_, DbState>,
) -> Result<Account, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if let Some(ref name) = payload.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Account name is required.".to_string());
        }
        conn.execute(
            "UPDATE accounts SET name = ?1 WHERE id = ?2",
            params![trimmed, payload.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref currency) = payload.currency {
        let trimmed = currency.trim();
        if trimmed.is_empty() {
            return Err("Currency is required.".to_string());
        }
        conn.execute(
            "UPDATE accounts SET currency = ?1 WHERE id = ?2",
            params![trimmed, payload.id],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.query_row(
        "SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts WHERE id = ?1",
        params![payload.id],
        |r| {
            Ok(Account {
                id: r.get(0)?,
                name: r.get(1)?,
                starting_balance: r.get(2)?,
                current_balance: r.get(3)?,
                currency: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )
    .map_err(|_| "Account not found.".to_string())
}

#[tauri::command]
pub fn complete_onboarding(
    payload: OnboardingPayload,
    state: State<'_, DbState>,
) -> Result<Account, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let account_id = Uuid::new_v4().to_string();
    let acc_name = if payload.account_name.trim().is_empty() {
        "Main Pocket".to_string()
    } else {
        payload.account_name.trim().to_string()
    };
    let bal = (payload.starting_balance * 100.0).round() / 100.0;

    tx.execute(
        "INSERT INTO accounts (id, name, starting_balance, current_balance, currency) VALUES (?1, ?2, ?3, ?3, ?4)",
        params![account_id, acc_name, bal, payload.currency],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('currency', ?1)",
        params![payload.currency],
    )
    .map_err(|e| e.to_string())?;

    if let Some(ref lang) = payload.language {
        tx.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', ?1)",
            params![lang],
        )
        .map_err(|e| e.to_string())?;
    }

    for cat in payload.categories {
        let cid = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO categories (id, name, type, icon, color, monthly_budget) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                cid,
                cat.name.trim(),
                cat.category_type,
                cat.icon,
                cat.color.unwrap_or_else(|| "#10b981".to_string()),
                cat.monthly_budget
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts WHERE id = ?1",
        params![account_id],
        |r| {
            Ok(Account {
                id: r.get(0)?,
                name: r.get(1)?,
                starting_balance: r.get(2)?,
                current_balance: r.get(3)?,
                currency: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_categories(state: State<'_, DbState>) -> Result<Vec<Category>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, type, icon, COALESCE(color, '#10b981'), monthly_budget FROM categories ORDER BY type ASC, name ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                category_type: r.get(2)?,
                icon: r.get(3)?,
                color: r.get(4)?,
                monthly_budget: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_category(
    payload: NewCategory,
    state: State<'_, DbState>,
) -> Result<Category, String> {
    if payload.name.trim().is_empty() {
        return Err("Category name is required.".to_string());
    }
    if payload.category_type != "income" && payload.category_type != "expense" {
        return Err("Category type must be 'income' or 'expense'.".to_string());
    }
    if let Some(b) = payload.monthly_budget {
        if b < 0.0 || !b.is_finite() {
            return Err("Monthly budget must be zero or positive.".to_string());
        }
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let color = payload.color.unwrap_or_else(|| "#10b981".to_string());
    let budget = payload.monthly_budget.map(|b| (b * 100.0).round() / 100.0);
    conn.execute(
        "INSERT INTO categories (id, name, type, icon, color, monthly_budget) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, payload.name.trim(), payload.category_type, payload.icon, color, budget],
    )
    .map_err(|e| e.to_string())?;

    Ok(Category {
        id,
        name: payload.name.trim().to_string(),
        category_type: payload.category_type,
        icon: payload.icon,
        color,
        monthly_budget: budget,
    })
}

#[tauri::command]
pub fn update_category(
    payload: UpdateCategory,
    state: State<'_, DbState>,
) -> Result<Category, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let existing: Category = conn
        .query_row(
            "SELECT id, name, type, icon, COALESCE(color, '#10b981'), monthly_budget FROM categories WHERE id = ?1",
            params![payload.id],
            |r| {
                Ok(Category {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    category_type: r.get(2)?,
                    icon: r.get(3)?,
                    color: r.get(4)?,
                    monthly_budget: r.get(5)?,
                })
            },
        )
        .map_err(|_| "Category not found.".to_string())?;

    let name = payload.name.map(|s| s.trim().to_string()).unwrap_or(existing.name);
    if name.is_empty() {
        return Err("Category name is required.".to_string());
    }
    let icon = payload.icon.unwrap_or(existing.icon);
    let color = payload.color.unwrap_or(existing.color);
    let monthly_budget = match payload.monthly_budget {
        Some(Some(b)) => {
            if b < 0.0 || !b.is_finite() {
                return Err("Monthly budget must be zero or positive.".to_string());
            }
            Some((b * 100.0).round() / 100.0)
        }
        Some(None) => None,
        None => existing.monthly_budget,
    };

    conn.execute(
        "UPDATE categories SET name = ?1, icon = ?2, color = ?3, monthly_budget = ?4 WHERE id = ?5",
        params![name, icon, color, monthly_budget, payload.id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Category {
        id: payload.id,
        name,
        category_type: existing.category_type,
        icon,
        color,
        monthly_budget,
    })
}

#[tauri::command]
pub fn delete_category(id: String, state: State<'_, DbState>) -> Result<bool, String> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Err("Category ID is required.".to_string());
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories WHERE id = ?1", params![clean_id])
        .map_err(|e| e.to_string())?;
    Ok(true)
}

fn infer_project_kind(name: &str, explicit_kind: Option<&str>) -> String {
    if let Some(k) = explicit_kind {
        let trimmed = k.trim();
        if trimmed == "month" || trimmed == "project" {
            return trimmed.to_string();
        }
    }
    let lower = name.trim().to_lowercase();
    if lower.is_empty() {
        return "project".to_string();
    }

    // 1. Explicit month prefixes ("mois", "month", "شهر") followed by end or separator/digit
    for prefix in ["mois", "month", "شهر"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            if rest.is_empty()
                || rest.starts_with(|c: char| {
                    c.is_whitespace()
                        || c.is_ascii_digit()
                        || matches!(c, '-' | '_' | '.' | '/' | ':' | '#')
                })
            {
                return "month".to_string();
            }
        }
    }

    // 2. Numeric YYYY-MM, YYYY/MM, MM-YYYY, MM/YYYY
    let parts: Vec<&str> = lower.split(['-', '/']).collect();
    if parts.len() == 2 {
        let p0 = parts[0].trim();
        let p1 = parts[1].trim();
        let is_yyyy_mm = p0.len() == 4
            && p0.chars().all(|c| c.is_ascii_digit())
            && p1.parse::<u32>().map(|m| (1..=12).contains(&m)).unwrap_or(false);
        let is_mm_yyyy = p1.len() == 4
            && p1.chars().all(|c| c.is_ascii_digit())
            && p0.parse::<u32>().map(|m| (1..=12).contains(&m)).unwrap_or(false);
        if is_yyyy_mm || is_mm_yyyy {
            return "month".to_string();
        }
    }

    // 3. Standalone month name or month name followed by year/number or another month name
    let month_names = [
        "janvier",
        "février",
        "fevrier",
        "mars",
        "avril",
        "mai",
        "juin",
        "juillet",
        "août",
        "aout",
        "septembre",
        "octobre",
        "novembre",
        "décembre",
        "decembre",
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
        "يناير",
        "فبراير",
        "مارس",
        "أبريل",
        "ابريل",
        "مايو",
        "يونيو",
        "يوليو",
        "أغسطس",
        "اغسطس",
        "سبتمبر",
        "أكتوبر",
        "اكتوبر",
        "نوفمبر",
        "ديسمبر",
    ];
    for m in month_names {
        if let Some(rest) = lower.strip_prefix(m) {
            if rest.is_empty() {
                return "month".to_string();
            }
            if rest.starts_with(|c: char| {
                c.is_whitespace() || matches!(c, ',' | '.' | '_' | '/' | '-')
            }) {
                let tail = rest.trim_start_matches(|c: char| {
                    c.is_whitespace() || matches!(c, ',' | '.' | '_' | '/' | '-')
                });
                if !tail.is_empty()
                    && ((tail.len() <= 4 && tail.chars().all(|c| c.is_ascii_digit()))
                        || month_names.contains(&tail))
                {
                    return "month".to_string();
                }
            }
        }
    }

    "project".to_string()
}

#[tauri::command]
pub fn get_projects(state: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT p.id, p.name, p.target_budget, p.status, p.kind, p.created_at,
                   ROUND(COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0.0 END), 0.0), 2) as spent_amount,
                   ROUND(COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0.0 END), 0.0), 2) as income_amount,
                   COUNT(t.id) as tx_count
            FROM projects p
            LEFT JOIN transactions t ON t.project_id = p.id
            GROUP BY p.id, p.name, p.target_budget, p.status, p.kind, p.created_at
            ORDER BY p.created_at DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            let name: String = r.get(1)?;
            let raw_kind: Option<String> = r.get(4)?;
            let resolved_kind = infer_project_kind(&name, raw_kind.as_deref());
            Ok(Project {
                id: r.get(0)?,
                name,
                target_budget: r.get(2)?,
                status: r.get(3)?,
                kind: Some(resolved_kind),
                created_at: r.get(5)?,
                spent_amount: r.get(6)?,
                income_amount: r.get(7)?,
                transaction_count: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_project(payload: NewProject, state: State<'_, DbState>) -> Result<Project, String> {
    if payload.name.trim().is_empty() {
        return Err("Project name is required.".to_string());
    }
    if payload.target_budget < 0.0 || !payload.target_budget.is_finite() {
        return Err("Target budget must be zero or positive.".to_string());
    }
    let status = payload.status.unwrap_or_else(|| "active".to_string());
    if status != "active" && status != "completed" && status != "paused" {
        return Err("Invalid project status.".to_string());
    }
    let kind = infer_project_kind(payload.name.trim(), payload.kind.as_deref());

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let target_budget = (payload.target_budget * 100.0).round() / 100.0;
    conn.execute(
        "INSERT INTO projects (id, name, target_budget, status, kind) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, payload.name.trim(), target_budget, status, kind],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, target_budget, status, kind, created_at FROM projects WHERE id = ?1",
        params![id],
        |r| {
            let name: String = r.get(1)?;
            let raw_kind: Option<String> = r.get(4)?;
            Ok(Project {
                id: r.get(0)?,
                name: name.clone(),
                target_budget: r.get(2)?,
                status: r.get(3)?,
                kind: Some(infer_project_kind(&name, raw_kind.as_deref())),
                created_at: r.get(5)?,
                spent_amount: 0.0,
                income_amount: 0.0,
                transaction_count: 0,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(
    payload: UpdateProject,
    state: State<'_, DbState>,
) -> Result<Project, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let (old_name, old_budget, old_status, old_kind): (String, f64, String, Option<String>) = conn
        .query_row(
            "SELECT name, target_budget, status, kind FROM projects WHERE id = ?1",
            params![payload.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "Project not found.".to_string())?;

    let new_name = payload.name.map(|s| s.trim().to_string()).unwrap_or(old_name);
    if new_name.is_empty() {
        return Err("Project name is required.".to_string());
    }
    let raw_budget = payload.target_budget.unwrap_or(old_budget);
    if raw_budget < 0.0 || !raw_budget.is_finite() {
        return Err("Target budget must be zero or positive.".to_string());
    }
    let new_budget = (raw_budget * 100.0).round() / 100.0;
    let new_status = payload.status.unwrap_or(old_status);
    if new_status != "active" && new_status != "completed" && new_status != "paused" {
        return Err("Invalid project status.".to_string());
    }
    let new_kind = infer_project_kind(
        &new_name,
        payload.kind.as_deref().or(old_kind.as_deref()),
    );

    conn.execute(
        "UPDATE projects SET name = ?1, target_budget = ?2, status = ?3, kind = ?4 WHERE id = ?5",
        params![new_name, new_budget, new_status, new_kind, payload.id],
    )
    .map_err(|e| e.to_string())?;

    drop(conn);
    let projects = get_projects(state)?;
    projects
        .into_iter()
        .find(|p| p.id == payload.id)
        .ok_or_else(|| "Updated project not found.".to_string())
}

#[tauri::command]
pub fn delete_project(id: String, state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE transactions SET project_id = NULL WHERE project_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn export_backup_db(target_path: String, state: State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let dest = Path::new(&target_path);
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    let escaped = target_path.replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
        .map_err(|e| format!("Failed to export SQLite backup: {}", e))?;
    Ok(target_path)
}

#[tauri::command]
pub fn import_backup_db(source_path: String, state: State<'_, DbState>) -> Result<bool, String> {
    let src = Path::new(&source_path);
    validate_sqlite_backup(src)?;

    let mut conn_guard = state.conn.lock().map_err(|e| e.to_string())?;
    let db_path = state.db_path.clone();

    // Checkpoint and replace database file safely
    let _ = conn_guard.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    fs::copy(src, &db_path).map_err(|e| format!("Failed to copy backup database: {}", e))?;
    let new_conn =
        init_database(&db_path).map_err(|e| format!("Failed to re-open restored database: {}", e))?;
    *conn_guard = new_conn;
    Ok(true)
}

#[tauri::command]
pub fn verify_or_set_pin(pin: String, state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let existing_hash: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'pin_hash'",
            [],
            |r| r.get(0),
        )
        .ok()
        .filter(|s: &String| !s.is_empty());

    match existing_hash {
        Some(hash) => verify_pin_argon2id(&pin, &hash),
        None => {
            let new_hash = hash_pin_argon2id(&pin)?;
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pin_hash', ?1)",
                params![new_hash],
            )
            .map_err(|e| e.to_string())?;
            Ok(true)
        }
    }
}

#[tauri::command]
pub fn disable_pin(current_pin: String, state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let existing_hash: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'pin_hash'",
            [],
            |r| r.get(0),
        )
        .ok()
        .filter(|s: &String| !s.is_empty());

    if let Some(hash) = existing_hash {
        if !verify_pin_argon2id(&current_pin, &hash)? {
            return Ok(false);
        }
        conn.execute("DELETE FROM app_settings WHERE key = 'pin_hash'", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub fn check_auth_state(state: State<'_, DbState>) -> Result<AuthState, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let has_pin = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'pin_hash'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    let auto_lock_minutes = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'auto_lock_minutes'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(15);

    Ok(AuthState {
        has_pin,
        auto_lock_minutes,
    })
}

#[tauri::command]
pub fn get_settings(state: State<'_, DbState>) -> Result<AppSettingsMap, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings WHERE key != 'pin_hash'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    for r in rows {
        let (k, v) = r.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
}

#[tauri::command]
pub fn update_setting(key: String, value: String, state: State<'_, DbState>) -> Result<bool, String> {
    if key == "pin_hash" {
        return Err("Use verify_or_set_pin to manage PIN hashes.".to_string());
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}
