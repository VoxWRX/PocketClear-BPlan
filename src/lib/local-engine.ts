/**
 * @file local-engine.ts
 * @description Browser-compatible local persistence engine (`BrowserLocalEngine`)
 * implementing the `FinanceEngineAdapter` contract with ACID-like balance updates,
 * legacy snapshot migration, Argon2id PIN lock, and backup validation.
 */
import {
  Account,
  AuthState,
  Category,
  CategoryBreakdown,
  CsvImportResult,
  DashboardSummary,
  MonthlyCashflow,
  NewAccount,
  NewCategory,
  NewProject,
  NewTransaction,
  OnboardingPayload,
  Project,
  ProjectKind,
  RecurringInterval,
  Transaction,
  TransactionFilter,
  UpcomingRecurringItem,
  UpdateAccount,
  UpdateCategory,
  UpdateProject,
  UpdateTransaction,
} from '@/types/finance';
import { hashPinArgon2id, verifyPinArgon2id } from '@/lib/argon2-auth';
import {
  computeNextDueDate,
  evaluateSpendingHealth,
  getTodayIso,
  inferProjectKind,
  isValidIsoDate,
} from '@/lib/utils';
import { parseAndPreviewCsv, serializeTransactionsToCsv } from '@/lib/csv';
import {
  backupAccountRowSchema,
  backupCategoryRowSchema,
  backupProjectRowSchema,
  backupStoreSchema,
  backupTransactionRowSchema,
  duplicateTransactionSchema,
  newAccountSchema,
  newCategorySchema,
  newProjectSchema,
  newTransactionSchema,
  onboardingPayloadSchema,
  parseWithSchema,
  settingUpdateSchema,
  transactionFilterSchema,
  updateAccountSchema,
  updateCategorySchema,
  updateProjectSchema,
  updateTransactionSchema,
} from '@/lib/schemas';

export interface FinanceEngineAdapter {
  getAccounts(): Account[] | Promise<Account[]>;
  createAccount(payload: NewAccount): Account | Promise<Account>;
  updateAccount(payload: UpdateAccount): Account | Promise<Account>;
  completeOnboarding(payload: OnboardingPayload): Account | Promise<Account>;
  getCategories(): Category[] | Promise<Category[]>;
  createCategory(payload: NewCategory): Category | Promise<Category>;
  updateCategory(payload: UpdateCategory): Category | Promise<Category>;
  deleteCategory(id: string): boolean | Promise<boolean>;
  getProjects(): Project[] | Promise<Project[]>;
  createProject(payload: NewProject): Project | Promise<Project>;
  updateProject(payload: UpdateProject): Project | Promise<Project>;
  deleteProject(id: string): boolean | Promise<boolean>;
  getTransactions(filter?: TransactionFilter): Transaction[] | Promise<Transaction[]>;
  createTransaction(payload: NewTransaction): Transaction | Promise<Transaction>;
  duplicateTransaction(
    id: string,
    newDate?: string | null,
    markRecurring?: boolean,
    recurringInterval?: RecurringInterval | null
  ): Transaction | Promise<Transaction>;
  updateTransaction(payload: UpdateTransaction): Transaction | Promise<Transaction>;
  deleteTransaction(id: string): boolean | Promise<boolean>;
  getDashboardSummary(referenceDate?: string): DashboardSummary | Promise<DashboardSummary>;
  exportBackupDb(targetPath: string): string | Promise<string>;
  importBackupDb(sourcePath: string): boolean | Promise<boolean>;
  verifyOrSetPin(pin: string): boolean | Promise<boolean>;
  disablePin(currentPin: string): boolean | Promise<boolean>;
  checkAuthState(): AuthState | Promise<AuthState>;
  getSettings(): Record<string, string> | Promise<Record<string, string>>;
  updateSetting(key: string, value: string): boolean | Promise<boolean>;
  exportTransactionsCsv(): string | Promise<string>;
  importTransactionsCsv(rawCsv: string): CsvImportResult | Promise<CsvImportResult>;
}

interface InternalStore {
  accounts: Account[];
  categories: Category[];
  projects: Array<{
    id: string;
    name: string;
    target_budget: number;
    status: 'active' | 'completed' | 'paused';
    kind?: ProjectKind;
    created_at: string;
  }>;
  transactions: Transaction[];
  app_settings: Record<string, string>;
}

const STORAGE_KEY = 'pocketclear_sqlite_mirror_v4';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function defaultSettings(): Record<string, string> {
  return {
    currency: 'USD',
    language: 'en',
    theme: 'system',
    accent: 'emerald',
    decimal_separator: '.',
    date_format: 'YYYY-MM-DD',
    auto_lock_minutes: '15',
  };
}

function isValidArgon2PinHash(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('$').filter(Boolean);
  return parts.length === 5 && parts[0] === 'argon2id';
}

function normalizeLegacyDate(rawDateInput: unknown): string {
  if (typeof rawDateInput === 'string') {
    const trimmed = rawDateInput.trim();
    const isoSlice = trimmed.slice(0, 10);
    if (isValidIsoDate(isoSlice)) {
      return isoSlice;
    }
    const dmyMatch = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(trimmed);
    if (dmyMatch) {
      const converted = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
      if (isValidIsoDate(converted)) {
        return converted;
      }
    }
  }
  return getTodayIso();
}

function sanitizeLegacyStore(rawCandidate: unknown): InternalStore | null {
  if (!rawCandidate || typeof rawCandidate !== 'object') return null;
  const obj = rawCandidate as Record<string, unknown>;
  if (
    !Array.isArray(obj.accounts) &&
    !Array.isArray(obj.categories) &&
    !Array.isArray(obj.projects) &&
    !Array.isArray(obj.transactions) &&
    (!obj.app_settings || typeof obj.app_settings !== 'object')
  ) {
    return null;
  }

  const accounts: Account[] = [];
  if (Array.isArray(obj.accounts)) {
    for (const rawAcc of obj.accounts) {
      const direct = backupAccountRowSchema.safeParse(rawAcc);
      if (direct.success) {
        accounts.push(direct.data);
        continue;
      }
      if (rawAcc && typeof rawAcc === 'object') {
        const a = rawAcc as Record<string, unknown>;
        const rawStart = Number(a.starting_balance ?? a.balance ?? 0);
        const rawCurr = Number(
          a.current_balance ?? a.balance ?? a.starting_balance ?? 0
        );
        const coerced = backupAccountRowSchema.safeParse({
          id: String(a.id ?? '').trim() || generateUuid(),
          name: String(a.name ?? '').trim() || 'Main Pocket',
          starting_balance: Number.isFinite(rawStart) ? rawStart : 0,
          current_balance: Number.isFinite(rawCurr) ? rawCurr : 0,
          currency: String(a.currency ?? 'USD').trim() || 'USD',
          created_at:
            typeof a.created_at === 'string' && a.created_at
              ? a.created_at
              : new Date().toISOString(),
        });
        if (coerced.success) accounts.push(coerced.data);
      }
    }
  }

  const categories: Category[] = [];
  if (Array.isArray(obj.categories)) {
    for (const rawCat of obj.categories) {
      const direct = backupCategoryRowSchema.safeParse(rawCat);
      if (direct.success) {
        categories.push(direct.data);
        continue;
      }
      if (rawCat && typeof rawCat === 'object') {
        const c = rawCat as Record<string, unknown>;
        const rawBudget =
          c.monthly_budget === null || c.monthly_budget === undefined || c.monthly_budget === ''
            ? null
            : Number(c.monthly_budget);
        const coerced = backupCategoryRowSchema.safeParse({
          id: String(c.id ?? '').trim() || generateUuid(),
          name: String(c.name ?? c.label ?? '').trim() || 'General',
          type: c.type === 'income' ? 'income' : 'expense',
          icon: String(c.icon ?? 'circle').trim() || 'circle',
          color: String(c.color ?? '#10b981').trim() || '#10b981',
          monthly_budget:
            rawBudget !== null && Number.isFinite(rawBudget) && rawBudget >= 0
              ? rawBudget
              : null,
        });
        if (coerced.success) categories.push(coerced.data);
      }
    }
  }

  const projects: InternalStore['projects'] = [];
  if (Array.isArray(obj.projects)) {
    for (const rawProj of obj.projects) {
      const direct = backupProjectRowSchema.safeParse(rawProj);
      if (direct.success) {
        projects.push({
          ...direct.data,
          kind: inferProjectKind(direct.data.name, direct.data.kind),
        });
        continue;
      }
      if (rawProj && typeof rawProj === 'object') {
        const p = rawProj as Record<string, unknown>;
        const name = String(p.name ?? p.title ?? '').trim() || 'Project';
        const rawKind = typeof p.kind === 'string' ? p.kind : null;
        const coerced = backupProjectRowSchema.safeParse({
          id: String(p.id ?? '').trim() || generateUuid(),
          name,
          target_budget: Math.max(0, Number(p.target_budget) || 0),
          status:
            p.status === 'completed' || p.status === 'paused'
              ? p.status
              : 'active',
          kind: inferProjectKind(name, rawKind),
          created_at:
            typeof p.created_at === 'string' && p.created_at
              ? p.created_at
              : new Date().toISOString(),
        });
        if (coerced.success) {
          projects.push({
            ...coerced.data,
            kind: inferProjectKind(coerced.data.name, coerced.data.kind),
          });
        }
      }
    }
  }

  const transactions: Transaction[] = [];
  if (Array.isArray(obj.transactions)) {
    for (const rawTx of obj.transactions) {
      const direct = backupTransactionRowSchema.safeParse(rawTx);
      if (direct.success) {
        transactions.push(direct.data);
        continue;
      }
      if (rawTx && typeof rawTx === 'object') {
        const t = rawTx as Record<string, unknown>;
        const rawDate = normalizeLegacyDate(t.date);
        const absAmount = Math.abs(Number(t.amount));
        const coerced = backupTransactionRowSchema.safeParse({
          id: String(t.id ?? '').trim() || generateUuid(),
          account_id:
            String(t.account_id ?? '').trim() ||
            accounts[0]?.id ||
            'default-account',
          category_id: String(t.category_id ?? '').trim() || 'uncategorized',
          project_id:
            typeof t.project_id === 'string' && t.project_id.trim()
              ? t.project_id.trim()
              : null,
          amount: absAmount,
          type: t.type === 'income' ? 'income' : 'expense',
          payee: String(t.payee ?? '').trim() || 'Transaction',
          date: rawDate,
          is_recurring: Boolean(t.is_recurring),
          recurring_interval:
            t.recurring_interval === 'weekly' ||
            t.recurring_interval === 'monthly' ||
            t.recurring_interval === 'yearly'
              ? t.recurring_interval
              : null,
          notes:
            typeof t.notes === 'string' && t.notes.trim()
              ? t.notes.trim()
              : null,
          created_at:
            typeof t.created_at === 'string' && t.created_at
              ? t.created_at
              : new Date().toISOString(),
        });
        if (coerced.success) transactions.push(coerced.data);
      }
    }
  }

  const app_settings: Record<string, string> = { ...defaultSettings() };
  if (obj.app_settings && typeof obj.app_settings === 'object') {
    for (const [k, v] of Object.entries(
      obj.app_settings as Record<string, unknown>
    )) {
      if (v === null || v === undefined) continue;
      if (k === 'pin_hash') {
        if (isValidArgon2PinHash(v)) {
          app_settings.pin_hash = v.trim();
        }
        continue;
      }
      app_settings[k] = String(v);
    }
  }

  return {
    accounts,
    categories,
    projects,
    transactions,
    app_settings,
  };
}

export class BrowserLocalEngine implements FinanceEngineAdapter {
  private store: InternalStore;
  private virtualBackups: Map<string, string> = new Map();

  constructor() {
    this.store = this.loadFromStorage();
  }

  private loadFromStorage(): InternalStore {
    try {
      if (
        typeof window !== 'undefined' &&
        window.localStorage &&
        typeof window.localStorage.getItem === 'function'
      ) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const candidate = parsed?.store || parsed;
          const validated = backupStoreSchema.safeParse(candidate);
          if (validated.success) {
            const mergedSettings: Record<string, string> = {
              ...defaultSettings(),
              ...validated.data.app_settings,
            };
            if (
              mergedSettings.pin_hash !== undefined &&
              !isValidArgon2PinHash(mergedSettings.pin_hash)
            ) {
              delete mergedSettings.pin_hash;
            }
            return {
              accounts: validated.data.accounts,
              categories: validated.data.categories,
              projects: validated.data.projects.map((p) => ({
                ...p,
                kind: inferProjectKind(p.name, p.kind),
              })),
              transactions: validated.data.transactions,
              app_settings: mergedSettings,
            };
          }
          const sanitized = sanitizeLegacyStore(candidate);
          if (sanitized) {
            try {
              if (typeof window.localStorage.setItem === 'function') {
                window.localStorage.setItem(
                  STORAGE_KEY,
                  JSON.stringify(sanitized)
                );
              }
            } catch {
              // ignore storage errors
            }
            return sanitized;
          }
        }
      }
    } catch {
      // fallback to fresh
    }
    return {
      accounts: [],
      categories: [],
      projects: [],
      transactions: [],
      app_settings: defaultSettings(),
    };
  }

  private persist(): void {
    try {
      if (
        typeof window !== 'undefined' &&
        window.localStorage &&
        typeof window.localStorage.setItem === 'function'
      ) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
      }
    } catch {
      // Ignore storage quota or security errors in restricted browser environments
    }
  }

  public resetAll(): void {
    this.store = {
      accounts: [],
      categories: [],
      projects: [],
      transactions: [],
      app_settings: defaultSettings(),
    };
    this.persist();
  }

  public getAccounts(): Account[] {
    return [...this.store.accounts];
  }

  public createAccount(payload: NewAccount): Account {
    const validated = parseWithSchema(newAccountSchema, payload);
    const bal = Math.round((Number(validated.starting_balance) || 0) * 100) / 100;
    const acc: Account = {
      id: generateUuid(),
      name: validated.name,
      starting_balance: bal,
      current_balance: bal,
      currency: validated.currency || 'USD',
      created_at: new Date().toISOString(),
    };
    this.store.accounts.push(acc);
    this.persist();
    return { ...acc };
  }

  public updateAccount(payload: UpdateAccount): Account {
    const validated = parseWithSchema(updateAccountSchema, payload);
    const acc = this.store.accounts.find((a) => a.id === validated.id);
    if (!acc) throw new Error('Account not found.');
    if (validated.name !== undefined) acc.name = validated.name;
    if (validated.currency !== undefined) acc.currency = validated.currency;
    this.persist();
    return { ...acc };
  }

  public completeOnboarding(payload: OnboardingPayload): Account {
    const validated = parseWithSchema(onboardingPayloadSchema, payload);
    const snapshot = JSON.stringify(this.store);
    try {
      const bal = Math.round((Number(validated.starting_balance) || 0) * 100) / 100;
      const acc: Account = {
        id: generateUuid(),
        name: validated.account_name || 'Main Pocket',
        starting_balance: bal,
        current_balance: bal,
        currency: validated.currency || 'USD',
        created_at: new Date().toISOString(),
      };
      this.store.accounts.push(acc);
      this.store.app_settings.currency = acc.currency;
      if (validated.language) {
        this.store.app_settings.language = validated.language;
      }
      for (const cat of validated.categories) {
        this.store.categories.push({
          id: generateUuid(),
          name: cat.name.trim(),
          type: cat.type,
          icon: cat.icon || 'circle',
          color: cat.color || '#10b981',
          monthly_budget: cat.monthly_budget ?? null,
        });
      }
      this.persist();
      return { ...acc };
    } catch (err) {
      this.store = JSON.parse(snapshot);
      throw err;
    }
  }

  public getCategories(): Category[] {
    return [...this.store.categories].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type)
    );
  }

  public createCategory(payload: NewCategory): Category {
    const validated = parseWithSchema(newCategorySchema, payload);
    const cat: Category = {
      id: generateUuid(),
      name: validated.name,
      type: validated.type,
      icon: validated.icon || 'circle',
      color: validated.color || '#10b981',
      monthly_budget:
        validated.monthly_budget !== undefined && validated.monthly_budget !== null
          ? Math.round(validated.monthly_budget * 100) / 100
          : null,
    };
    this.store.categories.push(cat);
    this.persist();
    return { ...cat };
  }

  public updateCategory(payload: UpdateCategory): Category {
    const validated = parseWithSchema(updateCategorySchema, payload);
    const cat = this.store.categories.find((c) => c.id === validated.id);
    if (!cat) throw new Error('Category not found.');
    if (validated.name !== undefined) cat.name = validated.name;
    if (validated.icon !== undefined) cat.icon = validated.icon;
    if (validated.color !== undefined) cat.color = validated.color;
    if (validated.monthly_budget !== undefined) {
      cat.monthly_budget =
        validated.monthly_budget !== null
          ? Math.round(validated.monthly_budget * 100) / 100
          : null;
    }
    this.persist();
    return { ...cat };
  }

  public deleteCategory(id: string): boolean {
    const cleanId = String(id ?? '').trim();
    if (!cleanId) {
      throw new Error('Category ID is required.');
    }
    this.store.categories = this.store.categories.filter((c) => c.id !== cleanId);
    this.persist();
    return true;
  }

  public getProjects(): Project[] {
    return this.store.projects.map((p) => {
      const linked = this.store.transactions.filter((t) => t.project_id === p.id);
      const spent = linked
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + t.amount, 0);
      const inc = linked
        .filter((t) => t.type === 'income')
        .reduce((s, t) => s + t.amount, 0);
      return {
        ...p,
        kind: inferProjectKind(p.name, p.kind),
        spent_amount: Math.round(spent * 100) / 100,
        income_amount: Math.round(inc * 100) / 100,
        transaction_count: linked.length,
      };
    });
  }

  public createProject(payload: NewProject): Project {
    const validated = parseWithSchema(newProjectSchema, payload);
    const status = validated.status || 'active';
    const kind = inferProjectKind(validated.name, validated.kind);
    const proj = {
      id: generateUuid(),
      name: validated.name,
      target_budget: Math.round(validated.target_budget * 100) / 100,
      status,
      kind,
      created_at: new Date().toISOString(),
    };
    this.store.projects.unshift(proj);
    this.persist();
    return {
      ...proj,
      spent_amount: 0,
      income_amount: 0,
      transaction_count: 0,
    };
  }

  public updateProject(payload: UpdateProject): Project {
    const validated = parseWithSchema(updateProjectSchema, payload);
    const proj = this.store.projects.find((p) => p.id === validated.id);
    if (!proj) throw new Error('Project not found.');
    if (validated.name !== undefined) proj.name = validated.name;
    if (validated.target_budget !== undefined) {
      proj.target_budget = Math.round(validated.target_budget * 100) / 100;
    }
    if (validated.status !== undefined) proj.status = validated.status;
    if (validated.kind !== undefined) proj.kind = validated.kind;
    this.persist();
    return this.getProjects().find((p) => p.id === validated.id)!;
  }

  public deleteProject(id: string): boolean {
    for (const tx of this.store.transactions) {
      if (tx.project_id === id) {
        tx.project_id = null;
      }
    }
    this.store.projects = this.store.projects.filter((p) => p.id !== id);
    this.persist();
    return true;
  }

  private enrichTransaction(t: Transaction): Transaction {
    const cat = this.store.categories.find((c) => c.id === t.category_id);
    const proj = t.project_id
      ? this.store.projects.find((p) => p.id === t.project_id)
      : undefined;
    return {
      ...t,
      category_name: cat?.name,
      category_icon: cat?.icon,
      category_color: cat?.color,
      project_name: proj?.name ?? null,
    };
  }

  public getTransactions(filter?: TransactionFilter): Transaction[] {
    const f = filter
      ? parseWithSchema(transactionFilterSchema, filter)
      : {};
    let list = this.store.transactions.map((t) => this.enrichTransaction(t));

    if (f.search && f.search.trim()) {
      const q = f.search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.payee.toLowerCase().includes(q) ||
          (t.notes || '').toLowerCase().includes(q) ||
          (t.category_name || '').toLowerCase().includes(q)
      );
    }

    if (f.type === 'income' || f.type === 'expense') {
      list = list.filter((t) => t.type === f.type);
    }

    if (f.category_id) {
      list = list.filter((t) => t.category_id === f.category_id);
    }

    if (f.project_id) {
      list = list.filter((t) => t.project_id === f.project_id);
    }

    if (f.only_recurring) {
      list = list.filter((t) => t.is_recurring);
    }

    if (f.only_projects) {
      list = list.filter((t) => Boolean(t.project_id));
    }

    if (f.date_from) {
      list = list.filter((t) => t.date >= f.date_from!);
    }

    if (f.date_to) {
      list = list.filter((t) => t.date <= f.date_to!);
    }

    list.sort((a, b) =>
      b.date !== a.date
        ? b.date.localeCompare(a.date)
        : b.created_at.localeCompare(a.created_at)
    );

    if (f.limit && f.limit > 0) {
      const start = f.offset && f.offset > 0 ? f.offset : 0;
      list = list.slice(start, start + f.limit);
    }

    return list;
  }

  public createTransaction(payload: NewTransaction): Transaction {
    const validated = parseWithSchema(newTransactionSchema, payload);
    const acc = this.store.accounts.find((a) => a.id === validated.account_id);
    if (!acc) throw new Error('Target account does not exist.');

    const amount = Math.round(validated.amount * 100) / 100;
    const isRec = Boolean(validated.is_recurring);
    const tx: Transaction = {
      id: generateUuid(),
      account_id: validated.account_id,
      category_id: validated.category_id,
      project_id: validated.project_id ?? null,
      amount,
      type: validated.type,
      payee: validated.payee,
      date: validated.date,
      is_recurring: isRec,
      recurring_interval: isRec ? validated.recurring_interval || 'monthly' : null,
      notes: validated.notes ?? null,
      created_at: new Date().toISOString(),
    };

    const delta = validated.type === 'income' ? amount : -amount;
    acc.current_balance = Math.round((acc.current_balance + delta) * 100) / 100;
    this.store.transactions.unshift(tx);
    this.persist();
    return this.enrichTransaction(tx);
  }

  public duplicateTransaction(
    id: string,
    newDate?: string | null,
    markRecurring?: boolean,
    recurringInterval?: RecurringInterval | null
  ): Transaction {
    const validated = parseWithSchema(duplicateTransactionSchema, {
      id,
      newDate,
      markRecurring,
      recurringInterval,
    });
    const orig = this.store.transactions.find((t) => t.id === validated.id);
    if (!orig) throw new Error('Original transaction not found.');

    const isRec =
      validated.markRecurring !== undefined
        ? validated.markRecurring
        : orig.is_recurring;
    return this.createTransaction({
      account_id: orig.account_id,
      category_id: orig.category_id,
      project_id: orig.project_id,
      amount: orig.amount,
      type: orig.type,
      payee: orig.payee,
      date: validated.newDate ?? getTodayIso(),
      is_recurring: isRec,
      recurring_interval: isRec
        ? validated.recurringInterval || orig.recurring_interval || 'monthly'
        : null,
      notes: orig.notes,
    });
  }

  public updateTransaction(payload: UpdateTransaction): Transaction {
    const validated = parseWithSchema(updateTransactionSchema, payload);
    const tx = this.store.transactions.find((t) => t.id === validated.id);
    if (!tx) throw new Error('Transaction not found.');

    const oldAcc = this.store.accounts.find((a) => a.id === tx.account_id);
    const newAccountId = validated.account_id ?? tx.account_id;
    const newAcc = this.store.accounts.find((a) => a.id === newAccountId);
    if (!oldAcc || !newAcc) throw new Error('Account not found.');

    const newAmount =
      validated.amount !== undefined
        ? Math.round(validated.amount * 100) / 100
        : tx.amount;
    const newType = validated.type ?? tx.type;
    const newPayee = validated.payee !== undefined ? validated.payee : tx.payee;
    const newDate = validated.date !== undefined ? validated.date : tx.date;

    // Revert old balance
    const oldDelta = tx.type === 'income' ? tx.amount : -tx.amount;
    oldAcc.current_balance =
      Math.round((oldAcc.current_balance - oldDelta) * 100) / 100;

    // Apply new balance
    const newDelta = newType === 'income' ? newAmount : -newAmount;
    newAcc.current_balance =
      Math.round((newAcc.current_balance + newDelta) * 100) / 100;

    tx.account_id = newAccountId;
    if (validated.category_id !== undefined) tx.category_id = validated.category_id;
    if (validated.clear_project_id) {
      tx.project_id = null;
    } else if (validated.project_id !== undefined) {
      tx.project_id = validated.project_id;
    }
    tx.amount = newAmount;
    tx.type = newType;
    tx.payee = newPayee;
    tx.date = newDate;
    if (validated.is_recurring !== undefined) tx.is_recurring = validated.is_recurring;
    tx.recurring_interval = tx.is_recurring
      ? validated.recurring_interval ?? tx.recurring_interval ?? 'monthly'
      : null;
    if (validated.notes !== undefined) tx.notes = validated.notes;

    this.persist();
    return this.enrichTransaction(tx);
  }

  public deleteTransaction(id: string): boolean {
    const idx = this.store.transactions.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error('Transaction not found.');
    const tx = this.store.transactions[idx];
    const acc = this.store.accounts.find((a) => a.id === tx.account_id);
    if (acc) {
      const delta = tx.type === 'income' ? tx.amount : -tx.amount;
      acc.current_balance =
        Math.round((acc.current_balance - delta) * 100) / 100;
    }
    this.store.transactions.splice(idx, 1);
    this.persist();
    return true;
  }

  public getDashboardSummary(referenceDate?: string): DashboardSummary {
    const todayStr = referenceDate || getTodayIso();
    const currentMonthPrefix = todayStr.slice(0, 7);

    const hasAccounts = this.store.accounts.length > 0;
    const totalBalance =
      Math.round(
        this.store.accounts.reduce((s, a) => s + a.current_balance, 0) * 100
      ) / 100;
    const currency =
      this.store.accounts[0]?.currency ||
      this.store.app_settings.currency ||
      'USD';

    const projectEntityIds = new Set(
      this.store.projects
        .filter((p) => inferProjectKind(p.name, p.kind) === 'project')
        .map((p) => p.id)
    );
    const nonProjectTxs = this.store.transactions.filter(
      (t) => !t.project_id || !projectEntityIds.has(t.project_id)
    );

    const monthTxs = nonProjectTxs.filter(
      (t) => t.date.slice(0, 7) === currentMonthPrefix
    );
    const moneyInThisMonth =
      Math.round(
        monthTxs
          .filter((t) => t.type === 'income')
          .reduce((s, t) => s + t.amount, 0) * 100
      ) / 100;
    const moneyOutThisMonth =
      Math.round(
        monthTxs
          .filter((t) => t.type === 'expense')
          .reduce((s, t) => s + t.amount, 0) * 100
      ) / 100;

    const health = evaluateSpendingHealth({
      totalBalance,
      moneyInThisMonth,
      moneyOutThisMonth,
      referenceDateStr: todayStr,
    });

    // Category breakdown
    const byCat = new Map<string, number>();
    for (const tx of monthTxs) {
      if (tx.type === 'expense') {
        const hasCat = this.store.categories.some(
          (c) => c.id === tx.category_id
        );
        const key = hasCat ? tx.category_id : 'uncategorized';
        byCat.set(key, (byCat.get(key) || 0) + tx.amount);
      }
    }

    const sortedCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const totalCatSpend = sortedCats.reduce((s, [, amt]) => s + amt, 0);
    const categoryBreakdown: CategoryBreakdown[] = [];
    let otherAmount = 0;

    sortedCats.forEach(([cid, amt], idx) => {
      const cat = this.store.categories.find((c) => c.id === cid);
      const rounded = Math.round(amt * 100) / 100;
      if (idx < 5) {
        categoryBreakdown.push({
          category_id: cid,
          name: cat?.name || 'Uncategorized',
          icon: cat?.icon || 'circle',
          color: cat?.color || '#10b981',
          amount: rounded,
          percentage:
            totalCatSpend > 0
              ? Math.round((rounded / totalCatSpend) * 1000) / 10
              : 0,
        });
      } else {
        otherAmount += rounded;
      }
    });

    if (otherAmount > 0) {
      const roundedOther = Math.round(otherAmount * 100) / 100;
      categoryBreakdown.push({
        category_id: 'other',
        name: 'Other',
        icon: 'more-horizontal',
        color: '#64748b',
        amount: roundedOther,
        percentage:
          totalCatSpend > 0
            ? Math.round((roundedOther / totalCatSpend) * 1000) / 10
            : 0,
      });
    }

    // 6-month timeline
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const [refYear, refMonth] = todayStr.slice(0, 7).split('-').map(Number);
    const monthlyCashflow: MonthlyCashflow[] = [];

    for (let offset = 5; offset >= 0; offset--) {
      let y = refYear;
      let m = refMonth - offset;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      const ym = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
      const mIn = nonProjectTxs
        .filter((t) => t.type === 'income' && t.date.slice(0, 7) === ym)
        .reduce((s, t) => s + t.amount, 0);
      const mOut = nonProjectTxs
        .filter((t) => t.type === 'expense' && t.date.slice(0, 7) === ym)
        .reduce((s, t) => s + t.amount, 0);
      monthlyCashflow.push({
        month: ym,
        label: monthNames[m - 1] || ym,
        money_in: Math.round(mIn * 100) / 100,
        money_out: Math.round(mOut * 100) / 100,
      });
    }

    // Upcoming recurring reminders
    const latestAnyDateBySeries = new Map<string, string>();
    for (const tx of this.store.transactions) {
      const key = `${tx.payee.trim().toLowerCase()}::${tx.category_id}::${tx.type}`;
      const prev = latestAnyDateBySeries.get(key);
      if (!prev || tx.date > prev) {
        latestAnyDateBySeries.set(key, tx.date);
      }
    }

    const sortedRec = this.store.transactions
      .filter((tx) => tx.is_recurring)
      .sort((a, b) =>
        b.date !== a.date
          ? b.date.localeCompare(a.date)
          : b.created_at.localeCompare(a.created_at)
      );

    const groupedRec = new Map<string, Transaction>();
    for (const tx of sortedRec) {
      const key = `${tx.payee.trim().toLowerCase()}::${tx.category_id}::${tx.type}`;
      if (!groupedRec.has(key)) {
        groupedRec.set(key, tx);
      }
    }

    const upcomingRecurring: UpcomingRecurringItem[] = [];
    for (const [key, tx] of groupedRec.entries()) {
      const cat = this.store.categories.find((c) => c.id === tx.category_id);
      const interval = tx.recurring_interval || 'monthly';
      const lastDate = latestAnyDateBySeries.get(key) || tx.date;
      const { nextDueDate, daysUntilDue } = computeNextDueDate(
        lastDate,
        interval,
        todayStr
      );
      if (daysUntilDue <= 14) {
        upcomingRecurring.push({
          transaction_id: tx.id,
          payee: tx.payee,
          amount: tx.amount,
          type: tx.type,
          category_id: tx.category_id,
          category_name: cat?.name || 'General',
          category_icon: cat?.icon || 'circle',
          category_color: cat?.color || '#10b981',
          recurring_interval: interval,
          last_date: lastDate,
          next_due_date: nextDueDate,
          days_until_due: daysUntilDue,
        });
      }
    }
    upcomingRecurring.sort((a, b) => a.days_until_due - b.days_until_due);

    return {
      total_balance: totalBalance,
      money_in_this_month: moneyInThisMonth,
      money_out_this_month: moneyOutThisMonth,
      left_to_spend_this_month: health.left_to_spend_this_month,
      daily_allowance: health.daily_allowance,
      days_remaining_in_month: health.days_remaining_in_month,
      health_status: health.health_status,
      currency,
      category_breakdown: categoryBreakdown,
      monthly_cashflow: monthlyCashflow,
      upcoming_recurring: upcomingRecurring,
      has_accounts: hasAccounts,
    };
  }

  public exportBackupDb(targetPath: string): string {
    const payload = JSON.stringify({
      format: 'pocketclear-sqlite-backup-v4',
      exported_at: new Date().toISOString(),
      store: this.store,
    });
    this.virtualBackups.set(targetPath, payload);
    return targetPath;
  }

  public importBackupDb(sourcePath: string): boolean {
    const raw = this.virtualBackups.get(sourcePath) || sourcePath;
    try {
      const parsed = JSON.parse(raw);
      const candidate = parsed.store || parsed;
      const validated = parseWithSchema(backupStoreSchema, candidate);
      const mergedSettings: Record<string, string> = {
        ...defaultSettings(),
        ...validated.app_settings,
      };
      if (
        mergedSettings.pin_hash !== undefined &&
        !isValidArgon2PinHash(mergedSettings.pin_hash)
      ) {
        delete mergedSettings.pin_hash;
      }
      this.store = {
        accounts: validated.accounts,
        categories: validated.categories,
        projects: validated.projects.map((p) => ({
          ...p,
          kind: inferProjectKind(p.name, p.kind),
        })),
        transactions: validated.transactions,
        app_settings: mergedSettings,
      };
      this.persist();
      return true;
    } catch (err) {
      throw new Error(
        `Invalid backup file: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public verifyOrSetPin(pin: string): boolean {
    const existing = this.store.app_settings.pin_hash;
    if (isValidArgon2PinHash(existing)) {
      return verifyPinArgon2id(pin, existing);
    }
    const newHash = hashPinArgon2id(pin);
    this.store.app_settings.pin_hash = newHash;
    this.persist();
    return true;
  }

  public disablePin(currentPin: string): boolean {
    const existing = this.store.app_settings.pin_hash;
    if (isValidArgon2PinHash(existing)) {
      if (!verifyPinArgon2id(currentPin, existing)) {
        return false;
      }
      delete this.store.app_settings.pin_hash;
      this.persist();
    } else if (existing !== undefined) {
      delete this.store.app_settings.pin_hash;
      this.persist();
    }
    return true;
  }

  public checkAuthState(): AuthState {
    const rawLock = Number(this.store.app_settings.auto_lock_minutes);
    return {
      has_pin: isValidArgon2PinHash(this.store.app_settings.pin_hash),
      auto_lock_minutes:
        Number.isInteger(rawLock) && rawLock > 0 ? rawLock : 15,
    };
  }

  public getSettings(): Record<string, string> {
    const copy = { ...this.store.app_settings };
    delete copy.pin_hash;
    return copy;
  }

  public updateSetting(key: string, value: string): boolean {
    const validated = parseWithSchema(settingUpdateSchema, { key, value });
    this.store.app_settings[validated.key] = validated.value;
    this.persist();
    return true;
  }

  public exportTransactionsCsv(): string {
    return serializeTransactionsToCsv(this.getTransactions());
  }

  public importTransactionsCsv(rawCsv: string): CsvImportResult {
    const preview = parseAndPreviewCsv(rawCsv);
    if (this.store.accounts.length === 0) {
      throw new Error('Create an account before importing transactions.');
    }
    const defaultAccountId = this.store.accounts[0].id;
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

      let cat = this.store.categories.find(
        (c) =>
          c.name.toLowerCase() === row.category.toLowerCase() &&
          c.type === row.type
      );
      if (!cat) {
        cat = this.createCategory({
          name: row.category,
          type: row.type,
          icon: row.type === 'income' ? 'wallet' : 'shopping-cart',
          color: row.type === 'income' ? '#10b981' : '#3b82f6',
        });
      }

      let projId: string | null = null;
      if (row.project) {
        let proj = this.store.projects.find(
          (p) => p.name.toLowerCase() === row.project!.toLowerCase()
        );
        if (!proj) {
          proj = this.createProject({
            name: row.project,
            target_budget: 1000,
            status: 'active',
          });
        }
        projId = proj.id;
      }

      this.createTransaction({
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
}
