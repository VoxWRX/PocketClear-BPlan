import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteNodeEngine } from '@/lib/sqlite-node-engine';

const TMP_DIR = path.join(process.cwd(), '.tmp-test-sqlite');

describe('Real SQLite Engine (node:sqlite) Deep Verification', () => {
  let dbPath: string;
  let engine: SqliteNodeEngine;

  beforeEach(() => {
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }
    dbPath = path.join(
      TMP_DIR,
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    engine = new SqliteNodeEngine(dbPath);
  });

  afterEach(() => {
    try {
      engine.close();
    } catch {}
    try {
      if (fs.existsSync(TMP_DIR)) {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
      }
    } catch {}
  });

  it('enables WAL journal mode and foreign key constraints on disk database', () => {
    expect(engine.getPragmaJournalMode().toLowerCase()).toBe('wal');
    expect(engine.getPragmaForeignKeys()).toBe(1);
  });

  it('maintains atomic account balance across create, update, duplicate, and delete transactions', () => {
    const account = engine.completeOnboarding({
      account_name: 'Main Checking',
      starting_balance: 1000,
      currency: 'USD',
      language: 'en',
      categories: [
        { name: 'Salary', type: 'income', icon: 'wallet', color: '#10b981' },
        { name: 'Rent', type: 'expense', icon: 'home', color: '#f43f5e', monthly_budget: 800 },
        { name: 'Groceries', type: 'expense', icon: 'shopping-cart', color: '#3b82f6', monthly_budget: 400 },
      ],
    });

    expect(account.starting_balance).toBe(1000);
    expect(account.current_balance).toBe(1000);

    const cats = engine.getCategories();
    const salaryCat = cats.find((c) => c.name === 'Salary')!;
    const rentCat = cats.find((c) => c.name === 'Rent')!;

    // 1. Add Money In (+2500) -> 3500
    const incomeTx = engine.createTransaction({
      account_id: account.id,
      category_id: salaryCat.id,
      amount: 2500,
      type: 'income',
      payee: 'Acme Corp Payroll',
      date: '2026-10-01',
    });
    expect(engine.getAccounts()[0].current_balance).toBe(3500);

    // 2. Add Money Out (-800) -> 2700
    const rentTx = engine.createTransaction({
      account_id: account.id,
      category_id: rentCat.id,
      amount: 800,
      type: 'expense',
      payee: 'Sunset Apartments',
      date: '2026-10-02',
      is_recurring: true,
      recurring_interval: 'monthly',
    });
    expect(engine.getAccounts()[0].current_balance).toBe(2700);

    // 3. Update Rent from 800 to 850 -> 2650
    const updatedRent = engine.updateTransaction({
      id: rentTx.id,
      amount: 850,
      payee: 'Sunset Apartments LLC',
    });
    expect(updatedRent.amount).toBe(850);
    expect(updatedRent.payee).toBe('Sunset Apartments LLC');
    expect(engine.getAccounts()[0].current_balance).toBe(2650);

    // 4. Duplicate Rent transaction to 2026-11-02 (-850) -> 1800
    const dupRent = engine.duplicateTransaction(rentTx.id, '2026-11-02', true, 'monthly');
    expect(dupRent.id).not.toBe(rentTx.id);
    expect(dupRent.date).toBe('2026-11-02');
    expect(dupRent.amount).toBe(850);
    expect(dupRent.is_recurring).toBe(true);
    expect(engine.getAccounts()[0].current_balance).toBe(1800);

    // 5. Delete duplicated transaction (+850 reverted) -> 2650
    engine.deleteTransaction(dupRent.id);
    expect(engine.getAccounts()[0].current_balance).toBe(2650);

    // 6. Delete income transaction (-2500 reverted) -> 150
    engine.deleteTransaction(incomeTx.id);
    expect(engine.getAccounts()[0].current_balance).toBe(150);
  });

  it('rolls back transaction if target account does not exist or validation fails', () => {
    const account = engine.createAccount({
      name: 'Pocket',
      starting_balance: 500,
      currency: 'EUR',
    });
    const cat = engine.createCategory({
      name: 'Food',
      type: 'expense',
      icon: 'utensils',
    });

    expect(() =>
      engine.createTransaction({
        account_id: 'non-existent-account-id',
        category_id: cat.id,
        amount: 50,
        type: 'expense',
        payee: 'Cafe',
        date: '2026-10-10',
      })
    ).toThrow();

    expect(() =>
      engine.createTransaction({
        account_id: account.id,
        category_id: cat.id,
        amount: -25,
        type: 'expense',
        payee: 'Invalid Negative',
        date: '2026-10-10',
      })
    ).toThrow(/positive/i);

    expect(engine.getTransactions().length).toBe(0);
    expect(engine.getAccounts()[0].current_balance).toBe(500);
  });

  it('exports SQLite backup via VACUUM INTO, validates integrity, and restores cleanly', () => {
    const acc = engine.createAccount({
      name: 'Backup Account',
      starting_balance: 1200,
      currency: 'MAD',
    });
    const cat = engine.createCategory({
      name: 'Utilities',
      type: 'expense',
      icon: 'zap',
    });
    engine.createTransaction({
      account_id: acc.id,
      category_id: cat.id,
      amount: 200,
      type: 'expense',
      payee: 'Fiber Internet',
      date: '2026-10-05',
    });

    expect(engine.getAccounts()[0].current_balance).toBe(1000);

    const backupFile = path.join(TMP_DIR, 'exported-backup.sqlite');
    engine.exportBackupDb(backupFile);
    expect(fs.existsSync(backupFile)).toBe(true);

    // Mutate current database after backup
    engine.createTransaction({
      account_id: acc.id,
      category_id: cat.id,
      amount: 400,
      type: 'expense',
      payee: 'Accidental Expense',
      date: '2026-10-06',
    });
    expect(engine.getAccounts()[0].current_balance).toBe(600);

    // Restore from backup file
    const restored = engine.importBackupDb(backupFile);
    expect(restored).toBe(true);
    expect(engine.getAccounts()[0].current_balance).toBe(1000);
    expect(engine.getTransactions().length).toBe(1);

    // Reject corrupted / non-SQLite file
    const badFile = path.join(TMP_DIR, 'corrupt.sqlite');
    fs.writeFileSync(badFile, 'not a valid sqlite file');
    expect(() => engine.importBackupDb(badFile)).toThrow();
  });

  it('hashes and verifies local PIN using Argon2id and enforces minimum length', () => {
    expect(engine.checkAuthState().has_pin).toBe(false);

    // Reject short PIN (< 4 chars)
    expect(() => engine.verifyOrSetPin('123')).toThrow(/at least 4/i);

    // Set PIN
    expect(engine.verifyOrSetPin('2468')).toBe(true);
    expect(engine.checkAuthState().has_pin).toBe(true);

    // Wrong PIN fails, right PIN succeeds
    expect(engine.verifyOrSetPin('9999')).toBe(false);
    expect(engine.verifyOrSetPin('2468')).toBe(true);

    // Disable PIN requires current PIN
    expect(engine.disablePin('0000')).toBe(false);
    expect(engine.checkAuthState().has_pin).toBe(true);

    expect(engine.disablePin('2468')).toBe(true);
    expect(engine.checkAuthState().has_pin).toBe(false);
  });

  it('rejects SQLite backup files with missing columns without overwriting the live disk database', () => {
    const { createRequire } = require('node:module');
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req('node:sqlite');
    const liveDbPath = path.join(TMP_DIR, 'live-test.sqlite');
    const badSchemaPath = path.join(TMP_DIR, 'missing-columns.sqlite');
    if (fs.existsSync(liveDbPath)) fs.unlinkSync(liveDbPath);
    if (fs.existsSync(badSchemaPath)) fs.unlinkSync(badSchemaPath);

    const diskEngine = new SqliteNodeEngine(liveDbPath);
    diskEngine.createAccount({
      name: 'Protected Live Account',
      starting_balance: 2500,
      currency: 'USD',
    });

    // Create a valid SQLite file that has all 5 table names but is missing required columns
    const badDb = new DatabaseSync(badSchemaPath);
    badDb.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY);
      CREATE TABLE categories (id TEXT PRIMARY KEY);
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE transactions (id TEXT PRIMARY KEY);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    badDb.close();

    expect(() => diskEngine.importBackupDb(badSchemaPath)).toThrow(
      /missing required column/i
    );
    // Verify the live database was NOT overwritten and still has its data
    expect(diskEngine.getAccounts()).toHaveLength(1);
    expect(diskEngine.getAccounts()[0].name).toBe('Protected Live Account');
    expect(diskEngine.getAccounts()[0].current_balance).toBe(2500);
    diskEngine.close();
  });

  it('deduplicates recurring series case-insensitively, picks newest interval/amount, and advances when paid as one-off', () => {
    const acc = engine.createAccount({
      name: 'Main Pocket',
      starting_balance: 3000,
      currency: 'USD',
    });
    const cat = engine.createCategory({
      name: 'Fitness',
      type: 'expense',
      icon: 'sparkles',
    });

    // Older entry with different casing and monthly interval
    engine.createTransaction({
      account_id: acc.id,
      category_id: cat.id,
      amount: 40,
      type: 'expense',
      payee: 'City Gym',
      date: '2025-10-05',
      is_recurring: true,
      recurring_interval: 'monthly',
    });

    // Newer entry on 2026-10-05 with lowercase name and updated amount ($55) + weekly interval
    engine.createTransaction({
      account_id: acc.id,
      category_id: cat.id,
      amount: 55,
      type: 'expense',
      payee: '  city gym ',
      date: '2026-10-05',
      is_recurring: true,
      recurring_interval: 'weekly',
    });

    // Evaluate on 2026-10-12 (7 days after 2026-10-05 -> due today!)
    const summaryBeforePay = engine.getDashboardSummary('2026-10-12');
    expect(summaryBeforePay.upcoming_recurring).toHaveLength(1);
    expect(summaryBeforePay.upcoming_recurring[0].amount).toBe(55);
    expect(summaryBeforePay.upcoming_recurring[0].recurring_interval).toBe('weekly');
    expect(summaryBeforePay.upcoming_recurring[0].next_due_date).toBe('2026-10-12');
    expect(summaryBeforePay.upcoming_recurring[0].days_until_due).toBe(0);

    // Now record payment on 2026-10-12 with markRecurring = false (one-off)
    engine.duplicateTransaction(
      summaryBeforePay.upcoming_recurring[0].transaction_id,
      '2026-10-12',
      false,
      null
    );

    // Next due date should advance from 2026-10-12 to 2026-10-19 (7 days away)
    const summaryAfterPay = engine.getDashboardSummary('2026-10-12');
    expect(summaryAfterPay.upcoming_recurring).toHaveLength(1);
    expect(summaryAfterPay.upcoming_recurring[0].last_date).toBe('2026-10-12');
    expect(summaryAfterPay.upcoming_recurring[0].next_due_date).toBe('2026-10-19');
    expect(summaryAfterPay.upcoming_recurring[0].days_until_due).toBe(7);
  });

  it('enforces validation on entity updates, settings, duplicate transactions, filter queries, and invalid transaction dates', () => {
    const acc = engine.createAccount({
      name: 'Valid Account',
      starting_balance: 500,
      currency: 'USD',
    });
    const cat = engine.createCategory({
      name: 'Valid Category',
      type: 'expense',
      icon: 'home',
      color: '#3b82f6',
      monthly_budget: 200,
    });
    const proj = engine.createProject({
      name: 'Valid Project',
      target_budget: 1000,
    });

    expect(() => engine.updateAccount({ id: acc.id, name: '   ' })).toThrow(
      /Account name/i
    );
    expect(() =>
      engine.updateCategory({ id: cat.id, monthly_budget: -50 })
    ).toThrow(/zero or positive/i);
    expect(() =>
      engine.updateProject({ id: proj.id, target_budget: -10 })
    ).toThrow(/zero or positive/i);
    expect(() =>
      engine.createTransaction({
        account_id: acc.id,
        category_id: cat.id,
        amount: 25,
        type: 'expense',
        payee: 'Bad Date',
        date: '2026-02-31',
      })
    ).toThrow(/YYYY-MM-DD/i);

    const tx = engine.createTransaction({
      account_id: acc.id,
      category_id: cat.id,
      amount: 25,
      type: 'expense',
      payee: 'Valid Entry',
      date: '2026-10-12',
      notes: 'Initial note',
    });

    // Whitespace-only notes on updateTransaction normalizes to null
    const updatedTx = engine.updateTransaction({
      id: tx.id,
      notes: '   ',
    });
    expect(updatedTx.notes).toBeNull();

    // Whitespace-only icon/color on updateCategory normalizes to defaults ('circle' / '#10b981')
    const updatedCat = engine.updateCategory({
      id: cat.id,
      icon: '   ',
      color: '   ',
    });
    expect(updatedCat.icon).toBe('circle');
    expect(updatedCat.color).toBe('#10b981');

    // Invalid duplicateTransaction date or empty ID rejected by Zod
    expect(() =>
      engine.duplicateTransaction(tx.id, '2026-02-31', true, 'monthly')
    ).toThrow(/YYYY-MM-DD/i);
    expect(() =>
      engine.duplicateTransaction('', '2026-10-15', false, null)
    ).toThrow(/Transaction ID/i);

    // Invalid transaction filter rejected by Zod
    expect(() =>
      engine.getTransactions({ date_from: '2026-02-31' })
    ).toThrow(/YYYY-MM-DD/i);
    expect(() =>
      engine.getTransactions({ limit: -5 })
    ).toThrow();

    // Invalid setting updates rejected by Zod
    expect(() => engine.updateSetting('language', 'invalid_lang')).toThrow(
      /Language must be/i
    );
    expect(() => engine.updateSetting('theme', 'neon')).toThrow(
      /Theme must be/i
    );
    expect(() => engine.updateSetting('auto_lock_minutes', '-1')).toThrow(
      /positive integer/i
    );
  });

  it('migrates and restores legacy SQLite databases created before the projects.kind column existed', () => {
    const { createRequire } = require('node:module');
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req('node:sqlite');
    const legacyDbPath = path.join(TMP_DIR, 'legacy-no-kind.sqlite');
    if (fs.existsSync(legacyDbPath)) fs.unlinkSync(legacyDbPath);

    // Create a legacy v3/v4 SQLite database WITHOUT the 'kind' column on projects
    const legacyDb = new DatabaseSync(legacyDbPath);
    legacyDb.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        starting_balance REAL NOT NULL DEFAULT 0.0,
        current_balance REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'MAD',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
        icon TEXT NOT NULL DEFAULT 'circle',
        color TEXT DEFAULT '#10b981',
        monthly_budget REAL DEFAULT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_budget REAL NOT NULL DEFAULT 0.0,
        status TEXT CHECK(status IN ('active', 'completed', 'paused')) DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE transactions (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO accounts (id, name, starting_balance, current_balance, currency) VALUES ('acc-1', 'Compte Principal', 10000, 10000, 'MAD');
      INSERT INTO categories (id, name, type, icon, color) VALUES ('cat-1', 'Loyer', 'expense', 'home', '#10b981');
      INSERT INTO projects (id, name, target_budget, status) VALUES ('p-1', 'mois 11', 16700, 'active');
      INSERT INTO projects (id, name, target_budget, status) VALUES ('p-2', 'Maison Principale', 120000, 'active');
    `);
    legacyDb.close();

    // 1. Restore legacy DB into an in-memory SqliteNodeEngine
    const memEngine = new SqliteNodeEngine(':memory:');
    expect(memEngine.importBackupDb(legacyDbPath)).toBe(true);
    const memProjs = memEngine.getProjects();
    expect(memProjs.find((p) => p.id === 'p-1')?.kind).toBe('month');
    expect(memProjs.find((p) => p.id === 'p-2')?.kind).toBe('project');
    memEngine.close();

    // 2. Open legacy DB directly on disk and verify auto-migration adds 'kind' column
    const migratedEngine = new SqliteNodeEngine(legacyDbPath);
    const diskProjs = migratedEngine.getProjects();
    expect(diskProjs.find((p) => p.id === 'p-1')?.kind).toBe('month');
    expect(diskProjs.find((p) => p.id === 'p-2')?.kind).toBe('project');
    migratedEngine.close();
  });

  it('allows deleting categories (including the last category with transactions), migrates legacy category_id foreign keys, and preserves dashboard summary & recurring transactions', () => {
    const { createRequire } = require('node:module');
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req('node:sqlite');
    const legacyFkDbPath = path.join(TMP_DIR, 'legacy-fk-categories.sqlite');
    if (fs.existsSync(legacyFkDbPath)) fs.unlinkSync(legacyFkDbPath);

    // Create a legacy database that still has FOREIGN KEY(category_id) REFERENCES categories(id)
    const legacyDb = new DatabaseSync(legacyFkDbPath);
    legacyDb.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        starting_balance REAL NOT NULL DEFAULT 0.0,
        current_balance REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'MAD',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
        icon TEXT NOT NULL DEFAULT 'circle',
        color TEXT DEFAULT '#10b981',
        monthly_budget REAL DEFAULT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_budget REAL NOT NULL DEFAULT 0.0,
        status TEXT CHECK(status IN ('active', 'completed', 'paused')) DEFAULT 'active',
        kind TEXT CHECK(kind IN ('project', 'month')) DEFAULT 'project',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE transactions (
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
        FOREIGN KEY(account_id) REFERENCES accounts(id),
        FOREIGN KEY(category_id) REFERENCES categories(id),
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO accounts (id, name, starting_balance, current_balance, currency) VALUES ('acc-1', 'Main', 5000, 3900, 'MAD');
      INSERT INTO categories (id, name, type, icon, color, monthly_budget) VALUES ('cat-1', 'Abonnements', 'expense', 'zap', '#3b82f6', 1000);
      INSERT INTO categories (id, name, type, icon, color, monthly_budget) VALUES ('cat-2', 'Transport', 'expense', 'car', '#06b6d4', 500);
      INSERT INTO transactions (id, account_id, category_id, amount, type, payee, date, is_recurring, recurring_interval)
        VALUES ('tx-1', 'acc-1', 'cat-1', 800, 'expense', 'Fibre Optique', '2026-10-05', 1, 'monthly');
      INSERT INTO transactions (id, account_id, category_id, amount, type, payee, date, is_recurring, recurring_interval)
        VALUES ('tx-2', 'acc-1', 'cat-2', 300, 'expense', 'Carburant', '2026-10-08', 0, NULL);
    `);
    legacyDb.close();

    const migratedEngine = new SqliteNodeEngine(legacyFkDbPath);
    expect(migratedEngine.getPragmaForeignKeys()).toBe(1);

    // Reject empty/whitespace category ID
    expect(() => migratedEngine.deleteCategory('   ')).toThrow(
      /Category ID is required/i
    );

    // Delete BOTH categories in the DB even though tx-1 and tx-2 reference them
    expect(migratedEngine.deleteCategory('cat-1')).toBe(true);
    expect(migratedEngine.deleteCategory('cat-2')).toBe(true);
    expect(migratedEngine.getCategories()).toHaveLength(0);

    // Deleting an already-deleted category is idempotent and returns true
    expect(migratedEngine.deleteCategory('cat-1')).toBe(true);

    // Existing transactions and dashboard summary still work and aggregate into a single 'Uncategorized' slice
    const txs = migratedEngine.getTransactions();
    expect(txs).toHaveLength(2);

    const summary = migratedEngine.getDashboardSummary('2026-11-05');
    expect(summary.upcoming_recurring).toHaveLength(1);
    expect(summary.upcoming_recurring[0].payee).toBe('Fibre Optique');
    expect(summary.upcoming_recurring[0].category_name).toBe('General');

    const octSummary = migratedEngine.getDashboardSummary('2026-10-15');
    expect(octSummary.category_breakdown).toHaveLength(1);
    expect(octSummary.category_breakdown[0].category_id).toBe('uncategorized');
    expect(octSummary.category_breakdown[0].name).toBe('Uncategorized');
    expect(octSummary.category_breakdown[0].amount).toBe(1100);

    // Duplicating or updating a transaction whose category was deleted also works
    const dup = migratedEngine.duplicateTransaction(
      'tx-1',
      '2026-11-05',
      true,
      'monthly'
    );
    expect(dup.amount).toBe(800);
    migratedEngine.close();
  });
});

