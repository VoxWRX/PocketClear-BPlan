//! Serde Data Transfer Objects (DTOs) and Domain Models for PocketClear IPC Commands.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub starting_balance: f64,
    pub current_balance: f64,
    pub currency: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewAccount {
    pub name: String,
    pub starting_balance: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAccount {
    pub id: String,
    pub name: Option<String>,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub category_type: String, // "income" | "expense"
    pub icon: String,
    pub color: String,
    pub monthly_budget: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewCategory {
    pub name: String,
    #[serde(rename = "type")]
    pub category_type: String,
    pub icon: String,
    pub color: Option<String>,
    pub monthly_budget: Option<f64>,
}

fn deserialize_double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCategory {
    pub id: String,
    pub name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub monthly_budget: Option<Option<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub target_budget: f64,
    pub status: String, // "active" | "completed" | "paused"
    pub kind: Option<String>, // "month" | "project"
    pub created_at: String,
    pub spent_amount: f64,
    pub income_amount: f64,
    pub transaction_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewProject {
    pub name: String,
    pub target_budget: f64,
    pub status: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProject {
    pub id: String,
    pub name: Option<String>,
    pub target_budget: Option<f64>,
    pub status: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub account_id: String,
    pub category_id: String,
    pub category_name: Option<String>,
    pub category_icon: Option<String>,
    pub category_color: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub amount: f64,
    #[serde(rename = "type")]
    pub tx_type: String, // "income" | "expense"
    pub payee: String,
    pub date: String, // YYYY-MM-DD
    pub is_recurring: bool,
    pub recurring_interval: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransactionFilter {
    pub search: Option<String>,
    #[serde(rename = "type")]
    pub tx_type: Option<String>,
    pub category_id: Option<String>,
    pub project_id: Option<String>,
    pub only_recurring: Option<bool>,
    pub only_projects: Option<bool>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTransaction {
    pub account_id: String,
    pub category_id: String,
    pub project_id: Option<String>,
    pub amount: f64,
    #[serde(rename = "type")]
    pub tx_type: String,
    pub payee: String,
    pub date: String,
    pub is_recurring: Option<bool>,
    pub recurring_interval: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTransaction {
    pub id: String,
    pub account_id: Option<String>,
    pub category_id: Option<String>,
    pub project_id: Option<String>,
    pub clear_project_id: Option<bool>,
    pub amount: Option<f64>,
    #[serde(rename = "type")]
    pub tx_type: Option<String>,
    pub payee: Option<String>,
    pub date: Option<String>,
    pub is_recurring: Option<bool>,
    pub recurring_interval: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryBreakdown {
    pub category_id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub amount: f64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyCashflow {
    pub month: String,      // YYYY-MM
    pub label: String,      // e.g. "Oct"
    pub money_in: f64,
    pub money_out: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpcomingRecurringItem {
    pub transaction_id: String,
    pub payee: String,
    pub amount: f64,
    #[serde(rename = "type")]
    pub tx_type: String,
    pub category_id: String,
    pub category_name: String,
    pub category_icon: String,
    pub category_color: String,
    pub recurring_interval: String,
    pub last_date: String,
    pub next_due_date: String,
    pub days_until_due: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummary {
    pub total_balance: f64,
    pub money_in_this_month: f64,
    pub money_out_this_month: f64,
    pub left_to_spend_this_month: f64,
    pub daily_allowance: f64,
    pub days_remaining_in_month: i64,
    pub health_status: String, // "safe" | "heads_up" | "attention"
    pub currency: String,
    pub category_breakdown: Vec<CategoryBreakdown>,
    pub monthly_cashflow: Vec<MonthlyCashflow>,
    pub upcoming_recurring: Vec<UpcomingRecurringItem>,
    pub has_accounts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthState {
    pub has_pin: bool,
    pub auto_lock_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingPayload {
    pub account_name: String,
    pub starting_balance: f64,
    pub currency: String,
    pub language: Option<String>,
    pub categories: Vec<NewCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvImportResult {
    pub imported_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
}

pub type AppSettingsMap = HashMap<String, String>;
