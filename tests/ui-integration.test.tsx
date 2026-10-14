import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import HomePage from '@/app/page';
import { SqliteNodeEngine } from '@/lib/sqlite-node-engine';
import { setEngineAdapter } from '@/lib/ipc';

describe('End-to-End UI Integration Tests with Real SQLite Backend', () => {
  let engine: SqliteNodeEngine;

  beforeEach(() => {
    engine = new SqliteNodeEngine(':memory:');
    setEngineAdapter(engine);
  });

  it('shows First-Run Onboarding Wizard on a virgin database, supports EN/FR/AR RTL switching, and renders button-free Dashboard without Total Available or HealthGauge', async () => {
    render(<HomePage />);

    const wizard = await screen.findByTestId('onboarding-wizard');
    expect(wizard).toBeDefined();

    // Switch to Arabic (AR) and verify RTL direction
    fireEvent.click(screen.getByTestId('onboarding-lang-ar'));
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-wizard').getAttribute('dir')).toBe(
        'rtl'
      );
    });

    // Switch to French (FR)
    fireEvent.click(screen.getByTestId('onboarding-lang-fr'));
    await waitFor(() => {
      expect(screen.getByText(/Bienvenue sur PocketClear/i)).toBeDefined();
    });

    // Switch back to English (EN)
    fireEvent.click(screen.getByTestId('onboarding-lang-en'));
    await waitFor(() => {
      expect(screen.getByText(/Welcome to PocketClear/i)).toBeDefined();
    });

    // Enter account name and starting balance
    fireEvent.change(screen.getByTestId('onboarding-account-name'), {
      target: { value: 'Everyday Pocket' },
    });
    fireEvent.change(screen.getByTestId('onboarding-starting-balance'), {
      target: { value: '2400' },
    });

    // Finish onboarding
    fireEvent.click(screen.getByTestId('onboarding-submit'));

    const dashboardView = await screen.findByTestId('dashboard-view');
    expect(dashboardView).toBeDefined();

    // Verify Total Money Available card and "Can I Spend This?" gauge are removed
    expect(screen.queryByTestId('kpi-total-available')).toBeNull();
    expect(screen.queryByTestId('health-gauge')).toBeNull();

    // Verify top header add buttons are removed
    expect(screen.queryByTestId('header-add-income')).toBeNull();
    expect(screen.queryByTestId('header-add-expense')).toBeNull();

    // Verify zero <button> elements inside DashboardView
    expect(dashboardView.querySelectorAll('button').length).toBe(0);

    // Verify the 3 KPI cards and Projects Summary section exist and start at $0.00 when no month/transactions exist
    expect(screen.getByTestId('kpi-money-in')).toBeDefined();
    expect(screen.getByTestId('kpi-money-out')).toBeDefined();
    expect(screen.getByTestId('kpi-left-to-spend')).toBeDefined();
    expect(screen.getByTestId('kpi-money-in-value').textContent).toBe('$0.00');
    expect(screen.getByTestId('kpi-money-out-value').textContent).toBe('$0.00');
    expect(screen.getByTestId('kpi-left-to-spend-value').textContent).toBe(
      '$0.00'
    );
    expect(screen.getByTestId('projects-summary-section')).toBeDefined();
  });

  it('supports Worksheet ("Feuille de calcule revenus / dépenses") Month creation, clicking a Month to open its Activity Log and add expenses, and Dashboard Month/Year views + Projects Summary Table', async () => {
    engine.completeOnboarding({
      account_name: 'Compte Principal',
      starting_balance: 0,
      currency: 'MAD',
      language: 'fr',
      categories: [
        { name: 'Salaire', type: 'income', icon: 'wallet', color: '#10b981' },
        {
          name: 'Loyer & Maison',
          type: 'expense',
          icon: 'home',
          color: '#10b981',
        },
        {
          name: 'Courses',
          type: 'expense',
          icon: 'shopping-cart',
          color: '#3b82f6',
        },
      ],
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // Verify French navigation labels
    expect(screen.getByTestId('nav-worksheet').textContent).toContain(
      'Feuille de calcule revenus / dépenses'
    );
    expect(screen.getByTestId('nav-projects').textContent).toContain(
      'Suivis de projet et d’objectifs'
    );

    // 1. Navigate to "Feuille de calcule revenus / dépenses" (Worksheet)
    fireEvent.click(screen.getByTestId('nav-worksheet'));
    const worksheetView = await screen.findByTestId('worksheet-view');
    expect(worksheetView).toBeDefined();
    expect(screen.getByTestId('subtab-categories').textContent).toContain(
      'Catégorie de dépenses'
    );

    // Create a Month ("mois 11") with allocated base amount 16,700 MAD
    fireEvent.click(screen.getByTestId('new-month-btn'));
    await screen.findByTestId('month-modal');

    fireEvent.change(screen.getByTestId('month-name-input'), {
      target: { value: 'mois 11' },
    });
    fireEvent.change(screen.getByTestId('month-budget-input'), {
      target: { value: '16700' },
    });
    fireEvent.click(screen.getByTestId('month-submit-btn'));

    const monthCard = await screen.findByTestId('month-card-mois 11');
    expect(monthCard).toBeDefined();
    expect(monthCard.getAttribute('role')).toBe('button');
    expect(monthCard.textContent).toContain('16,700.00 MAD');

    // 2. Click on the created Month card ("mois 11") -> navigates to Activity Log of "mois 11"
    fireEvent.click(monthCard);
    await screen.findByTestId('transactions-view');
    const banner = await screen.findByTestId('active-entity-banner');
    expect(banner.textContent).toContain('mois 11');

    // 3. Add an expense of 1,000 MAD inside "mois 11"'s Activity Log
    fireEvent.click(screen.getByTestId('tx-add-expense-btn'));
    await screen.findByTestId('transaction-modal');

    // Project/Month selector should be pre-selected to "mois 11"
    const projectSelect = screen.getByTestId(
      'tx-project-select'
    ) as HTMLSelectElement;
    expect(projectSelect.value).not.toBe('');

    fireEvent.change(screen.getByTestId('tx-amount-input'), {
      target: { value: '1000' },
    });
    fireEvent.change(screen.getByTestId('tx-payee-input'), {
      target: { value: 'Loyer Novembre' },
    });
    fireEvent.click(screen.getByTestId('tx-recurring-checkbox'));
    fireEvent.click(screen.getByTestId('tx-submit-btn'));

    await waitFor(() => {
      expect(screen.getByText('Loyer Novembre')).toBeDefined();
      expect(screen.getByTestId('active-entity-banner').textContent).toContain(
        '15,700.00 MAD'
      );
    });

    // 4. Navigate to "Suivis de projet et d’objectifs" (Projects) — verify "Catégorie de dépenses" tab & "+ Nouvelle Catégorie" button are absent, and create a Project
    fireEvent.click(screen.getByTestId('nav-projects'));
    await screen.findByTestId('projects-view');
    expect(screen.queryByTestId('subtab-buckets')).toBeNull();
    expect(screen.queryByTestId('subtab-categories')).toBeNull();
    expect(screen.queryByTestId('new-bucket-btn')).toBeNull();
    expect(screen.queryByTestId('new-category-btn')).toBeNull();

    fireEvent.click(screen.getByTestId('new-project-btn'));
    await screen.findByTestId('project-modal');
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Achat Voiture' },
    });
    fireEvent.change(screen.getByTestId('project-budget-input'), {
      target: { value: '50000' },
    });
    fireEvent.click(screen.getByTestId('project-submit-btn'));

    const projectCard = await screen.findByTestId('project-card-Achat Voiture');
    expect(projectCard).toBeDefined();
    expect(projectCard.getAttribute('role')).toBe('button');

    // Click the Project card -> opens Activity Log for "Achat Voiture"
    fireEvent.click(projectCard);
    await screen.findByTestId('transactions-view');
    expect(screen.getByTestId('active-entity-banner').textContent).toContain(
      'Achat Voiture'
    );
    expect(screen.getByTestId('back-to-source-btn').textContent).toBe(
      'Retour aux projets'
    );

    // Project Activity Log replaces the two add buttons with a single "Contribuer" button
    expect(screen.queryByTestId('tx-add-expense-btn')).toBeNull();
    expect(screen.queryByTestId('tx-add-income-btn')).toBeNull();
    const contributeBtn = screen.getByTestId('tx-contribute-btn');
    expect(contributeBtn.textContent).toBe('Contribuer');
    expect(screen.getByTestId('tx-empty-state').textContent).toContain(
      '[Contribuer]'
    );

    // Add a 4,500 MAD contribution to "Achat Voiture"
    fireEvent.click(contributeBtn);
    const txModal = await screen.findByTestId('transaction-modal');
    expect(txModal.textContent).toContain('Contribuer au projet');
    expect(screen.queryByTestId('tx-type-income')).toBeNull();
    expect(screen.queryByTestId('tx-type-expense')).toBeNull();
    const voitureProjectId = (
      screen.getByTestId('tx-project-select') as HTMLSelectElement
    ).value;
    expect(voitureProjectId).not.toBe('');
    fireEvent.change(screen.getByTestId('tx-amount-input'), {
      target: { value: '4500' },
    });
    fireEvent.change(screen.getByTestId('tx-payee-input'), {
      target: { value: 'Apport Voiture' },
    });
    fireEvent.click(screen.getByTestId('tx-submit-btn'));

    await waitFor(() => {
      expect(screen.getByText('Apport Voiture')).toBeDefined();
    });

    // Verify "Associés" (filter-pill-projects) has explanatory tooltip
    expect(
      screen.getByTestId('filter-pill-projects').getAttribute('title')
    ).toContain('mois ou un projet');

    // Clear entity filter to return to global Activity Log, open "+ Ajouter Argent Reçu",
    // then select project "Achat Voiture" in dropdown -> must auto-switch to expense categories
    fireEvent.click(screen.getByTestId('clear-entity-filter-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('tx-add-income-btn')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('tx-add-income-btn'));
    await screen.findByTestId('transaction-modal');
    expect(screen.getByTestId('bucket-option-Salaire')).toBeDefined();

    fireEvent.change(screen.getByTestId('tx-project-select'), {
      target: { value: voitureProjectId },
    });
    await waitFor(() => {
      expect(screen.getByTestId('transaction-modal').textContent).toContain(
        'Contribuer au projet'
      );
      expect(screen.queryByTestId('tx-type-income')).toBeNull();
      expect(screen.queryByTestId('bucket-option-Salaire')).toBeNull();
      expect(screen.getByTestId('bucket-option-Loyer & Maison')).toBeDefined();
    });

    // Switch back to None ("Aucun") -> flow type toggle reappears
    fireEvent.change(screen.getByTestId('tx-project-select'), {
      target: { value: '' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('tx-type-income')).toBeDefined();
      expect(screen.getByTestId('tx-type-expense')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Annuler'));

    // 5. Navigate to Dashboard and verify Month View, Year View, and Projects Summary Table
    fireEvent.click(screen.getByTestId('nav-dashboard'));
    await screen.findByTestId('dashboard-view');

    // Month View ("Vue de mois") shows "mois 11" figures
    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '+16,700.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '1,000.00 MAD'
      );
      expect(screen.getByTestId('kpi-left-to-spend-value').textContent).toBe(
        '15,700.00 MAD'
      );
    });

    // Switch to Year View ("Vue d’année")
    fireEvent.click(screen.getByTestId('view-mode-year'));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-year-select')).toBeDefined();
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '+16,700.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '1,000.00 MAD'
      );
    });

    // Verify Projects Summary Table and Global Contribution
    const summaryTable = screen.getByTestId('projects-summary-table');
    expect(within(summaryTable).getByText('Achat Voiture')).toBeDefined();
    expect(
      screen.getByTestId('global-project-contribution').textContent
    ).toBe('4,500.00 MAD');
  });

  it('enables Argon2id PIN lock in Settings, locks app, rejects wrong PIN, and unlocks with correct PIN', async () => {
    engine.completeOnboarding({
      account_name: 'Secure Pocket',
      starting_balance: 800,
      currency: 'USD',
      language: 'en',
      categories: [
        { name: 'General', type: 'expense', icon: 'circle', color: '#10b981' },
      ],
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // Go to Settings
    fireEvent.click(screen.getByTestId('nav-settings'));
    await screen.findByTestId('settings-view');

    fireEvent.change(screen.getByTestId('settings-pin-input'), {
      target: { value: '4321' },
    });
    fireEvent.click(screen.getByTestId('settings-save-pin-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('pin-status-badge').textContent).toMatch(
        /Active/i
      );
    });

    // Click Lock Now in sidebar
    fireEvent.click(screen.getByTestId('sidebar-lock-btn'));
    const lockScreen = await screen.findByTestId('lock-screen');
    expect(lockScreen).toBeDefined();

    // Try wrong PIN
    fireEvent.change(screen.getByTestId('lock-screen-pin-input'), {
      target: { value: '0000' },
    });
    fireEvent.click(screen.getByTestId('lock-screen-unlock-btn'));

    const errText = await screen.findByTestId('lock-screen-error');
    expect(errText.textContent).toMatch(/Incorrect/i);

    // Enter correct PIN
    fireEvent.change(screen.getByTestId('lock-screen-pin-input'), {
      target: { value: '4321' },
    });
    fireEvent.click(screen.getByTestId('lock-screen-unlock-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('lock-screen')).toBeNull();
    });
  });

  it('preserves active filter pill across tab switches without breaking Expense Category ceiling display or Ctrl+D duplication', async () => {
    const acc = engine.completeOnboarding({
      account_name: 'Main Wallet',
      starting_balance: 2000,
      currency: 'USD',
      language: 'en',
      categories: [
        { name: 'Salary', type: 'income', icon: 'wallet', color: '#10b981' },
        {
          name: 'Rent & Bills',
          type: 'expense',
          icon: 'home',
          color: '#3b82f6',
          monthly_budget: 1200,
        },
      ],
    });
    const cats = engine.getCategories();
    const incomeCat = cats.find((c) => c.type === 'income')!;
    const expenseCat = cats.find((c) => c.type === 'expense')!;

    engine.createTransaction({
      account_id: acc.id,
      category_id: incomeCat.id,
      amount: 1500,
      type: 'income',
      payee: 'Acme Payroll',
      date: '2026-10-01',
    });
    engine.createTransaction({
      account_id: acc.id,
      category_id: expenseCat.id,
      amount: 850,
      type: 'expense',
      payee: 'City Landlord',
      date: '2026-10-05',
      is_recurring: true,
      recurring_interval: 'monthly',
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // Navigate to Transactions and filter by "Money In"
    fireEvent.click(screen.getByTestId('nav-transactions'));
    await screen.findByTestId('transactions-view');
    fireEvent.click(screen.getByTestId('filter-pill-income'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-pill-income').className).toContain(
        'bg-accent'
      );
    });

    // Switch to Worksheet -> Expense Categories and verify Rent & Bills category shows ONLY the allocated ceiling ($1,200.00), NOT the spent sum ($850.00)
    fireEvent.click(screen.getByTestId('nav-worksheet'));
    await screen.findByTestId('worksheet-view');
    fireEvent.click(screen.getByTestId('subtab-categories'));
    const rentBucketCard = await screen.findByTestId(
      'bucket-card-Rent & Bills'
    );
    expect(rentBucketCard.textContent).toContain('Allocated Limit • $1,200.00');
    expect(rentBucketCard.textContent).not.toContain('$850.00');

    // Switch back to Transactions and verify the "Money In" pill is still highlighted
    fireEvent.click(screen.getByTestId('nav-transactions'));
    await screen.findByTestId('transactions-view');
    expect(screen.getByTestId('filter-pill-income').className).toContain(
      'bg-accent'
    );

    // Trigger Ctrl+D shortcut to open Smart Recurring Duplication Modal
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    await screen.findByTestId('duplicate-modal');
    expect(screen.getByTestId('duplicate-modal-payee').textContent).toBe(
      'City Landlord'
    );
    expect(screen.getByTestId('duplicate-modal-account').textContent).toBe(
      'Main Wallet'
    );
    expect(screen.getByTestId('duplicate-modal-amount').textContent).toBe(
      '$850.00'
    );
  });

  it('infers legacy month entries without explicit kind, switches between multiple months and years on Dashboard, and navigates back from Activity Log', async () => {
    const acc = engine.completeOnboarding({
      account_name: 'Compte MAD',
      starting_balance: 0,
      currency: 'MAD',
      language: 'fr',
      categories: [
        { name: 'Loyer', type: 'expense', icon: 'home', color: '#10b981' },
      ],
    });
    const expCat = engine.getCategories()[0];

    // Legacy month created without explicit kind (simulating pre-migration 'mois 10 2025')
    const mOct2025 = engine.createProject({
      name: 'mois 10 2025',
      target_budget: 12000,
    });
    engine.createTransaction({
      account_id: acc.id,
      category_id: expCat.id,
      project_id: mOct2025.id,
      amount: 2000,
      type: 'expense',
      payee: 'Loyer Octobre 2025',
      date: '2025-10-05',
    });

    // Month in 2026
    const mNov2026 = engine.createProject({
      name: 'Novembre 2026',
      target_budget: 16700,
      kind: 'month',
    });
    engine.createTransaction({
      account_id: acc.id,
      category_id: expCat.id,
      project_id: mNov2026.id,
      amount: 1000,
      type: 'expense',
      payee: 'Loyer Novembre 2026',
      date: '2026-11-05',
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // Switch between months on Dashboard Month View
    const monthSelect = screen.getByTestId(
      'dashboard-month-select'
    ) as HTMLSelectElement;
    fireEvent.change(monthSelect, { target: { value: mOct2025.id } });
    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '+12,000.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '2,000.00 MAD'
      );
      expect(screen.getByTestId('kpi-left-to-spend-value').textContent).toBe(
        '10,000.00 MAD'
      );
    });

    // Switch to Year View and select 2025 vs 2026
    fireEvent.click(screen.getByTestId('view-mode-year'));
    const yearSelect = (await screen.findByTestId(
      'dashboard-year-select'
    )) as HTMLSelectElement;
    fireEvent.change(yearSelect, { target: { value: '2025' } });
    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '+12,000.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '2,000.00 MAD'
      );
    });

    // Open Worksheet, click 'mois 10 2025', then click Back to Worksheet
    fireEvent.click(screen.getByTestId('nav-worksheet'));
    await screen.findByTestId('worksheet-view');
    fireEvent.click(screen.getByTestId('month-card-mois 10 2025'));
    await screen.findByTestId('active-entity-banner');
    expect(screen.getByText('Loyer Octobre 2025')).toBeDefined();
    expect(screen.queryByText('Loyer Novembre 2026')).toBeNull();

    // Click "Voir toutes les opérations" to clear filter in place
    fireEvent.click(screen.getByTestId('clear-entity-filter-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('active-entity-banner')).toBeNull();
      expect(screen.getByText('Loyer Novembre 2026')).toBeDefined();
    });
  });

  it('handles Month extra income vs Project combined contributions, Year View KPI subtitles, and resets search query when clearing entity filter', async () => {
    const acc = engine.completeOnboarding({
      account_name: 'Compte Principal',
      starting_balance: 0,
      currency: 'MAD',
      language: 'fr',
      categories: [
        { name: 'Bonus', type: 'income', icon: 'wallet', color: '#10b981' },
        { name: 'Travaux', type: 'expense', icon: 'home', color: '#ef4444' },
      ],
    });
    const cats = engine.getCategories();
    const incCat = cats.find((c) => c.type === 'income')!;
    const expCat = cats.find((c) => c.type === 'expense')!;

    // 1. Create a Month with base 10,000 and extra income 2,000, but 0 expense
    const monthNov = engine.createProject({
      name: 'Novembre 2026',
      target_budget: 10000,
      kind: 'month',
    });
    engine.createTransaction({
      account_id: acc.id,
      category_id: incCat.id,
      project_id: monthNov.id,
      amount: 2000,
      type: 'income',
      payee: 'Prime Mensuelle',
      date: '2026-11-02',
    });

    // 2. Create a Project named "Maison Neuve" (without explicit kind to also verify inferProjectKind)
    // with target 10,000, income contribution 3,000, and expense contribution 500
    const projMaison = engine.createProject({
      name: 'Maison Neuve',
      target_budget: 10000,
    });
    expect(projMaison.kind).toBe('project');

    engine.createTransaction({
      account_id: acc.id,
      category_id: incCat.id,
      project_id: projMaison.id,
      amount: 3000,
      type: 'income',
      payee: 'Épargne Initiale',
      date: '2026-11-03',
    });
    engine.createTransaction({
      account_id: acc.id,
      category_id: expCat.id,
      project_id: projMaison.id,
      amount: 500,
      type: 'expense',
      payee: 'Acompte Architecte',
      date: '2026-11-04',
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // Verify Year View switches KPI subtitles to annual labels
    fireEvent.click(screen.getByTestId('view-mode-year'));
    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in').textContent).toContain(
        'Cumul annuel alloué et revenus'
      );
      expect(screen.getByTestId('kpi-money-out').textContent).toContain(
        'Cumul des dépenses de l’année'
      );
      expect(screen.getByTestId('kpi-left-to-spend').textContent).toContain(
        'Solde annuel restant'
      );
    });

    // Verify Dashboard Projects Summary Table shows combined contribution (3,000 + 500 = 3,500) and remaining (6,500)
    expect(
      screen.getByTestId('global-project-contribution').textContent
    ).toBe('3,500.00 MAD');
    expect(
      screen.getByTestId('projects-table-total-contribution').textContent
    ).toBe('3,500.00 MAD');
    const maisonRow = screen.getByTestId('project-summary-row-Maison Neuve');
    expect(maisonRow.textContent).toContain('3,500.00 MAD');
    expect(maisonRow.textContent).toContain('6,500.00 MAD');

    // Navigate to Worksheet and verify Month with 0 expenses + 2,000 extra income shows 0% used and 12,000 remaining
    fireEvent.click(screen.getByTestId('nav-worksheet'));
    await screen.findByTestId('worksheet-view');
    const monthCard = screen.getByTestId('month-card-Novembre 2026');
    expect(monthCard.textContent).toContain('0%');
    expect(monthCard.textContent).toContain('0.00 MAD / 12,000.00 MAD');
    expect(monthCard.textContent).toContain('12,000.00 MAD');

    // Navigate to Projects and verify "Maison Neuve" card shows 35% (3,500 / 10,000) and remaining 6,500
    fireEvent.click(screen.getByTestId('nav-projects'));
    await screen.findByTestId('projects-view');
    const maisonCard = screen.getByTestId('project-card-Maison Neuve');
    expect(maisonCard.textContent).toContain('35%');
    expect(maisonCard.textContent).toContain('3,500.00 MAD');
    expect(maisonCard.textContent).toContain('6,500.00 MAD');

    // Click "Maison Neuve" card -> Activity Log banner shows consistent 3,500 contribution and 6,500 remaining
    fireEvent.click(maisonCard);
    const banner = await screen.findByTestId('active-entity-banner');
    expect(banner.textContent).toContain('3,500.00 MAD');
    expect(banner.textContent).toContain('6,500.00 MAD');

    // Type a search query, then click "Voir toutes les opérations" -> search input must reset
    const searchInput = screen.getByTestId(
      'tx-search-input'
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'Architecte' } });
    expect(searchInput.value).toBe('Architecte');

    fireEvent.click(screen.getByTestId('clear-entity-filter-btn'));
    await waitFor(() => {
      expect(
        (screen.getByTestId('tx-search-input') as HTMLInputElement).value
      ).toBe('');
    });
  });

  it('displays only allocated ceiling (no spent sum) in Worksheet -> Catégorie de dépenses, allows deleting categories even with existing transactions, and hides category controls in ProjectsView', async () => {
    const acc = engine.completeOnboarding({
      account_name: 'Compte Test',
      starting_balance: 5000,
      currency: 'MAD',
      language: 'fr',
      categories: [
        {
          name: 'Salaire',
          type: 'income',
          icon: 'wallet',
          color: '#10b981',
        },
        {
          name: 'Alimentation',
          type: 'expense',
          icon: 'shopping-cart',
          color: '#10b981',
          monthly_budget: 3000,
        },
        {
          name: 'Loisirs',
          type: 'expense',
          icon: 'coffee',
          color: '#f59e0b',
          monthly_budget: null,
        },
      ],
    });
    const cats = engine.getCategories();
    const alimCat = cats.find((c) => c.name === 'Alimentation')!;
    const loisirsCat = cats.find((c) => c.name === 'Loisirs')!;

    // Add expense transactions to both 'Alimentation' (750 MAD) and 'Loisirs' (250 MAD)
    engine.createTransaction({
      account_id: acc.id,
      category_id: alimCat.id,
      amount: 750,
      type: 'expense',
      payee: 'Marjane Market',
      date: '2026-10-10',
    });
    engine.createTransaction({
      account_id: acc.id,
      category_id: loisirsCat.id,
      amount: 250,
      type: 'expense',
      payee: 'Cinéma Atlas',
      date: '2026-10-11',
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // 1. Open Worksheet -> Catégorie de dépenses
    fireEvent.click(screen.getByTestId('nav-worksheet'));
    await screen.findByTestId('worksheet-view');
    fireEvent.click(screen.getByTestId('subtab-categories'));

    const alimCard = await screen.findByTestId('bucket-card-Alimentation');
    const loisirsCard = await screen.findByTestId('bucket-card-Loisirs');

    // Verify Alimentation shows ONLY the allocated ceiling (3,000.00 MAD) and NOT the spent sum (750.00 MAD or 'Argent Dépensé')
    expect(alimCard.textContent).toContain('Plafond alloué • 3,000.00 MAD');
    expect(alimCard.textContent).not.toContain('750.00 MAD');
    expect(alimCard.textContent).not.toContain('Argent Dépensé');

    // Verify Loisirs (no budget limit) shows 'Aucun plafond' and NOT 'Argent Dépensé' or '250.00 MAD' or '0.00 MAD'
    expect(loisirsCard.textContent).toContain('Aucun plafond');
    expect(loisirsCard.textContent).not.toContain('Argent Dépensé');
    expect(loisirsCard.textContent).not.toContain('250.00 MAD');
    expect(loisirsCard.textContent).not.toContain('0.00 MAD');

    // 2. Delete both expense categories ('Alimentation' and 'Loisirs') while 'Salaire' (income) still exists
    fireEvent.click(screen.getByTestId('delete-bucket-Alimentation'));
    await waitFor(() => {
      expect(screen.queryByTestId('bucket-card-Alimentation')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('delete-bucket-Loisirs'));
    await waitFor(() => {
      expect(screen.queryByTestId('bucket-card-Loisirs')).toBeNull();
    });

    // 3. Verify existing transactions are still visible in Activity Log and adding a new expense does NOT show or assign the 'Salaire' income category
    fireEvent.click(screen.getByTestId('nav-transactions'));
    await screen.findByTestId('transactions-view');
    expect(screen.getByText('Marjane Market')).toBeDefined();
    expect(screen.getByText('Cinéma Atlas')).toBeDefined();

    fireEvent.click(screen.getByTestId('tx-add-expense-btn'));
    await screen.findByTestId('transaction-modal');
    expect(screen.queryByTestId('bucket-option-Salaire')).toBeNull();
    fireEvent.change(screen.getByTestId('tx-amount-input'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByTestId('tx-payee-input'), {
      target: { value: 'Café Central' },
    });
    fireEvent.click(screen.getByTestId('tx-submit-btn'));

    await waitFor(() => {
      expect(screen.getByText('Café Central')).toBeDefined();
    });
    const cafeTx = engine
      .getTransactions()
      .find((t) => t.payee === 'Café Central')!;
    expect(cafeTx.category_id).toBe('uncategorized');
    expect(cafeTx.category_name).toBeUndefined();

    // 4. Verify Suivis de projet et d'objectifs (ProjectsView) has neither the Catégorie de dépenses tab nor the + Nouvelle Catégorie button
    fireEvent.click(screen.getByTestId('nav-projects'));
    await screen.findByTestId('projects-view');
    expect(screen.queryByTestId('subtab-buckets')).toBeNull();
    expect(screen.queryByTestId('subtab-categories')).toBeNull();
    expect(screen.queryByTestId('new-bucket-btn')).toBeNull();
    expect(screen.queryByTestId('new-category-btn')).toBeNull();

    // 5. Verify Dashboard aggregates expenses from multiple deleted categories into a single 'Uncategorized' slice
    fireEvent.click(screen.getByTestId('nav-dashboard'));
    await screen.findByTestId('dashboard-view');
    const uncategorizedSlices = screen.getAllByTestId(
      'breakdown-slice-Uncategorized'
    );
    expect(uncategorizedSlices).toHaveLength(1);
    expect(uncategorizedSlices[0].textContent).toContain('1,120.00 MAD');
  });

  it('resets Reste à Dépenser ce Mois to 0.00 MAD when all months, projects, and transactions are deleted even if onboarding starting_balance was 16,000 MAD', async () => {
    const acc = engine.completeOnboarding({
      account_name: 'Compte Principal',
      starting_balance: 16000,
      currency: 'MAD',
      language: 'fr',
      categories: [
        { name: 'Salaire', type: 'income', icon: 'wallet', color: '#10b981' },
        { name: 'Courses', type: 'expense', icon: 'shopping-cart', color: '#3b82f6' },
      ],
    });
    const expCat = engine.getCategories().find((c) => c.type === 'expense')!;

    // Create a Month ("mois 11") with 16,000 MAD and a Project ("Vacances") with 5,000 MAD, plus transactions
    const mNov = engine.createProject({
      name: 'mois 11',
      target_budget: 16000,
      kind: 'month',
    });
    const pVac = engine.createProject({
      name: 'Vacances',
      target_budget: 5000,
      kind: 'project',
    });
    const tx1 = engine.createTransaction({
      account_id: acc.id,
      category_id: expCat.id,
      project_id: mNov.id,
      amount: 1200,
      type: 'expense',
      payee: 'Supermarché',
      date: '2026-10-10',
    });
    const tx2 = engine.createTransaction({
      account_id: acc.id,
      category_id: expCat.id,
      project_id: pVac.id,
      amount: 800,
      type: 'expense',
      payee: 'Épargne Vacances',
      date: '2026-10-11',
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // Initially, Dashboard shows "mois 11" (16,000 in, 1,200 out, 14,800 left to spend)
    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '+16,000.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '1,200.00 MAD'
      );
      expect(screen.getByTestId('kpi-left-to-spend-value').textContent).toBe(
        '14,800.00 MAD'
      );
    });

    // 1. Delete all months in "Feuille de calcule revenus / dépenses" and delete the month's transaction tx1
    fireEvent.click(screen.getByTestId('nav-worksheet'));
    await screen.findByTestId('worksheet-view');
    fireEvent.click(screen.getByTestId('delete-month-mois 11'));
    await waitFor(() => {
      expect(screen.getByTestId('months-empty-state')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('nav-transactions'));
    await screen.findByTestId('transactions-view');
    fireEvent.click(screen.getByTestId(`delete-tx-${tx1.id}`));
    const confirmModal1 = await screen.findByTestId('delete-confirm-modal');
    const deleteBtns1 = within(confirmModal1).getAllByRole('button');
    fireEvent.click(deleteBtns1[deleteBtns1.length - 1]);
    await waitFor(() => {
      expect(screen.queryByTestId(`tx-row-${tx1.id}`)).toBeNull();
    });

    // While Mois (0) is empty and Project "Vacances" (with 800 MAD contribution tx2) still exists,
    // Dashboard Month View ("Mois en cours" fallback) must NOT leak the project contribution into monthly KPI cards!
    fireEvent.click(screen.getByTestId('nav-dashboard'));
    await screen.findByTestId('dashboard-view');
    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(screen.getByTestId('kpi-left-to-spend-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(
        screen.getByTestId('global-project-contribution').textContent
      ).toBe('800.00 MAD');
    });

    // 2. Delete all projects in "Suivis de projet et d'objectifs"
    fireEvent.click(screen.getByTestId('nav-projects'));
    await screen.findByTestId('projects-view');
    fireEvent.click(screen.getByTestId('delete-project-Vacances'));
    await waitFor(() => {
      expect(screen.getByTestId('projects-empty-state')).toBeDefined();
    });

    // 3. Delete remaining transaction tx2 in "Journal d'activité"
    fireEvent.click(screen.getByTestId('nav-transactions'));
    await screen.findByTestId('transactions-view');
    fireEvent.click(screen.getByTestId(`delete-tx-${tx2.id}`));
    const confirmModal2 = await screen.findByTestId('delete-confirm-modal');
    const deleteBtns2 = within(confirmModal2).getAllByRole('button');
    fireEvent.click(deleteBtns2[deleteBtns2.length - 1]);
    await waitFor(() => {
      expect(screen.queryByTestId(`tx-row-${tx2.id}`)).toBeNull();
    });
    expect(screen.getByTestId('tx-empty-state')).toBeDefined();

    // 4. Return to Dashboard ("Tableau de bord"): all 3 KPI cards MUST be 0.00 MAD (both Month View and Year View)
    fireEvent.click(screen.getByTestId('nav-dashboard'));
    await screen.findByTestId('dashboard-view');

    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(screen.getByTestId('kpi-left-to-spend-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(
        screen.getByTestId('global-project-contribution').textContent
      ).toBe('0.00 MAD');
    });

    // Switch to Year View and verify it is also 0.00 MAD
    fireEvent.click(screen.getByTestId('view-mode-year'));
    await waitFor(() => {
      expect(screen.getByTestId('kpi-money-in-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(screen.getByTestId('kpi-money-out-value').textContent).toBe(
        '0.00 MAD'
      );
      expect(screen.getByTestId('kpi-left-to-spend-value').textContent).toBe(
        '0.00 MAD'
      );
    });
  });

  it('never stays stuck on "Loading local database..." even if getDashboardSummary rejects or IPC methods return null during initial hydration', async () => {
    engine.completeOnboarding({
      account_name: 'Resilient Pocket',
      starting_balance: 1000,
      currency: 'MAD',
      language: 'fr',
      categories: [
        { name: 'Courses', type: 'expense', icon: 'shopping-cart', color: '#10b981' },
      ],
    });

    const origGetSummary = engine.getDashboardSummary.bind(engine);
    const origGetSettings = engine.getSettings.bind(engine);
    const origCheckAuth = engine.checkAuthState.bind(engine);
    let shouldFail = true;
    engine.getDashboardSummary = (refDate?: string) => {
      if (shouldFail) {
        throw new Error('Simulated transient summary failure');
      }
      return origGetSummary(refDate);
    };
    engine.getSettings = () => {
      if (shouldFail) {
        return null as unknown as Record<string, string>;
      }
      return origGetSettings();
    };
    engine.checkAuthState = () => {
      if (shouldFail) {
        return null as unknown as ReturnType<typeof origCheckAuth>;
      }
      return origCheckAuth();
    };

    render(<HomePage />);

    // Must transition past "Loading local database..." and render DashboardView via FALLBACK_SUMMARY
    const dashboardView = await screen.findByTestId('dashboard-view');
    expect(dashboardView).toBeDefined();
    expect(screen.queryByText('Loading local database...')).toBeNull();

    shouldFail = false;
  });

  it('navigates to User Guide & Security Policy view, switches between Detailed User Guide and Security Policy tabs across FR/EN/AR, and renders brand logo and banner', async () => {
    engine.completeOnboarding({
      account_name: 'Poche Principale',
      starting_balance: 2000,
      currency: 'MAD',
      language: 'fr',
      categories: [
        { name: 'Courses', type: 'expense', icon: 'shopping-cart', color: '#10b981' },
      ],
    });

    render(<HomePage />);
    await screen.findByTestId('dashboard-view');

    // Verify sidebar brand logo and Dashboard hero banner
    const sidebarLogo = screen.getByTestId('sidebar-brand-logo') as HTMLImageElement;
    expect(sidebarLogo.getAttribute('src')).toBe('/logo.jpg');
    expect(screen.getByTestId('dashboard-hero-banner')).toBeDefined();

    // Navigate to Guide & Sécurité
    const navGuide = screen.getByTestId('nav-guide');
    expect(navGuide.textContent).toContain('Guide & Sécurité');
    fireEvent.click(navGuide);

    const guideView = await screen.findByTestId('guide-security-view');
    expect(guideView).toBeDefined();

    // Verify banner and logo in Guide view
    expect(
      (screen.getByTestId('guide-hero-banner-img') as HTMLImageElement).getAttribute('src')
    ).toBe('/banner.png');
    expect(
      (screen.getByTestId('guide-brand-logo-img') as HTMLImageElement).getAttribute('src')
    ).toBe('/logo.jpg');

    // Verify User Guide content is displayed by default
    expect(screen.getByTestId('user-guide-content')).toBeDefined();
    expect(screen.getByTestId('guide-card-onboarding')).toBeDefined();
    expect(screen.getByTestId('guide-card-worksheet')).toBeDefined();
    expect(screen.getByTestId('guide-card-projects')).toBeDefined();

    // Switch to Security Policy tab
    fireEvent.click(screen.getByTestId('guide-tab-security'));
    const secContent = await screen.findByTestId('security-policy-content');
    expect(secContent).toBeDefined();
    expect(screen.getByTestId('security-pillar-sqlite-wal')).toBeDefined();
    expect(screen.getByTestId('security-pillar-argon2id')).toBeDefined();
    expect(screen.getByTestId('security-pillar-autolock')).toBeDefined();
    expect(screen.getByTestId('security-pillar-csp')).toBeDefined();
    expect(screen.getByTestId('security-pillar-backup-integrity')).toBeDefined();

    // Switch language to Arabic (AR) and verify localized Security Policy
    fireEvent.click(screen.getByTestId('lang-switch-ar'));
    await waitFor(() => {
      expect(screen.getByTestId('nav-guide').textContent).toContain('دليل المستخدم والأمان');
    });

    // Switch language to English (EN) and back to User Guide tab
    fireEvent.click(screen.getByTestId('lang-switch-en'));
    await waitFor(() => {
      expect(screen.getByTestId('nav-guide').textContent).toContain('User Guide & Security');
    });
    fireEvent.click(screen.getByTestId('guide-tab-manual'));
    await waitFor(() => {
      expect(screen.getByTestId('user-guide-content')).toBeDefined();
    });
  });
});


