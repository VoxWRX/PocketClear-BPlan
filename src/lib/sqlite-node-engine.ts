/**
 * @file sqlite-node-engine.ts
 * @description Real SQLite engine adapter powered by Node's built-in `node:sqlite` (`DatabaseSync`).
 * Used by automated integration tests to verify SQL queries, WAL mode, foreign keys,
 * and schema migrations against an actual SQLite database engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const { DatabaseSync } = (
  process as unknown as {
    getBuiltinModule: (id: string) => { DatabaseSync: typeof DatabaseSyncType };
  }
).getBuiltinModule('node:sqlite');
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
  ProjectStatus,
  RecurringInterval,
  Transaction,
  TransactionFilter,
  TransactionType,
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
} from '@/lib/utils';
import { parseAndPreviewCsv, serializeTransactionsToCsv } from '@/lib/csv';
import {
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

export const SQLITE_SCHEMA_SQL = `
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
`;

export class SqliteNodeEngine {
  private db: DatabaseSyncType;
  public dbPath: string;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(SQLITE_SCHEMA_SQL);
    const projCols = this.db
      .prepare('PRAGMA table_info(projects);')
      .all() as Array<{ name: string }>;
    const hasKindCol = projCols.some(
      (c) => String(c.name).toLowerCase() === 'kind'
    );
    if (!hasKindCol) {
      this.db.exec(
        "ALTER TABLE projects ADD COLUMN kind TEXT CHECK(kind IN ('month', 'project')) DEFAULT NULL;"
      );
    }
    const txFks = this.db
      .prepare('PRAGMA foreign_key_list(transactions);')
      .all() as Array<{ table: string }>;
    const hasCategoryFk = txFks.some(
      (fk) => String(fk.table).toLowerCase() === 'categories'
    );
    if (hasCategoryFk) {
      this.db.exec(`
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
      `);
    }
    const defaults: Array<[string, string]> = [
      ['currency', 'USD'],
      ['language', 'en'],
      ['theme', 'system'],
      ['accent', 'emerald'],
      ['decimal_separator', '.'],
      ['date_format', 'YYYY-MM-DD'],
      ['auto_lock_minutes', '15'],
    ];
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
    );
    for (const [k, v] of defaults) {
      stmt.run(k, v);
    }
  }

  public close(): void {
    this.db.close();
  }

  public getPragmaJournalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
    return row?.journal_mode || '';
  }

  public getPragmaForeignKeys(): number {
    const row = this.db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
    return Number(row?.foreign_keys ?? 0);
  }

  public getAccounts(): Account[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts ORDER BY created_at ASC'
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      starting_balance: Number(r.starting_balance),
      current_balance: Number(r.current_balance),
      currency: String(r.currency),
      created_at: String(r.created_at),
    }));
  }

  public createAccount(payload: NewAccount): Account {
    const validated = parseWithSchema(newAccountSchema, payload);
    const id = crypto.randomUUID();
    const currency = validated.currency || 'USD';
    const bal = Math.round(validated.starting_balance * 100) / 100;

    this.db
      .prepare(
        'INSERT INTO accounts (id, name, starting_balance, current_balance, currency) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, validated.name, bal, bal, currency);

    const row = this.db
      .prepare(
        'SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts WHERE id = ?'
      )
      .get(id) as Record<string, unknown>;

    return {
      id: String(row.id),
      name: String(row.name),
      starting_balance: Number(row.starting_balance),
      current_balance: Number(row.current_balance),
      currency: String(row.currency),
      created_at: String(row.created_at),
    };
  }

  public updateAccount(payload: UpdateAccount): Account {
    const validated = parseWithSchema(updateAccountSchema, payload);
    if (validated.name !== undefined) {
      this.db
        .prepare('UPDATE accounts SET name = ? WHERE id = ?')
        .run(validated.name, validated.id);
    }
    if (validated.currency !== undefined) {
      this.db
        .prepare('UPDATE accounts SET currency = ? WHERE id = ?')
        .run(validated.currency, validated.id);
    }
    const row = this.db
      .prepare(
        'SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts WHERE id = ?'
      )
      .get(validated.id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('Account not found.');
    }
    return {
      id: String(row.id),
      name: String(row.name),
      starting_balance: Number(row.starting_balance),
      current_balance: Number(row.current_balance),
      currency: String(row.currency),
      created_at: String(row.created_at),
    };
  }

  public completeOnboarding(payload: OnboardingPayload): Account {
    const validated = parseWithSchema(onboardingPayloadSchema, payload);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const accountId = crypto.randomUUID();
      const accountName = validated.account_name || 'Main Pocket';
      const startBal = Number.isFinite(validated.starting_balance)
        ? Math.round(validated.starting_balance * 100) / 100
        : 0;
      const currency = validated.currency || 'USD';

      this.db
        .prepare(
          'INSERT INTO accounts (id, name, starting_balance, current_balance, currency) VALUES (?, ?, ?, ?, ?)'
        )
        .run(accountId, accountName, startBal, startBal, currency);

      this.db
        .prepare(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('currency', ?)"
        )
        .run(currency);

      if (validated.language) {
        this.db
          .prepare(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', ?)"
          )
          .run(validated.language);
      }

      const catStmt = this.db.prepare(
        'INSERT INTO categories (id, name, type, icon, color, monthly_budget) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const cat of validated.categories) {
        catStmt.run(
          crypto.randomUUID(),
          cat.name.trim(),
          cat.type,
          cat.icon || 'circle',
          cat.color || '#10b981',
          cat.monthly_budget ?? null
        );
      }

      this.db.exec('COMMIT');

      const row = this.db
        .prepare(
          'SELECT id, name, starting_balance, current_balance, currency, created_at FROM accounts WHERE id = ?'
        )
        .get(accountId) as Record<string, unknown>;

      return {
        id: String(row.id),
        name: String(row.name),
        starting_balance: Number(row.starting_balance),
        current_balance: Number(row.current_balance),
        currency: String(row.currency),
        created_at: String(row.created_at),
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public getCategories(): Category[] {
    const rows = this.db
      .prepare(
        "SELECT id, name, type, icon, COALESCE(color, '#10b981') as color, monthly_budget FROM categories ORDER BY type ASC, name ASC"
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: r.type as TransactionType,
      icon: String(r.icon),
      color: String(r.color),
      monthly_budget:
        r.monthly_budget === null || r.monthly_budget === undefined
          ? null
          : Number(r.monthly_budget),
    }));
  }

  public createCategory(payload: NewCategory): Category {
    const validated = parseWithSchema(newCategorySchema, payload);
    const id = crypto.randomUUID();
    const icon = validated.icon || 'circle';
    const color = validated.color || '#10b981';
    const budget =
      validated.monthly_budget !== undefined && validated.monthly_budget !== null
        ? Math.round(validated.monthly_budget * 100) / 100
        : null;

    this.db
      .prepare(
        'INSERT INTO categories (id, name, type, icon, color, monthly_budget) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, validated.name, validated.type, icon, color, budget);

    return {
      id,
      name: validated.name,
      type: validated.type,
      icon,
      color,
      monthly_budget: budget,
    };
  }

  public updateCategory(payload: UpdateCategory): Category {
    const validated = parseWithSchema(updateCategorySchema, payload);
    const existing = this.db
      .prepare(
        "SELECT id, name, type, icon, COALESCE(color, '#10b981') as color, monthly_budget FROM categories WHERE id = ?"
      )
      .get(validated.id) as Record<string, unknown> | undefined;

    if (!existing) {
      throw new Error('Category not found.');
    }

    const name = validated.name !== undefined ? validated.name : String(existing.name);
    const icon = validated.icon !== undefined ? validated.icon : String(existing.icon);
    const color = validated.color !== undefined ? validated.color : String(existing.color);
    const monthlyBudget =
      validated.monthly_budget !== undefined
        ? validated.monthly_budget === null
          ? null
          : Math.round(validated.monthly_budget * 100) / 100
        : existing.monthly_budget === null || existing.monthly_budget === undefined
        ? null
        : Number(existing.monthly_budget);

    this.db
      .prepare(
        'UPDATE categories SET name = ?, icon = ?, color = ?, monthly_budget = ? WHERE id = ?'
      )
      .run(name, icon, color, monthlyBudget, validated.id);

    return {
      id: validated.id,
      name,
      type: existing.type as TransactionType,
      icon,
      color,
      monthly_budget: monthlyBudget,
    };
  }

  public deleteCategory(id: string): boolean {
    const cleanId = String(id ?? '').trim();
    if (!cleanId) {
      throw new Error('Category ID is required.');
    }
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(cleanId);
    return true;
  }

  public getProjects(): Project[] {
    const rows = this.db
      .prepare(
        `
        SELECT p.id, p.name, p.target_budget, p.status, p.kind, p.created_at,
               COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0.0 END), 0.0) as spent_amount,
               COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0.0 END), 0.0) as income_amount,
               COUNT(t.id) as tx_count
        FROM projects p
        LEFT JOIN transactions t ON t.project_id = p.id
        GROUP BY p.id, p.name, p.target_budget, p.status, p.kind, p.created_at
        ORDER BY p.created_at DESC
        `
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      target_budget: Number(r.target_budget),
      status: r.status as ProjectStatus,
      kind: inferProjectKind(
        String(r.name),
        r.kind === null || r.kind === undefined ? null : String(r.kind)
      ),
      created_at: String(r.created_at),
      spent_amount: Math.round(Number(r.spent_amount) * 100) / 100,
      income_amount: Math.round(Number(r.income_amount) * 100) / 100,
      transaction_count: Number(r.tx_count),
    }));
  }

  public createProject(payload: NewProject): Project {
    const validated = parseWithSchema(newProjectSchema, payload);
    const status = validated.status || 'active';
    const kind = inferProjectKind(validated.name, validated.kind);
    const id = crypto.randomUUID();
    const budget = Math.round(validated.target_budget * 100) / 100;

    this.db
      .prepare(
        'INSERT INTO projects (id, name, target_budget, status, kind) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, validated.name, budget, status, kind);

    const row = this.db
      .prepare(
        'SELECT id, name, target_budget, status, kind, created_at FROM projects WHERE id = ?'
      )
      .get(id) as Record<string, unknown>;

    return {
      id: String(row.id),
      name: String(row.name),
      target_budget: Number(row.target_budget),
      status: row.status as ProjectStatus,
      kind: inferProjectKind(
        String(row.name),
        row.kind === null || row.kind === undefined ? null : String(row.kind)
      ),
      created_at: String(row.created_at),
      spent_amount: 0,
      income_amount: 0,
      transaction_count: 0,
    };
  }

  public updateProject(payload: UpdateProject): Project {
    const validated = parseWithSchema(updateProjectSchema, payload);
    const existing = this.db
      .prepare('SELECT id, name, target_budget, status, kind FROM projects WHERE id = ?')
      .get(validated.id) as Record<string, unknown> | undefined;

    if (!existing) {
      throw new Error('Project not found.');
    }

    const name = validated.name !== undefined ? validated.name : String(existing.name);
    const budget =
      validated.target_budget !== undefined
        ? Math.round(validated.target_budget * 100) / 100
        : Number(existing.target_budget);
    const status = validated.status !== undefined ? validated.status : String(existing.status);
    const kind =
      validated.kind !== undefined
        ? validated.kind
        : inferProjectKind(
            name,
            existing.kind === null || existing.kind === undefined
              ? null
              : String(existing.kind)
          );

    this.db
      .prepare(
        'UPDATE projects SET name = ?, target_budget = ?, status = ?, kind = ? WHERE id = ?'
      )
      .run(name, budget, status, kind, validated.id);

    const updated = this.getProjects().find((p) => p.id === validated.id);
    if (!updated) throw new Error('Updated project not found.');
    return updated;
  }

  public deleteProject(id: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('UPDATE transactions SET project_id = NULL WHERE project_id = ?')
        .run(id);
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      this.db.exec('COMMIT');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private mapTransactionRow(row: Record<string, unknown>): Transaction {
    return {
      id: String(row.id),
      account_id: String(row.account_id),
      category_id: String(row.category_id),
      category_name: row.category_name ? String(row.category_name) : undefined,
      category_icon: row.category_icon ? String(row.category_icon) : undefined,
      category_color: row.category_color ? String(row.category_color) : undefined,
      project_id:
        row.project_id === null || row.project_id === undefined
          ? null
          : String(row.project_id),
      project_name:
        row.project_name === null || row.project_name === undefined
          ? null
          : String(row.project_name),
      amount: Number(row.amount),
      type: row.type as TransactionType,
      payee: String(row.payee),
      date: String(row.date),
      is_recurring: Number(row.is_recurring) !== 0,
      recurring_interval:
        row.recurring_interval === null || row.recurring_interval === undefined
          ? null
          : (String(row.recurring_interval) as RecurringInterval),
      notes:
        row.notes === null || row.notes === undefined ? null : String(row.notes),
      created_at: String(row.created_at),
    };
  }

  public getTransactions(filter?: TransactionFilter): Transaction[] {
    const f = filter
      ? parseWithSchema(transactionFilterSchema, filter)
      : {};
    let sql = `
      SELECT t.id, t.account_id, t.category_id,
             c.name as category_name, c.icon as category_icon, c.color as category_color,
             t.project_id, p.name as project_name,
             t.amount, t.type, t.payee, t.date,
             t.is_recurring, t.recurring_interval, t.notes, t.created_at
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE 1 = 1
    `;
    const params: Array<string | number> = [];

    if (f.search && f.search.trim()) {
      const pat = `%${f.search.trim().toLowerCase()}%`;
      sql +=
        " AND (LOWER(t.payee) LIKE ? OR LOWER(COALESCE(t.notes, '')) LIKE ? OR LOWER(COALESCE(c.name, '')) LIKE ?)";
      params.push(pat, pat, pat);
    }

    if (f.type === 'income' || f.type === 'expense') {
      sql += ' AND t.type = ?';
      params.push(f.type);
    }

    if (f.category_id) {
      sql += ' AND t.category_id = ?';
      params.push(f.category_id);
    }

    if (f.project_id) {
      sql += ' AND t.project_id = ?';
      params.push(f.project_id);
    }

    if (f.only_recurring) {
      sql += ' AND t.is_recurring = 1';
    }

    if (f.only_projects) {
      sql += " AND t.project_id IS NOT NULL AND t.project_id != ''";
    }

    if (f.date_from) {
      sql += ' AND t.date >= ?';
      params.push(f.date_from);
    }

    if (f.date_to) {
      sql += ' AND t.date <= ?';
      params.push(f.date_to);
    }

    sql += ' ORDER BY t.date DESC, t.created_at DESC, t.rowid DESC';

    if (f.limit && f.limit > 0) {
      sql += ` LIMIT ${Math.floor(f.limit)}`;
      if (f.offset && f.offset >= 0) {
        sql += ` OFFSET ${Math.floor(f.offset)}`;
      }
    }

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapTransactionRow(r));
  }

  public createTransaction(payload: NewTransaction): Transaction {
    const validated = parseWithSchema(newTransactionSchema, payload);
    const amount = Math.round(validated.amount * 100) / 100;
    const id = crypto.randomUUID();
    const isRec = validated.is_recurring ? 1 : 0;
    const recInterval = isRec ? validated.recurring_interval || 'monthly' : null;
    const projectId = validated.project_id ?? null;
    const notes = validated.notes ?? null;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `
          INSERT INTO transactions (
            id, account_id, category_id, project_id, amount, type, payee, date,
            is_recurring, recurring_interval, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          id,
          validated.account_id,
          validated.category_id,
          projectId,
          amount,
          validated.type,
          validated.payee,
          validated.date,
          isRec,
          recInterval,
          notes
        );

      const delta = validated.type === 'income' ? amount : -amount;
      const res = this.db
        .prepare(
          'UPDATE accounts SET current_balance = ROUND(current_balance + ?, 2) WHERE id = ?'
        )
        .run(delta, validated.account_id);

      if (Number(res.changes) === 0) {
        throw new Error('Target account does not exist.');
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const created = this.db
      .prepare(
        `
        SELECT t.id, t.account_id, t.category_id,
               c.name as category_name, c.icon as category_icon, c.color as category_color,
               t.project_id, p.name as project_name,
               t.amount, t.type, t.payee, t.date,
               t.is_recurring, t.recurring_interval, t.notes, t.created_at
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.id = ?
        `
      )
      .get(id) as Record<string, unknown>;

    return this.mapTransactionRow(created);
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

    const source = this.db
      .prepare(
        `
        SELECT account_id, category_id, project_id, amount, type, payee, date,
               is_recurring, recurring_interval, notes
        FROM transactions WHERE id = ?
        `
      )
      .get(validated.id) as Record<string, unknown> | undefined;

    if (!source) {
      throw new Error('Original transaction not found.');
    }

    const isRec =
      validated.markRecurring !== undefined
        ? validated.markRecurring
        : Number(source.is_recurring) !== 0;

    return this.createTransaction({
      account_id: String(source.account_id),
      category_id: String(source.category_id),
      project_id:
        source.project_id === null || source.project_id === undefined
          ? null
          : String(source.project_id),
      amount: Number(source.amount),
      type: source.type as TransactionType,
      payee: String(source.payee),
      date: validated.newDate ?? getTodayIso(),
      is_recurring: isRec,
      recurring_interval: isRec
        ? validated.recurringInterval ||
          (source.recurring_interval as RecurringInterval) ||
          'monthly'
        : null,
      notes:
        source.notes === null || source.notes === undefined
          ? null
          : String(source.notes),
    });
  }

  public updateTransaction(payload: UpdateTransaction): Transaction {
    const validated = parseWithSchema(updateTransactionSchema, payload);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const oldRow = this.db
        .prepare(
          `
          SELECT account_id, category_id, project_id, amount, type, payee, date,
                 is_recurring, recurring_interval, notes
          FROM transactions WHERE id = ?
          `
        )
        .get(validated.id) as Record<string, unknown> | undefined;

      if (!oldRow) {
        throw new Error('Transaction not found.');
      }

      const oldAccountId = String(oldRow.account_id);
      const oldAmount = Number(oldRow.amount);
      const oldType = oldRow.type as TransactionType;

      const newAccountId = validated.account_id ?? oldAccountId;
      const newCategoryId = validated.category_id ?? String(oldRow.category_id);
      const newProjectId = validated.clear_project_id
        ? null
        : validated.project_id !== undefined
        ? validated.project_id
        : oldRow.project_id === null || oldRow.project_id === undefined
        ? null
        : String(oldRow.project_id);

      const newAmount =
        validated.amount !== undefined
          ? Math.round(validated.amount * 100) / 100
          : oldAmount;
      const newType = validated.type ?? oldType;
      const newPayee =
        validated.payee !== undefined ? validated.payee : String(oldRow.payee);
      const newDate = validated.date ?? String(oldRow.date).trim();
      const newIsRec =
        validated.is_recurring !== undefined
          ? validated.is_recurring
            ? 1
            : 0
          : Number(oldRow.is_recurring);
      const newRecInterval =
        newIsRec === 1
          ? validated.recurring_interval ??
            (oldRow.recurring_interval as string | null) ??
            'monthly'
          : null;
      const newNotes =
        validated.notes !== undefined
          ? validated.notes
          : oldRow.notes === null || oldRow.notes === undefined
          ? null
          : String(oldRow.notes);

      // Revert old balance impact
      const oldDelta = oldType === 'income' ? oldAmount : -oldAmount;
      this.db
        .prepare(
          'UPDATE accounts SET current_balance = ROUND(current_balance - ?, 2) WHERE id = ?'
        )
        .run(oldDelta, oldAccountId);

      // Apply new balance impact
      const newDelta = newType === 'income' ? newAmount : -newAmount;
      const accRes = this.db
        .prepare(
          'UPDATE accounts SET current_balance = ROUND(current_balance + ?, 2) WHERE id = ?'
        )
        .run(newDelta, newAccountId);

      if (Number(accRes.changes) === 0) {
        throw new Error('Target account does not exist.');
      }

      this.db
        .prepare(
          `
          UPDATE transactions
          SET account_id = ?, category_id = ?, project_id = ?, amount = ?,
              type = ?, payee = ?, date = ?, is_recurring = ?,
              recurring_interval = ?, notes = ?
          WHERE id = ?
          `
        )
        .run(
          newAccountId,
          newCategoryId,
          newProjectId,
          newAmount,
          newType,
          newPayee,
          newDate,
          newIsRec,
          newRecInterval,
          newNotes,
          validated.id
        );

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const updated = this.db
      .prepare(
        `
        SELECT t.id, t.account_id, t.category_id,
               c.name as category_name, c.icon as category_icon, c.color as category_color,
               t.project_id, p.name as project_name,
               t.amount, t.type, t.payee, t.date,
               t.is_recurring, t.recurring_interval, t.notes, t.created_at
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.id = ?
        `
      )
      .get(validated.id) as Record<string, unknown>;

    return this.mapTransactionRow(updated);
  }

  public deleteTransaction(id: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare('SELECT account_id, amount, type FROM transactions WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined;

      if (!row) {
        throw new Error('Transaction not found.');
      }

      const accountId = String(row.account_id);
      const amount = Number(row.amount);
      const txType = row.type as TransactionType;
      const delta = txType === 'income' ? amount : -amount;

      this.db
        .prepare(
          'UPDATE accounts SET current_balance = ROUND(current_balance - ?, 2) WHERE id = ?'
        )
        .run(delta, accountId);

      this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
      this.db.exec('COMMIT');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public getDashboardSummary(referenceDate?: string): DashboardSummary {
    const todayStr = referenceDate || getTodayIso();
    const currentMonthPrefix = todayStr.slice(0, 7);

    const accCountRow = this.db
      .prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(current_balance), 0.0) as total FROM accounts')
      .get() as { cnt: number; total: number };

    const hasAccounts = Number(accCountRow.cnt) > 0;
    const totalBalance = Math.round(Number(accCountRow.total) * 100) / 100;

    const firstAcc = this.db
      .prepare('SELECT currency FROM accounts ORDER BY created_at ASC LIMIT 1')
      .get() as { currency: string } | undefined;

    const settingCurrency = this.db
      .prepare("SELECT value FROM app_settings WHERE key = 'currency'")
      .get() as { value: string } | undefined;

    const currency = firstAcc?.currency || settingCurrency?.value || 'USD';

    // Ensure any legacy project rows without explicit kind have inferred kind persisted
    const nullKindProjects = this.db
      .prepare('SELECT id, name FROM projects WHERE kind IS NULL')
      .all() as Array<{ id: string; name: string }>;
    if (nullKindProjects.length > 0) {
      const updateKindStmt = this.db.prepare(
        'UPDATE projects SET kind = ? WHERE id = ?'
      );
      for (const proj of nullKindProjects) {
        updateKindStmt.run(inferProjectKind(String(proj.name), null), String(proj.id));
      }
    }

    const inRow = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(t.amount), 0.0) as total
        FROM transactions t
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.type = 'income'
          AND substr(t.date, 1, 7) = ?
          AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
        `
      )
      .get(currentMonthPrefix) as { total: number };

    const outRow = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(t.amount), 0.0) as total
        FROM transactions t
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.type = 'expense'
          AND substr(t.date, 1, 7) = ?
          AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
        `
      )
      .get(currentMonthPrefix) as { total: number };

    const moneyInThisMonth = Math.round(Number(inRow.total) * 100) / 100;
    const moneyOutThisMonth = Math.round(Number(outRow.total) * 100) / 100;

    const health = evaluateSpendingHealth({
      totalBalance,
      moneyInThisMonth,
      moneyOutThisMonth,
      referenceDateStr: todayStr,
    });

    // Top 5 Expense Categories + "Other"
    const catRows = this.db
      .prepare(
        `
        SELECT COALESCE(c.id, 'uncategorized') as id,
               COALESCE(c.name, 'Uncategorized') as name,
               COALESCE(c.icon, 'circle') as icon,
               COALESCE(c.color, '#10b981') as color,
               COALESCE(SUM(t.amount), 0.0) as total
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.type = 'expense'
          AND substr(t.date, 1, 7) = ?
          AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
        GROUP BY COALESCE(c.id, 'uncategorized'), COALESCE(c.name, 'Uncategorized'), COALESCE(c.icon, 'circle'), COALESCE(c.color, '#10b981')
        ORDER BY total DESC
        `
      )
      .all(currentMonthPrefix) as Array<Record<string, unknown>>;

    const totalCatSpend = catRows.reduce((s, r) => s + Number(r.total), 0);
    const categoryBreakdown: CategoryBreakdown[] = [];
    let otherAmount = 0;

    catRows.forEach((r, idx) => {
      const amt = Math.round(Number(r.total) * 100) / 100;
      if (idx < 5) {
        categoryBreakdown.push({
          category_id: String(r.id),
          name: String(r.name),
          icon: String(r.icon),
          color: String(r.color),
          amount: amt,
          percentage:
            totalCatSpend > 0 ? Math.round((amt / totalCatSpend) * 1000) / 10 : 0,
        });
      } else {
        otherAmount += amt;
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

    // Last 6 months timeline
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
      const mIn = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(t.amount), 0.0) as total
          FROM transactions t
          LEFT JOIN projects p ON t.project_id = p.id
          WHERE t.type = 'income'
            AND substr(t.date, 1, 7) = ?
            AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
          `
        )
        .get(ym) as { total: number };
      const mOut = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(t.amount), 0.0) as total
          FROM transactions t
          LEFT JOIN projects p ON t.project_id = p.id
          WHERE t.type = 'expense'
            AND substr(t.date, 1, 7) = ?
            AND (t.project_id IS NULL OR COALESCE(p.kind, 'project') != 'project')
          `
        )
        .get(ym) as { total: number };

      monthlyCashflow.push({
        month: ym,
        label: monthNames[m - 1] || ym,
        money_in: Math.round(Number(mIn.total) * 100) / 100,
        money_out: Math.round(Number(mOut.total) * 100) / 100,
      });
    }

    // Upcoming recurring reminders:
    // Order by date DESC, created_at DESC, rowid DESC so the most recent recurring entry
    // for each (LOWER(TRIM(payee)), category_id, type) series determines amount & interval,
    // while latest_any_date accounts for any payment (recurring or one-off) recorded in that series.
    const recRows = this.db
      .prepare(
        `
        SELECT t.id, t.payee, t.amount, t.type, t.category_id,
               COALESCE(c.name, 'General') as category_name,
               COALESCE(c.icon, 'circle') as category_icon,
               COALESCE(c.color, '#10b981') as category_color,
               COALESCE(t.recurring_interval, 'monthly') as recurring_interval,
               t.date as rec_date,
               (
                 SELECT MAX(t2.date)
                 FROM transactions t2
                 WHERE LOWER(TRIM(t2.payee)) = LOWER(TRIM(t.payee))
                   AND t2.category_id = t.category_id
                   AND t2.type = t.type
               ) as latest_any_date
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.is_recurring = 1
        ORDER BY t.date DESC, t.created_at DESC, t.rowid DESC
        `
      )
      .all() as Array<Record<string, unknown>>;

    const seenSeries = new Set<string>();
    const upcomingRecurring: UpcomingRecurringItem[] = [];
    for (const r of recRows) {
      const seriesKey = `${String(r.payee).trim().toLowerCase()}::${String(r.category_id)}::${String(r.type)}`;
      if (seenSeries.has(seriesKey)) continue;
      seenSeries.add(seriesKey);

      const interval = (r.recurring_interval as RecurringInterval) || 'monthly';
      const lastDate = String(r.latest_any_date || r.rec_date);
      const { nextDueDate, daysUntilDue } = computeNextDueDate(
        lastDate,
        interval,
        todayStr
      );
      if (daysUntilDue <= 14) {
        upcomingRecurring.push({
          transaction_id: String(r.id),
          payee: String(r.payee),
          amount: Number(r.amount),
          type: r.type as TransactionType,
          category_id: String(r.category_id),
          category_name: String(r.category_name),
          category_icon: String(r.category_icon),
          category_color: String(r.category_color),
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
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    const escaped = targetPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}';`);
    return targetPath;
  }

  public importBackupDb(sourcePath: string): boolean {
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Backup file does not exist.');
    }
    // Verify SQLite header, PRAGMA integrity_check & required table + column schema
    const checkDb = new DatabaseSync(sourcePath);
    try {
      const integrity = checkDb.prepare('PRAGMA integrity_check;').get() as {
        integrity_check: string;
      };
      if ((integrity?.integrity_check || '').toLowerCase() !== 'ok') {
        throw new Error('Database integrity check failed.');
      }
      const requiredSchema: Record<string, string[]> = {
        accounts: [
          'id',
          'name',
          'starting_balance',
          'current_balance',
          'currency',
          'created_at',
        ],
        categories: ['id', 'name', 'type', 'icon', 'color', 'monthly_budget'],
        projects: ['id', 'name', 'target_budget', 'status', 'created_at'],
        transactions: [
          'id',
          'account_id',
          'category_id',
          'project_id',
          'amount',
          'type',
          'payee',
          'date',
          'is_recurring',
          'recurring_interval',
          'notes',
          'created_at',
        ],
        app_settings: ['key', 'value'],
      };
      for (const [tbl, requiredCols] of Object.entries(requiredSchema)) {
        const row = checkDb
          .prepare(
            "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name = ?"
          )
          .get(tbl) as { cnt: number };
        if (!row || Number(row.cnt) === 0) {
          throw new Error(`Backup database is missing required table: ${tbl}`);
        }
        const colRows = checkDb
          .prepare(`PRAGMA table_info(${tbl});`)
          .all() as Array<{ name: string }>;
        const existingCols = new Set(colRows.map((c) => String(c.name).toLowerCase()));
        for (const reqCol of requiredCols) {
          if (!existingCols.has(reqCol.toLowerCase())) {
            throw new Error(
              `Backup database table '${tbl}' is missing required column: ${reqCol}`
            );
          }
        }
      }
    } finally {
      checkDb.close();
    }

    if (this.dbPath !== ':memory:') {
      this.db.close();
      fs.copyFileSync(sourcePath, this.dbPath);
      this.db = new DatabaseSync(this.dbPath);
      this.initSchema();
    } else {
      // Copy tables from sourcePath into in-memory DB using ATTACH with explicit column lists
      const escaped = sourcePath.replace(/'/g, "''");
      this.db.exec(`ATTACH DATABASE '${escaped}' AS restore_src;`);
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec('DELETE FROM transactions;');
        this.db.exec('DELETE FROM projects;');
        this.db.exec('DELETE FROM categories;');
        this.db.exec('DELETE FROM accounts;');
        this.db.exec('DELETE FROM app_settings;');

        this.db.exec(
          'INSERT INTO accounts (id, name, starting_balance, current_balance, currency, created_at) SELECT id, name, starting_balance, current_balance, currency, created_at FROM restore_src.accounts;'
        );
        this.db.exec(
          'INSERT INTO categories (id, name, type, icon, color, monthly_budget) SELECT id, name, type, icon, color, monthly_budget FROM restore_src.categories;'
        );
        const srcProjCols = this.db
          .prepare('PRAGMA restore_src.table_info(projects);')
          .all() as Array<{ name: string }>;
        const srcHasKind = srcProjCols.some(
          (c) => String(c.name).toLowerCase() === 'kind'
        );
        if (srcHasKind) {
          this.db.exec(
            'INSERT INTO projects (id, name, target_budget, status, kind, created_at) SELECT id, name, target_budget, status, kind, created_at FROM restore_src.projects;'
          );
        } else {
          this.db.exec(
            'INSERT INTO projects (id, name, target_budget, status, created_at) SELECT id, name, target_budget, status, created_at FROM restore_src.projects;'
          );
        }
        this.db.exec(
          'INSERT INTO transactions (id, account_id, category_id, project_id, amount, type, payee, date, is_recurring, recurring_interval, notes, created_at) SELECT id, account_id, category_id, project_id, amount, type, payee, date, is_recurring, recurring_interval, notes, created_at FROM restore_src.transactions;'
        );
        this.db.exec(
          'INSERT INTO app_settings (key, value) SELECT key, value FROM restore_src.app_settings;'
        );
        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      } finally {
        this.db.exec('DETACH DATABASE restore_src;');
      }
    }
    return true;
  }

  public verifyOrSetPin(pin: string): boolean {
    const row = this.db
      .prepare("SELECT value FROM app_settings WHERE key = 'pin_hash'")
      .get() as { value: string } | undefined;

    if (row && row.value) {
      return verifyPinArgon2id(pin, row.value);
    }
    const newHash = hashPinArgon2id(pin);
    this.db
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pin_hash', ?)")
      .run(newHash);
    return true;
  }

  public disablePin(currentPin: string): boolean {
    const row = this.db
      .prepare("SELECT value FROM app_settings WHERE key = 'pin_hash'")
      .get() as { value: string } | undefined;

    if (row && row.value) {
      if (!verifyPinArgon2id(currentPin, row.value)) {
        return false;
      }
      this.db.prepare("DELETE FROM app_settings WHERE key = 'pin_hash'").run();
    }
    return true;
  }

  public checkAuthState(): AuthState {
    const pinRow = this.db
      .prepare("SELECT value FROM app_settings WHERE key = 'pin_hash'")
      .get() as { value: string } | undefined;
    const lockRow = this.db
      .prepare("SELECT value FROM app_settings WHERE key = 'auto_lock_minutes'")
      .get() as { value: string } | undefined;

    return {
      has_pin: Boolean(pinRow && pinRow.value),
      auto_lock_minutes: Number(lockRow?.value || 15),
    };
  }

  public getSettings(): Record<string, string> {
    const rows = this.db
      .prepare("SELECT key, value FROM app_settings WHERE key != 'pin_hash'")
      .all() as Array<{ key: string; value: string }>;
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.value;
    }
    return out;
  }

  public updateSetting(key: string, value: string): boolean {
    const validated = parseWithSchema(settingUpdateSchema, { key, value });
    this.db
      .prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      .run(validated.key, validated.value);
    return true;
  }

  public exportTransactionsCsv(): string {
    const txs = this.getTransactions();
    return serializeTransactionsToCsv(txs);
  }

  public importTransactionsCsv(rawCsv: string): CsvImportResult {
    const preview = parseAndPreviewCsv(rawCsv);
    const accounts = this.getAccounts();
    if (accounts.length === 0) {
      throw new Error('Create an account before importing transactions.');
    }
    const defaultAccountId = accounts[0].id;
    let categories = this.getCategories();
    let projects = this.getProjects();

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

      // Match or create category
      let cat = categories.find(
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
        categories = this.getCategories();
      }

      // Match or create project if specified
      let projId: string | null = null;
      if (row.project) {
        let proj = projects.find(
          (p) => p.name.toLowerCase() === row.project!.toLowerCase()
        );
        if (!proj) {
          proj = this.createProject({
            name: row.project,
            target_budget: 1000,
            status: 'active',
          });
          projects = this.getProjects();
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
