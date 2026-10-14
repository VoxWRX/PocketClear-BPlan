/**
 * @file ipc.ts
 * @description Unified IPC client bridge for PocketClear.
 * Routes all frontend data operations through Zod validation before dispatching either to:
 * 1. The native Tauri v2 Rust SQLite backend (`@tauri-apps/api/core` `invoke`) in desktop runtime, or
 * 2. The local fallback/test adapter (`BrowserLocalEngine` or `SqliteNodeEngine`).
 */
import {
  Account,
  AuthState,
  Category,
  CsvImportResult,
  DashboardSummary,
  NewAccount,
  NewCategory,
  NewProject,
  NewTransaction,
  OnboardingPayload,
  Project,
  RecurringInterval,
  Transaction,
  TransactionFilter,
  UpdateAccount,
  UpdateCategory,
  UpdateProject,
  UpdateTransaction,
} from '@/types/finance';
import { BrowserLocalEngine, FinanceEngineAdapter } from '@/lib/local-engine';
import { parseAndPreviewCsv, serializeTransactionsToCsv } from '@/lib/csv';
import {
  duplicateTransactionSchema,
  newAccountSchema,
  newCategorySchema,
  newProjectSchema,
  newTransactionSchema,
  onboardingPayloadSchema,
  parseWithSchema,
  pinSchema,
  settingUpdateSchema,
  transactionFilterSchema,
  updateAccountSchema,
  updateCategorySchema,
  updateProjectSchema,
  updateTransactionSchema,
} from '@/lib/schemas';

let customEngineAdapter: FinanceEngineAdapter | null = null;
let defaultBrowserEngine: BrowserLocalEngine | null = null;

export function setEngineAdapter(adapter: FinanceEngineAdapter | null): void {
  customEngineAdapter = adapter;
}

export function getEngineAdapter(): FinanceEngineAdapter {
  if (customEngineAdapter) return customEngineAdapter;
  if (!defaultBrowserEngine) {
    defaultBrowserEngine = new BrowserLocalEngine();
  }
  return defaultBrowserEngine;
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const ipc = {
  async getDashboardSummary(referenceDate?: string): Promise<DashboardSummary> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<DashboardSummary>('get_dashboard_summary', {
        referenceDate: referenceDate ?? null,
      });
    }
    return await getEngineAdapter().getDashboardSummary(referenceDate);
  },

  async getTransactions(filter?: TransactionFilter): Promise<Transaction[]> {
    const validatedFilter = filter
      ? parseWithSchema(transactionFilterSchema, filter)
      : undefined;
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Transaction[]>('get_transactions', {
        filter: validatedFilter ?? {},
      });
    }
    return await getEngineAdapter().getTransactions(validatedFilter);
  },

  async createTransaction(payload: NewTransaction): Promise<Transaction> {
    const validated = parseWithSchema(newTransactionSchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Transaction>('create_transaction', { payload: validated });
    }
    return await getEngineAdapter().createTransaction(validated);
  },

  async duplicateTransaction(
    id: string,
    newDate?: string | null,
    markRecurring?: boolean,
    recurringInterval?: RecurringInterval | null
  ): Promise<Transaction> {
    const validated = parseWithSchema(duplicateTransactionSchema, {
      id,
      newDate,
      markRecurring,
      recurringInterval,
    });
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Transaction>('duplicate_transaction', {
        id: validated.id,
        newDate: validated.newDate ?? null,
        markRecurring: validated.markRecurring ?? null,
        recurringInterval: validated.recurringInterval ?? null,
      });
    }
    return await getEngineAdapter().duplicateTransaction(
      validated.id,
      validated.newDate,
      validated.markRecurring,
      validated.recurringInterval
    );
  },

  async updateTransaction(payload: UpdateTransaction): Promise<Transaction> {
    const validated = parseWithSchema(updateTransactionSchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Transaction>('update_transaction', { payload: validated });
    }
    return await getEngineAdapter().updateTransaction(validated);
  },

  async deleteTransaction(id: string): Promise<boolean> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<boolean>('delete_transaction', { id });
    }
    return await getEngineAdapter().deleteTransaction(id);
  },

  async getAccounts(): Promise<Account[]> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Account[]>('get_accounts');
    }
    return await getEngineAdapter().getAccounts();
  },

  async createAccount(payload: NewAccount): Promise<Account> {
    const validated = parseWithSchema(newAccountSchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Account>('create_account', { payload: validated });
    }
    return await getEngineAdapter().createAccount(validated);
  },

  async updateAccount(payload: UpdateAccount): Promise<Account> {
    const validated = parseWithSchema(updateAccountSchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Account>('update_account', { payload: validated });
    }
    return await getEngineAdapter().updateAccount(validated);
  },

  async completeOnboarding(payload: OnboardingPayload): Promise<Account> {
    const validated = parseWithSchema(onboardingPayloadSchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Account>('complete_onboarding', { payload: validated });
    }
    return await getEngineAdapter().completeOnboarding(validated);
  },

  async getCategories(): Promise<Category[]> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Category[]>('get_categories');
    }
    return await getEngineAdapter().getCategories();
  },

  async createCategory(payload: NewCategory): Promise<Category> {
    const validated = parseWithSchema(newCategorySchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Category>('create_category', { payload: validated });
    }
    return await getEngineAdapter().createCategory(validated);
  },

  async updateCategory(payload: UpdateCategory): Promise<Category> {
    const validated = parseWithSchema(updateCategorySchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Category>('update_category', { payload: validated });
    }
    return await getEngineAdapter().updateCategory(validated);
  },

  async deleteCategory(id: string): Promise<boolean> {
    const cleanId = String(id ?? '').trim();
    if (!cleanId) {
      throw new Error('Category ID is required.');
    }
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<boolean>('delete_category', { id: cleanId });
    }
    return await getEngineAdapter().deleteCategory(cleanId);
  },

  async getProjects(): Promise<Project[]> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Project[]>('get_projects');
    }
    return await getEngineAdapter().getProjects();
  },

  async createProject(payload: NewProject): Promise<Project> {
    const validated = parseWithSchema(newProjectSchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Project>('create_project', { payload: validated });
    }
    return await getEngineAdapter().createProject(validated);
  },

  async updateProject(payload: UpdateProject): Promise<Project> {
    const validated = parseWithSchema(updateProjectSchema, payload);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Project>('update_project', { payload: validated });
    }
    return await getEngineAdapter().updateProject(validated);
  },

  async deleteProject(id: string): Promise<boolean> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<boolean>('delete_project', { id });
    }
    return await getEngineAdapter().deleteProject(id);
  },

  async exportBackupDb(targetPath: string): Promise<string> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<string>('export_backup_db', { targetPath });
    }
    return await getEngineAdapter().exportBackupDb(targetPath);
  },

  async importBackupDb(sourcePath: string): Promise<boolean> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<boolean>('import_backup_db', { sourcePath });
    }
    return await getEngineAdapter().importBackupDb(sourcePath);
  },

  async verifyOrSetPin(pin: string): Promise<boolean> {
    const validatedPin = parseWithSchema(pinSchema, pin);
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<boolean>('verify_or_set_pin', { pin: validatedPin });
    }
    return await getEngineAdapter().verifyOrSetPin(validatedPin);
  },

  async disablePin(currentPin: string): Promise<boolean> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<boolean>('disable_pin', { currentPin });
    }
    return await getEngineAdapter().disablePin(currentPin);
  },

  async checkAuthState(): Promise<AuthState> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<AuthState>('check_auth_state');
    }
    return await getEngineAdapter().checkAuthState();
  },

  async getSettings(): Promise<Record<string, string>> {
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<Record<string, string>>('get_settings');
    }
    return await getEngineAdapter().getSettings();
  },

  async updateSetting(key: string, value: string): Promise<boolean> {
    const validated = parseWithSchema(settingUpdateSchema, { key, value });
    if (isTauriRuntime() && !customEngineAdapter) {
      return tauriInvoke<boolean>('update_setting', validated);
    }
    return await getEngineAdapter().updateSetting(validated.key, validated.value);
  },

  async exportTransactionsCsv(): Promise<string> {
    if (isTauriRuntime() && !customEngineAdapter) {
      const txs = await this.getTransactions();
      return serializeTransactionsToCsv(txs);
    }
    return await getEngineAdapter().exportTransactionsCsv();
  },

  async importTransactionsCsv(rawCsv: string): Promise<CsvImportResult> {
    if (isTauriRuntime() && !customEngineAdapter) {
      const preview = parseAndPreviewCsv(rawCsv);
      const accounts = await this.getAccounts();
      if (accounts.length === 0) {
        throw new Error('Create an account before importing transactions.');
      }
      const defaultAccountId = accounts[0].id;
      const categories = await this.getCategories();
      const projects = await this.getProjects();
      let importedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < preview.length; i++) {
        const row = preview[i];
        if (!row.valid) {
          skippedCount++;
          if (row.error) errors.push(`Row ${i + 1}: ${row.error}`);
          continue;
        }

        let cat = categories.find(
          (c) =>
            c.name.toLowerCase() === row.category.toLowerCase() &&
            c.type === row.type
        );
        if (!cat) {
          cat = await this.createCategory({
            name: row.category,
            type: row.type,
            icon: row.type === 'income' ? 'wallet' : 'shopping-cart',
            color: row.type === 'income' ? '#10b981' : '#3b82f6',
          });
          categories.push(cat);
        }

        let projId: string | null = null;
        if (row.project) {
          let proj = projects.find(
            (p) => p.name.toLowerCase() === row.project!.toLowerCase()
          );
          if (!proj) {
            proj = await this.createProject({
              name: row.project,
              target_budget: 1000,
              status: 'active',
            });
            projects.push(proj);
          }
          projId = proj.id;
        }

        await this.createTransaction({
          account_id: defaultAccountId,
          category_id: cat.id,
          project_id: projId,
          amount: row.amount,
          type: row.type,
          payee: row.payee,
          date: row.date,
          is_recurring: row.is_recurring,
          recurring_interval: row.recurring_interval,
          notes: row.notes || null,
        });
        importedCount++;
      }

      return {
        imported_count: importedCount,
        skipped_count: skippedCount,
        errors,
      };
    }
    return await getEngineAdapter().importTransactionsCsv(rawCsv);
  },
};
