import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteNodeEngine } from '@/lib/sqlite-node-engine';
import { ipc, setEngineAdapter } from '@/lib/ipc';
import {
  computeNextDueDate,
  evaluateSpendingHealth,
  formatDisplayDate,
  formatMoney,
  inferProjectKind,
  roundCents,
  simulatePurchaseImpact,
} from '@/lib/utils';
import { parseAndPreviewCsv } from '@/lib/csv';
import {
  appSettingsSchema,
  backupStoreSchema,
  csvRowInputSchema,
  duplicateTransactionSchema,
  newAccountSchema,
  newCategorySchema,
  newProjectSchema,
  newTransactionSchema,
  onboardingPayloadSchema,
  parseWithSchema,
  pinSchema,
  resolveAppSettings,
  settingUpdateSchema,
  transactionFilterSchema,
  updateAccountSchema,
  updateCategorySchema,
  updateProjectSchema,
  updateTransactionSchema,
} from '@/lib/schemas';
import { BrowserLocalEngine } from '@/lib/local-engine';

describe('IPC Contract, Health Gauge Math, Analytics & Offline Integrity', () => {
  let engine: SqliteNodeEngine;

  beforeEach(() => {
    engine = new SqliteNodeEngine(':memory:');
    setEngineAdapter(engine);
  });

  it('computes Top 5 categories + "Other" slice and 6-month cashflow timeline', async () => {
    const acc = await ipc.completeOnboarding({
      account_name: 'Primary Pocket',
      starting_balance: 5000,
      currency: 'USD',
      categories: [
        { name: 'Salary', type: 'income', icon: 'wallet', color: '#10b981' },
        { name: 'Cat1', type: 'expense', icon: 'home', color: '#10b981' },
        { name: 'Cat2', type: 'expense', icon: 'shopping-cart', color: '#3b82f6' },
        { name: 'Cat3', type: 'expense', icon: 'sparkles', color: '#8b5cf6' },
        { name: 'Cat4', type: 'expense', icon: 'zap', color: '#f59e0b' },
        { name: 'Cat5', type: 'expense', icon: 'car', color: '#06b6d4' },
        { name: 'Cat6', type: 'expense', icon: 'coffee', color: '#ec4899' },
        { name: 'Cat7', type: 'expense', icon: 'gift', color: '#64748b' },
      ],
    });

    const cats = await ipc.getCategories();
    const byName = Object.fromEntries(cats.map((c) => [c.name, c.id]));

    await ipc.createTransaction({
      account_id: acc.id,
      category_id: byName.Salary,
      amount: 4000,
      type: 'income',
      payee: 'Employer',
      date: '2026-10-01',
    });

    const spendAmounts: Array<[string, number]> = [
      ['Cat1', 500],
      ['Cat2', 400],
      ['Cat3', 300],
      ['Cat4', 200],
      ['Cat5', 100],
      ['Cat6', 60],
      ['Cat7', 40],
    ];

    for (const [name, amt] of spendAmounts) {
      await ipc.createTransaction({
        account_id: acc.id,
        category_id: byName[name],
        amount: amt,
        type: 'expense',
        payee: `Payee ${name}`,
        date: '2026-10-10',
      });
    }

    // Project contribution (kind === 'project') must NOT pollute monthly worksheet metrics in getDashboardSummary
    const projGoal = await ipc.createProject({
      name: 'Emergency Fund',
      target_budget: 10000,
      kind: 'project',
    });
    await ipc.createTransaction({
      account_id: acc.id,
      category_id: byName.Cat1,
      project_id: projGoal.id,
      amount: 999,
      type: 'expense',
      payee: 'Project Contribution',
      date: '2026-10-12',
    });

    const summary = await ipc.getDashboardSummary('2026-10-15');
    expect(summary.money_in_this_month).toBe(4000);
    expect(summary.money_out_this_month).toBe(1600);
    expect(summary.left_to_spend_this_month).toBe(2400);
    expect(summary.category_breakdown.length).toBe(6); // Top 5 + Other
    expect(summary.category_breakdown[0].name).toBe('Cat1');
    expect(summary.category_breakdown[0].amount).toBe(500);
    expect(summary.category_breakdown[5].name).toBe('Other');
    expect(summary.category_breakdown[5].amount).toBe(100); // 60 + 40
    expect(summary.monthly_cashflow.length).toBe(6);
    expect(summary.monthly_cashflow[5].month).toBe('2026-10');
    expect(summary.monthly_cashflow[5].money_in).toBe(4000);
    expect(summary.monthly_cashflow[5].money_out).toBe(1600);

    // Also verify BrowserLocalEngine excludes project-kind contributions in getDashboardSummary
    const localEng = new BrowserLocalEngine();
    const localAcc = localEng.completeOnboarding({
      account_name: 'Local Pocket',
      starting_balance: 16000,
      currency: 'MAD',
      categories: [
        { name: 'Courses', type: 'expense', icon: 'shopping-cart', color: '#10b981' },
      ],
    });
    const localCat = localEng.getCategories()[0];
    const localProj = localEng.createProject({
      name: 'Vacances',
      target_budget: 5000,
      kind: 'project',
    });
    localEng.createTransaction({
      account_id: localAcc.id,
      category_id: localCat.id,
      project_id: localProj.id,
      amount: 800,
      type: 'expense',
      payee: 'Épargne Vacances',
      date: '2026-10-11',
    });
    const localSummary = localEng.getDashboardSummary('2026-10-15');
    expect(localSummary.money_in_this_month).toBe(0);
    expect(localSummary.money_out_this_month).toBe(0);
    expect(localSummary.left_to_spend_this_month).toBe(0);
    expect(localSummary.category_breakdown).toHaveLength(0);
    expect(localSummary.monthly_cashflow[5].money_out).toBe(0);
  });

  it('evaluates "Can I Spend This?" Smart Health Indicator across Safe, Heads Up, and Attention states', () => {
    // 1. Safe: Early in month, low spend relative to income
    const safeEval = evaluateSpendingHealth({
      totalBalance: 3000,
      moneyInThisMonth: 3000,
      moneyOutThisMonth: 300,
      referenceDateStr: '2026-10-10',
    });
    expect(safeEval.health_status).toBe('safe');
    expect(safeEval.left_to_spend_this_month).toBe(2700);
    expect(safeEval.days_remaining_in_month).toBe(22); // Oct has 31 days: 31 - 10 + 1 = 22
    expect(safeEval.daily_allowance).toBeCloseTo(2700 / 22, 1);

    // 2. Heads Up: Spending faster than daily pace (e.g., 60% spent on day 5)
    const headsUpEval = evaluateSpendingHealth({
      totalBalance: 1200,
      moneyInThisMonth: 3000,
      moneyOutThisMonth: 1800,
      referenceDateStr: '2026-10-05',
    });
    expect(headsUpEval.health_status).toBe('heads_up');

    // 3. Attention: Expenses exceed Money In
    const attentionEval = evaluateSpendingHealth({
      totalBalance: 500,
      moneyInThisMonth: 2000,
      moneyOutThisMonth: 2250,
      referenceDateStr: '2026-10-20',
    });
    expect(attentionEval.health_status).toBe('attention');
    expect(attentionEval.daily_allowance).toBe(0);

    // 4. Purchase simulator
    const simSafe = simulatePurchaseImpact({
      purchaseAmount: 25,
      totalBalance: 3000,
      moneyInThisMonth: 3000,
      moneyOutThisMonth: 300,
      referenceDateStr: '2026-10-10',
    });
    expect(simSafe.status).toBe('safe');

    const simAttention = simulatePurchaseImpact({
      purchaseAmount: 2800,
      totalBalance: 3000,
      moneyInThisMonth: 3000,
      moneyOutThisMonth: 300,
      referenceDateStr: '2026-10-10',
    });
    expect(simAttention.status).toBe('attention');

    // 5. Zero income / empty month does NOT leak starting/total balance into left_to_spend_this_month, and roundCents normalizes -0
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
    const zeroIncomeEval = evaluateSpendingHealth({
      totalBalance: 16000,
      moneyInThisMonth: 0,
      moneyOutThisMonth: 0,
      referenceDateStr: '2026-10-10',
    });
    expect(zeroIncomeEval.left_to_spend_this_month).toBe(0);

    const expenseOnlyEval = evaluateSpendingHealth({
      totalBalance: 15500,
      moneyInThisMonth: 0,
      moneyOutThisMonth: 500,
      referenceDateStr: '2026-10-10',
    });
    expect(expenseOnlyEval.left_to_spend_this_month).toBe(-500);
  });

  it('handles recurring due date calculation, CSV import/export, and number/date formatting', async () => {
    const due = computeNextDueDate('2026-09-15', 'monthly', '2026-10-10');
    expect(due.nextDueDate).toBe('2026-10-15');
    expect(due.daysUntilDue).toBe(5);

    expect(formatMoney(1234.5, 'USD', '.')).toBe('$1,234.50');
    expect(formatMoney(1234.5, 'MAD', ',')).toBe('1 234,50 MAD');
    expect(formatDisplayDate('2026-10-12', 'DD/MM/YYYY')).toBe('12/10/2026');
    expect(formatDisplayDate('2026-10-12', 'MM/DD/YYYY')).toBe('10/12/2026');

    await ipc.createAccount({
      name: 'CSV Pocket',
      starting_balance: 500,
      currency: 'USD',
    });

    const rawCsv = [
      'Date,Payee,Amount,Type,Category,Project,Notes',
      '2026-10-11,"Local Market, Inc.",45.50,expense,Groceries,Home Cooking,"Fresh veggies, fruit"',
      '2026-10-12,Client Invoice,300.00,income,Freelance,,Milestone 1',
      'invalid-date,Bad Row,-10,expense,Misc,,Invalid row',
    ].join('\n');

    const preview = parseAndPreviewCsv(rawCsv);
    expect(preview.length).toBe(3);
    expect(preview[0].valid).toBe(true);
    expect(preview[0].payee).toBe('Local Market, Inc.');
    expect(preview[2].valid).toBe(false);

    const importRes = await ipc.importTransactionsCsv(rawCsv);
    expect(importRes.imported_count).toBe(2);
    expect(importRes.skipped_count).toBe(1);

    const exported = await ipc.exportTransactionsCsv();
    expect(exported).toContain('"Local Market, Inc."');
    expect(exported).toContain('Client Invoice');
  });

  it('verifies static build output contains zero external CDN font or script links', () => {
    const outHtmlPath = path.join(process.cwd(), 'out', 'index.html');
    if (fs.existsSync(outHtmlPath)) {
      const html = fs.readFileSync(outHtmlPath, 'utf8');
      expect(html).not.toMatch(/fonts\.googleapis\.com/i);
      expect(html).not.toMatch(/fonts\.gstatic\.com/i);
      expect(html).not.toMatch(/cdn\.jsdelivr\.net/i);
      expect(html).not.toMatch(/unpkg\.com/i);
    }
  });

  it('handles boundary values, month-end/leap-year recurring dates, and type-flip balance adjustments', async () => {
    // Month-end clamping: Jan 31 -> Feb 28 (non-leap year 2026)
    const jan31ToFeb = computeNextDueDate('2026-01-31', 'monthly', '2026-02-01');
    expect(jan31ToFeb.nextDueDate).toBe('2026-02-28');

    // Leap year clamping: 2024-02-29 -> 2025-02-28 (yearly)
    const leapToNext = computeNextDueDate('2024-02-29', 'yearly', '2025-02-15');
    expect(leapToNext.nextDueDate).toBe('2025-02-28');

    // Empty / whitespace / zero / NaN boundary checks
    const acc = await ipc.createAccount({
      name: 'Boundary Account',
      starting_balance: 500,
      currency: 'USD',
    });
    const expCat = await ipc.createCategory({
      name: 'Shopping',
      type: 'expense',
      icon: 'shopping-bag',
    });
    const incCat = await ipc.createCategory({
      name: 'Refunds',
      type: 'income',
      icon: 'wallet',
    });

    await expect(
      ipc.createTransaction({
        account_id: acc.id,
        category_id: expCat.id,
        amount: 0,
        type: 'expense',
        payee: 'Zero Amount',
        date: '2026-10-12',
      })
    ).rejects.toThrow(/positive/i);

    await expect(
      ipc.createTransaction({
        account_id: acc.id,
        category_id: expCat.id,
        amount: Number.NaN,
        type: 'expense',
        payee: 'NaN Amount',
        date: '2026-10-12',
      })
    ).rejects.toThrow(/positive/i);

    await expect(
      ipc.createTransaction({
        account_id: acc.id,
        category_id: expCat.id,
        amount: 50,
        type: 'expense',
        payee: '   ',
        date: '2026-10-12',
      })
    ).rejects.toThrow(/Payee/i);

    // Flip transaction type from expense (-100) to income (+100)
    const tx = await ipc.createTransaction({
      account_id: acc.id,
      category_id: expCat.id,
      amount: 100,
      type: 'expense',
      payee: 'Store Purchase',
      date: '2026-10-12',
    });
    expect((await ipc.getAccounts())[0].current_balance).toBe(400);

    await ipc.updateTransaction({
      id: tx.id,
      type: 'income',
      category_id: incCat.id,
      amount: 100,
    });
    expect((await ipc.getAccounts())[0].current_balance).toBe(600);
  });

  it('correctly parses thousands-separated CSV amounts ($1,250.50, 1.250,50) and rejects impossible calendar dates (2026-02-31) and unknown transaction types', async () => {
    const rawCsv = [
      'Date,Payee,Amount,Type,Category,Project,Notes',
      '2026-10-11,US Salary,"$1,250.50",income,Salary,,Thousands comma + dot decimal',
      '2026-10-12,EU Laptop,"1.250,75",expense,Shopping,Work Setup,Thousands dot + comma decimal',
      '2026-10-12,Cafe,"18,50",expense,Dining,,Simple comma decimal',
      '2026-02-31,Impossible Feb Date,50.00,expense,Misc,,Invalid calendar day',
      '2026-13-45,Impossible Month,25.00,expense,Misc,,Invalid calendar month',
      '2026-10-12,Bad Type Row,100.00,invalid_type,General,,Invalid type string',
    ].join('\n');

    const preview = parseAndPreviewCsv(rawCsv);
    expect(preview).toHaveLength(6);
    expect(preview[0].valid).toBe(true);
    expect(preview[0].amount).toBe(1250.5);
    expect(preview[1].valid).toBe(true);
    expect(preview[1].amount).toBe(1250.75);
    expect(preview[2].valid).toBe(true);
    expect(preview[2].amount).toBe(18.5);
    expect(preview[3].valid).toBe(false);
    expect(preview[3].error).toMatch(/YYYY-MM-DD/i);
    expect(preview[4].valid).toBe(false);
    expect(preview[4].error).toMatch(/YYYY-MM-DD/i);
    expect(preview[5].valid).toBe(false);
    expect(preview[5].error).toMatch(/income.*expense/i);
  });

  it('routes ipc.importTransactionsCsv through Tauri IPC commands when running in Tauri runtime', async () => {
    const invokedCommands: string[] = [];
    // Simulate Tauri v2 runtime internals
    const win = window as unknown as Record<string, unknown>;
    win.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokedCommands.push(cmd);
        switch (cmd) {
          case 'get_accounts':
            return engine.getAccounts();
          case 'get_categories':
            return engine.getCategories();
          case 'create_category':
            return engine.createCategory(args?.payload as Parameters<typeof engine.createCategory>[0]);
          case 'delete_category':
            return engine.deleteCategory(String(args?.id ?? ''));
          case 'get_projects':
            return engine.getProjects();
          case 'create_project':
            return engine.createProject(args?.payload as Parameters<typeof engine.createProject>[0]);
          case 'create_transaction':
            return engine.createTransaction(args?.payload as Parameters<typeof engine.createTransaction>[0]);
          default:
            throw new Error(`Unexpected Tauri command: ${cmd}`);
        }
      },
    };

    try {
      engine.createAccount({
        name: 'Tauri Native Account',
        starting_balance: 1000,
        currency: 'USD',
      });
      // Disable customEngineAdapter so ipc uses the Tauri runtime branch
      setEngineAdapter(null);

      const csv = [
        'Date,Payee,Amount,Type,Category,Project,Notes',
        '2026-10-12,Hardware Store,"$1,200.00",expense,Home Repair,Kitchen Remodel,Cabinets',
      ].join('\n');

      const res = await ipc.importTransactionsCsv(csv);
      expect(res.imported_count).toBe(1);
      expect(res.skipped_count).toBe(0);
      expect(invokedCommands).toContain('get_accounts');
      expect(invokedCommands).toContain('create_category');
      expect(invokedCommands).toContain('create_project');
      expect(invokedCommands).toContain('create_transaction');
      expect(engine.getAccounts()[0].current_balance).toBe(-200);

      // Verify ipc.deleteCategory invokes 'delete_category' in Tauri runtime
      const createdCat = engine.getCategories()[0];
      expect(await ipc.deleteCategory(createdCat.id)).toBe(true);
      expect(invokedCommands).toContain('delete_category');
      expect(engine.getCategories()).toHaveLength(0);
    } finally {
      delete win.__TAURI_INTERNALS__;
      setEngineAdapter(engine);
    }
  });

  it('validates domain, IPC, CSV, PIN, settings, duplicateTransaction, filter, and backup schemas via Zod across valid and edge-case inputs', async () => {
    // 1. Account schemas: trimming, defaults, empty/NaN/Infinity rejection
    const validAcc = parseWithSchema(newAccountSchema, {
      name: '  Savings Pocket  ',
      starting_balance: 1250.5,
      currency: '',
    });
    expect(validAcc.name).toBe('Savings Pocket');
    expect(validAcc.currency).toBe('USD');

    expect(() =>
      parseWithSchema(newAccountSchema, {
        name: '   ',
        starting_balance: 100,
        currency: 'USD',
      })
    ).toThrow(/Account name is required/i);

    expect(() =>
      parseWithSchema(newAccountSchema, {
        name: 'Pocket',
        starting_balance: Number.POSITIVE_INFINITY,
        currency: 'USD',
      })
    ).toThrow(/Starting balance must be a valid number/i);

    expect(() =>
      parseWithSchema(updateAccountSchema, {
        id: 'acc-1',
        name: '  ',
      })
    ).toThrow(/Account name cannot be empty/i);

    // 2. Category & Project schemas: defaults, budget boundaries, enum validation, whitespace normalization
    const validCat = parseWithSchema(newCategorySchema, {
      name: '  Groceries ',
      type: 'expense',
      icon: '',
    });
    expect(validCat.name).toBe('Groceries');
    expect(validCat.icon).toBe('circle');
    expect(validCat.color).toBe('#10b981');

    const normalizedUpdateCat = parseWithSchema(updateCategorySchema, {
      id: 'cat-1',
      icon: '   ',
      color: '   ',
    });
    expect(normalizedUpdateCat.icon).toBe('circle');
    expect(normalizedUpdateCat.color).toBe('#10b981');

    expect(() =>
      parseWithSchema(newCategorySchema, {
        name: 'Bad Budget',
        type: 'expense',
        icon: 'home',
        monthly_budget: -0.01,
      })
    ).toThrow(/zero or positive/i);

    expect(() =>
      parseWithSchema(updateCategorySchema, {
        id: 'cat-1',
        monthly_budget: Number.NaN,
      })
    ).toThrow(/zero or positive/i);

    const validProj = parseWithSchema(newProjectSchema, {
      name: '  Summer Trip ',
      target_budget: 0,
    });
    expect(validProj.name).toBe('Summer Trip');
    expect(validProj.status).toBe('active');

    expect(() =>
      parseWithSchema(updateProjectSchema, {
        id: 'proj-1',
        status: 'invalid_status' as unknown as 'active',
      })
    ).toThrow(/Project status/i);

    // 3. Transaction schemas: positive amount, valid ISO date, trimmed optional fields, update notes normalization
    const validTx = parseWithSchema(newTransactionSchema, {
      account_id: 'acc-1',
      category_id: 'cat-1',
      project_id: '   ',
      amount: 19.99,
      type: 'expense',
      payee: '  Coffee Shop ',
      date: '2024-02-29', // valid leap day
      notes: '   ',
    });
    expect(validTx.payee).toBe('Coffee Shop');
    expect(validTx.project_id).toBeNull();
    expect(validTx.notes).toBeNull();

    const updatedTxNotes = parseWithSchema(updateTransactionSchema, {
      id: 'tx-1',
      notes: '   ',
    });
    expect(updatedTxNotes.notes).toBeNull();

    const updatedTxOmittedNotes = parseWithSchema(updateTransactionSchema, {
      id: 'tx-1',
      amount: 42,
    });
    expect(updatedTxOmittedNotes.notes).toBeUndefined();

    expect(() =>
      parseWithSchema(newTransactionSchema, {
        account_id: 'acc-1',
        category_id: 'cat-1',
        amount: 20,
        type: 'expense',
        payee: 'Non-leap Feb 29',
        date: '2025-02-29',
      })
    ).toThrow(/YYYY-MM-DD/i);

    expect(() =>
      parseWithSchema(updateTransactionSchema, {
        id: 'tx-1',
        amount: -5,
      })
    ).toThrow(/positive/i);

    // 4. Duplicate transaction & filter schemas
    expect(() =>
      parseWithSchema(duplicateTransactionSchema, {
        id: '',
        newDate: '2026-10-12',
      })
    ).toThrow(/Transaction ID/i);

    expect(() =>
      parseWithSchema(duplicateTransactionSchema, {
        id: 'tx-1',
        newDate: '2026-02-31',
      })
    ).toThrow(/YYYY-MM-DD/i);

    expect(() =>
      parseWithSchema(transactionFilterSchema, {
        date_from: '2026-02-31',
      })
    ).toThrow(/YYYY-MM-DD/i);

    await expect(
      ipc.duplicateTransaction('tx-1', '2026-02-31', true, 'monthly')
    ).rejects.toThrow(/YYYY-MM-DD/i);

    await expect(
      ipc.getTransactions({ date_to: 'not-a-date' })
    ).rejects.toThrow(/YYYY-MM-DD/i);

    // 5. PIN, CSV row, Onboarding, AppSettings, settingUpdateSchema, and resolveAppSettings
    expect(parseWithSchema(pinSchema, ' 1234 ')).toBe('1234');
    expect(() => parseWithSchema(pinSchema, ' 12 ')).toThrow(/at least 4/i);
    await expect(ipc.verifyOrSetPin('12')).rejects.toThrow(/at least 4/i);

    expect(
      csvRowInputSchema.safeParse({
        date: '2026-10-12',
        payee: 'Bookstore',
        amount: 25,
        type: 'expense',
        category: '',
      }).success
    ).toBe(true);

    const validOnboarding = parseWithSchema(onboardingPayloadSchema, {
      account_name: '   ',
      starting_balance: 500,
      currency: 'EUR',
      language: 'fr',
      categories: [{ name: 'Salaire', type: 'income', icon: 'wallet' }],
    });
    expect(validOnboarding.account_name).toBe('Main Pocket');

    expect(
      appSettingsSchema.safeParse({
        currency: 'MAD',
        language: 'ar',
        theme: 'dark',
        accent: 'emerald',
        decimal_separator: ',',
        date_format: 'DD/MM/YYYY',
        auto_lock_minutes: 15,
      }).success
    ).toBe(true);

    expect(() =>
      parseWithSchema(settingUpdateSchema, {
        key: 'language',
        value: 'es',
      })
    ).toThrow(/Language must be/i);

    await expect(ipc.updateSetting('theme', 'neon')).rejects.toThrow(/Theme must be/i);
    await expect(ipc.updateSetting('auto_lock_minutes', '-5')).rejects.toThrow(
      /positive integer/i
    );

    const resolvedSettings = resolveAppSettings({
      currency: 'EUR',
      language: 'invalid_lang',
      theme: 'dark',
      accent: 'invalid_accent',
      decimal_separator: ',',
      date_format: 'DD/MM/YYYY',
      auto_lock_minutes: '30',
    });
    expect(resolvedSettings.currency).toBe('EUR');
    expect(resolvedSettings.language).toBe('en');
    expect(resolvedSettings.theme).toBe('dark');
    expect(resolvedSettings.accent).toBe('emerald');
    expect(resolvedSettings.decimal_separator).toBe(',');
    expect(resolvedSettings.date_format).toBe('DD/MM/YYYY');
    expect(resolvedSettings.auto_lock_minutes).toBe(30);

    // 6. Backup store schema & BrowserLocalEngine.importBackupDb validation
    expect(() =>
      parseWithSchema(backupStoreSchema, {
        accounts: 'not-an-array',
        categories: [],
        transactions: [],
      })
    ).toThrow(/missing required tables/i);

    expect(() =>
      parseWithSchema(backupStoreSchema, {
        accounts: [{ id: 'a1', name: 'Acc', starting_balance: 100, current_balance: 100, currency: 'USD' }],
        categories: [{ id: 'c1', name: 'Cat', type: 'expense', icon: 'home', color: '#10b981' }],
        transactions: [{ id: 't1', account_id: 'a1', category_id: 'c1', amount: '100', type: 'expense', payee: 'Bad Amount Type', date: 12345 }],
      })
    ).toThrow();

    const browserEngine = new BrowserLocalEngine();
    const corruptBackupJson = JSON.stringify({
      accounts: [{ id: 'a1', name: 'Acc', starting_balance: 100, current_balance: 100, currency: 'USD' }],
      categories: [{ id: 'c1', name: 'Cat', type: 'expense', icon: 'home', color: '#10b981' }],
      transactions: [{ id: 't1', account_id: 'a1', category_id: 'c1', amount: 'not-a-number', type: 'expense', payee: 'Shop', date: '2026-10-12' }],
    });
    expect(() => browserEngine.importBackupDb(corruptBackupJson)).toThrow(
      /Invalid backup file/i
    );

    // 7. Legacy JSON backup with kind: null or omitted kind imports cleanly and infers month vs project accurately
    const legacyBackupJson = JSON.stringify({
      accounts: [{ id: 'a1', name: 'Compte MAD', starting_balance: 5000, current_balance: 5000, currency: 'MAD' }],
      categories: [{ id: 'c1', name: 'Loyer', type: 'expense', icon: 'home', color: '#10b981' }],
      projects: [
        { id: 'p-month', name: 'mois 11', target_budget: 16700, status: 'active', kind: null },
        { id: 'p-house', name: 'Maison Neuve', target_budget: 250000, status: 'active', kind: null },
        { id: 'p-maint', name: 'Maintenance Auto', target_budget: 5000, status: 'active' },
      ],
      transactions: [],
    });
    expect(browserEngine.importBackupDb(legacyBackupJson)).toBe(true);
    const restoredProjects = browserEngine.getProjects();
    expect(restoredProjects.find((p) => p.id === 'p-month')?.kind).toBe('month');
    expect(restoredProjects.find((p) => p.id === 'p-house')?.kind).toBe('project');
    expect(restoredProjects.find((p) => p.id === 'p-maint')?.kind).toBe('project');

    // 8. inferProjectKind distinguishes month names from project names starting with month substrings
    expect(inferProjectKind('mois 11')).toBe('month');
    expect(inferProjectKind('Mois de Novembre')).toBe('month');
    expect(inferProjectKind('Novembre 2026')).toBe('month');
    expect(inferProjectKind('Novembre')).toBe('month');
    expect(inferProjectKind('2026-11')).toBe('month');
    expect(inferProjectKind('11/2026')).toBe('month');
    expect(inferProjectKind('شهر 11')).toBe('month');
    expect(inferProjectKind('نوفمبر 2026')).toBe('month');

    expect(inferProjectKind('Maison Neuve')).toBe('project');
    expect(inferProjectKind('Maintenance Auto')).toBe('project');
    expect(inferProjectKind('Marché Central')).toBe('project');
    expect(inferProjectKind('Marseille Vacances')).toBe('project');
    expect(inferProjectKind('Mars Rover')).toBe('project');
    expect(inferProjectKind('Novembre', 'project')).toBe('project');
    expect(inferProjectKind('Maison Neuve', 'month')).toBe('month');

    // 9. deleteCategory works in both BrowserLocalEngine and IPC
    const localCat = browserEngine.getCategories()[0];
    const localAcc = browserEngine.getAccounts()[0];
    const localTx = await browserEngine.createTransaction({
      account_id: localAcc.id,
      category_id: localCat.id,
      amount: 350,
      type: 'expense',
      payee: 'Facture Eau',
      date: '2026-10-12',
    });
    expect(browserEngine.deleteCategory(localCat.id)).toBe(true);
    expect(browserEngine.getCategories()).toHaveLength(0);
    expect(browserEngine.deleteCategory(localCat.id)).toBe(true);
    // Updating and duplicating transaction with deleted category succeeds in BrowserLocalEngine
    const updatedLocalTx = await browserEngine.updateTransaction({
      id: localTx.id,
      amount: 400,
    });
    expect(updatedLocalTx.amount).toBe(400);
    const dupLocalTx = await browserEngine.duplicateTransaction(
      localTx.id,
      '2026-11-12',
      false,
      null
    );
    expect(dupLocalTx.amount).toBe(400);

    // IPC deleteCategory & CSV export of transaction with deleted category
    const ipcCat = await ipc.createCategory({
      name: 'Temp Category',
      type: 'expense',
      icon: 'tag',
    });
    const ipcAcc = await ipc.createAccount({
      name: 'Temp Acc',
      starting_balance: 100,
      currency: 'USD',
    });
    await ipc.createTransaction({
      account_id: ipcAcc.id,
      category_id: ipcCat.id,
      amount: 15,
      type: 'expense',
      payee: 'Orphaned CSV Payee',
      date: '2026-10-12',
    });
    expect(await ipc.deleteCategory(ipcCat.id)).toBe(true);
    expect(
      (await ipc.getCategories()).some((c) => c.id === ipcCat.id)
    ).toBe(false);
    await expect(ipc.deleteCategory('   ')).rejects.toThrow(
      /Category ID is required/i
    );
    const csvAfterDelete = await ipc.exportTransactionsCsv();
    expect(csvAfterDelete).toContain('Orphaned CSV Payee');
    expect(csvAfterDelete).toContain('Uncategorized');
    expect(csvAfterDelete).not.toContain(ipcCat.id);

    // 10. BrowserLocalEngine.loadFromStorage migrates legacy localStorage data that fails strict backupStoreSchema
    const storageMap = new Map<string, string>();
    const origLocalStorage = Object.getOwnPropertyDescriptor(
      window,
      'localStorage'
    );
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, String(v));
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      },
    });
    try {
      window.localStorage.setItem(
        'pocketclear_sqlite_mirror_v4',
        JSON.stringify({
          accounts: [
            {
              id: 'legacy-acc',
              name: 'Legacy MAD Account',
              balance: '15000', // legacy balance field instead of starting_balance/current_balance
              currency: 'MAD',
            },
          ],
          categories: [
            {
              id: 'legacy-cat',
              label: 'Loyer', // legacy label field instead of name
              type: 'expense',
              icon: '',
              color: '',
              monthly_budget: '2500',
            },
          ],
          projects: [
            {
              id: 'legacy-month',
              name: 'mois 11',
              target_budget: '16000',
              status: 'active',
              kind: null,
            },
          ],
          transactions: [
            {
              id: 'legacy-tx-1',
              account_id: 'legacy-acc',
              category_id: '', // deleted category in older schema
              project_id: 'legacy-month',
              amount: '1000',
              type: 'expense',
              payee: 'Loyer Novembre',
              date: '2026-10-12T08:00:00.000Z',
              is_recurring: 1,
            },
            {
              id: 'legacy-tx-2',
              account_id: '', // missing account_id falls back to first account
              category_id: 'legacy-cat',
              project_id: 'legacy-month',
              amount: -450, // negative legacy expense amount
              type: 'expense',
              payee: 'Facture Électricité',
              date: '15/10/2026', // DD/MM/YYYY legacy date
            },
          ],
          app_settings: {
            currency: 'MAD',
            language: 'fr',
            auto_lock_minutes: 15, // number instead of string
            pin_hash: 'null', // invalid non-Argon2id pin_hash must not lock out user
          },
        })
      );
      const hydratedEngine = new BrowserLocalEngine();
      expect(hydratedEngine.getAccounts()).toHaveLength(1);
      expect(hydratedEngine.getAccounts()[0].currency).toBe('MAD');
      expect(hydratedEngine.getAccounts()[0].current_balance).toBe(15000);
      expect(hydratedEngine.getCategories()[0].name).toBe('Loyer');
      expect(hydratedEngine.getProjects()).toHaveLength(1);
      expect(hydratedEngine.getProjects()[0].kind).toBe('month');
      expect(hydratedEngine.getTransactions()).toHaveLength(2);
      const tx1 = hydratedEngine
        .getTransactions()
        .find((t) => t.id === 'legacy-tx-1')!;
      const tx2 = hydratedEngine
        .getTransactions()
        .find((t) => t.id === 'legacy-tx-2')!;
      expect(tx1.category_id).toBe('uncategorized');
      expect(tx1.date).toBe('2026-10-12');
      expect(tx2.account_id).toBe('legacy-acc');
      expect(tx2.amount).toBe(450);
      expect(tx2.date).toBe('2026-10-15');
      expect(hydratedEngine.getSettings().language).toBe('fr');
      expect(hydratedEngine.checkAuthState().has_pin).toBe(false);
    } finally {
      if (origLocalStorage) {
        Object.defineProperty(window, 'localStorage', origLocalStorage);
      }
    }
  });
});



