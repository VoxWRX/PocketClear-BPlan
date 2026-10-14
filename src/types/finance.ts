/**
 * @file finance.ts
 * @description Core domain TypeScript interfaces and type unions for PocketClear.
 * Mirrors the Rust Serde structs in `src-tauri/src/models.rs` and the SQLite schema
 * in `src-tauri/src/db.rs`.
 */
export type LanguageCode = 'en' | 'fr' | 'ar';
export type CurrencyCode = 'USD' | 'EUR' | 'MAD' | 'GBP';
export type TransactionType = 'income' | 'expense';
export type ProjectStatus = 'active' | 'completed' | 'paused';
export type ProjectKind = 'month' | 'project';
export type RecurringInterval = 'weekly' | 'monthly' | 'yearly';
export type HealthStatus = 'safe' | 'heads_up' | 'attention';
export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentPalette = 'emerald' | 'blue';
export type DecimalSeparator = '.' | ',';
export type DateFormatOption = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

export interface Account {
  id: string;
  name: string;
  starting_balance: number;
  current_balance: number;
  currency: CurrencyCode | string;
  created_at: string;
}

export interface NewAccount {
  name: string;
  starting_balance: number;
  currency: CurrencyCode | string;
}

export interface UpdateAccount {
  id: string;
  name?: string;
  currency?: CurrencyCode | string;
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
  monthly_budget: number | null;
}

export interface NewCategory {
  name: string;
  type: TransactionType;
  icon: string;
  color?: string;
  monthly_budget?: number | null;
}

export interface UpdateCategory {
  id: string;
  name?: string;
  icon?: string;
  color?: string;
  monthly_budget?: number | null;
}

export interface Project {
  id: string;
  name: string;
  target_budget: number;
  status: ProjectStatus;
  kind?: ProjectKind;
  created_at: string;
  spent_amount: number;
  income_amount: number;
  transaction_count: number;
}

export interface NewProject {
  name: string;
  target_budget: number;
  status?: ProjectStatus;
  kind?: ProjectKind;
}

export interface UpdateProject {
  id: string;
  name?: string;
  target_budget?: number;
  status?: ProjectStatus;
  kind?: ProjectKind;
}

export interface Transaction {
  id: string;
  account_id: string;
  category_id: string;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  project_id: string | null;
  project_name?: string | null;
  amount: number;
  type: TransactionType;
  payee: string;
  date: string; // YYYY-MM-DD
  is_recurring: boolean;
  recurring_interval: RecurringInterval | null;
  notes: string | null;
  created_at: string;
}

export interface TransactionFilter {
  search?: string;
  type?: TransactionType;
  category_id?: string;
  project_id?: string;
  only_recurring?: boolean;
  only_projects?: boolean;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export interface NewTransaction {
  account_id: string;
  category_id: string;
  project_id?: string | null;
  amount: number;
  type: TransactionType;
  payee: string;
  date: string; // YYYY-MM-DD
  is_recurring?: boolean;
  recurring_interval?: RecurringInterval | null;
  notes?: string | null;
}

export interface UpdateTransaction {
  id: string;
  account_id?: string;
  category_id?: string;
  project_id?: string | null;
  clear_project_id?: boolean;
  amount?: number;
  type?: TransactionType;
  payee?: string;
  date?: string;
  is_recurring?: boolean;
  recurring_interval?: RecurringInterval | null;
  notes?: string | null;
}

export interface CategoryBreakdown {
  category_id: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
}

export interface MonthlyCashflow {
  month: string; // YYYY-MM
  label: string;
  money_in: number;
  money_out: number;
}

export interface UpcomingRecurringItem {
  transaction_id: string;
  payee: string;
  amount: number;
  type: TransactionType;
  category_id: string;
  category_name: string;
  category_icon: string;
  category_color: string;
  recurring_interval: RecurringInterval;
  last_date: string;
  next_due_date: string;
  days_until_due: number;
}

export interface DashboardSummary {
  total_balance: number;
  money_in_this_month: number;
  money_out_this_month: number;
  left_to_spend_this_month: number;
  daily_allowance: number;
  days_remaining_in_month: number;
  health_status: HealthStatus;
  currency: string;
  category_breakdown: CategoryBreakdown[];
  monthly_cashflow: MonthlyCashflow[];
  upcoming_recurring: UpcomingRecurringItem[];
  has_accounts: boolean;
}

export interface AuthState {
  has_pin: boolean;
  auto_lock_minutes: number;
}

export interface OnboardingPayload {
  account_name: string;
  starting_balance: number;
  currency: CurrencyCode | string;
  language?: LanguageCode;
  categories: NewCategory[];
}

export interface CsvPreviewRow {
  date: string;
  payee: string;
  amount: number;
  type: TransactionType;
  category: string;
  project?: string;
  is_recurring?: boolean;
  recurring_interval?: RecurringInterval | null;
  notes?: string;
  valid: boolean;
  error?: string;
}

export interface CsvImportResult {
  imported_count: number;
  skipped_count: number;
  errors: string[];
}

export interface AppSettings {
  currency: CurrencyCode | string;
  language: LanguageCode;
  theme: ThemeMode;
  accent: AccentPalette;
  decimal_separator: DecimalSeparator;
  date_format: DateFormatOption;
  auto_lock_minutes: number;
}
