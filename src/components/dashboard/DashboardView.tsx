'use client';

/**
 * @file DashboardView.tsx
 * @description Read-only analytical dashboard for PocketClear (zero `<button>` elements).
 * Features:
 * - Brand Hero Banner (`/banner.png` & `/logo.jpg`)
 * - Month View vs Year View period selector (`<input type="radio">` & `<select>`)
 * - 3 Core KPI Cards (Money In, Money Out, Left to Spend)
 * - Top 5 Categories + Other Donut Chart & Monthly Cashflow Bar Chart
 * - Projects Summary Table & Global Contribution total
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  FolderKanban,
  PiggyBank,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '@/context/AppContext';
import { BucketIcon } from '@/components/ui/BucketIcon';
import { CategoryBreakdown, MonthlyCashflow, Transaction } from '@/types/finance';
import {
  cn,
  extractYearFromMonthOrDate,
  inferProjectKind,
  roundCents,
} from '@/lib/utils';

type DashboardViewMode = 'month' | 'year';

export function DashboardView() {
  const {
    summary,
    projects,
    categories,
    transactions,
    allTransactions,
    t,
    formatAmount,
  } = useApp();

  const txPool = allTransactions.length > 0 ? allTransactions : transactions;

  // Separate worksheet months ('month') from project/goal tracking ('project')
  const monthEntries = useMemo(
    () =>
      projects.filter((p) => inferProjectKind(p.name, p.kind) === 'month'),
    [projects]
  );

  const projectEntries = useMemo(
    () =>
      projects.filter((p) => inferProjectKind(p.name, p.kind) === 'project'),
    [projects]
  );

  const [viewMode, setViewMode] = useState<DashboardViewMode>('month');
  const [selectedMonthId, setSelectedMonthId] = useState<string>('');
  const currentYear = String(new Date().getFullYear());
  const [selectedYear, setSelectedYear] = useState<string>(currentYear);

  // Keep selectedMonthId synchronized with available worksheet months
  useEffect(() => {
    if (monthEntries.length > 0) {
      if (!selectedMonthId || !monthEntries.some((m) => m.id === selectedMonthId)) {
        setSelectedMonthId(monthEntries[0].id);
      }
    } else if (selectedMonthId !== 'calendar_current') {
      setSelectedMonthId('calendar_current');
    }
  }, [monthEntries, selectedMonthId]);

  // Available years derived from worksheet months and transaction dates
  const availableYears = useMemo(() => {
    const yearSet = new Set<string>([currentYear]);
    for (const m of monthEntries) {
      const mTxDates = txPool
        .filter((tx) => tx.project_id === m.id)
        .map((tx) => tx.date);
      yearSet.add(extractYearFromMonthOrDate(m.name, m.created_at, mTxDates));
    }
    for (const tx of txPool) {
      if (tx.date && tx.date.length >= 4) {
        yearSet.add(tx.date.slice(0, 4));
      }
    }
    return Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  }, [monthEntries, txPool, currentYear]);

  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  const buildCategoryBreakdown = useMemo(() => {
    const catMap = new Map(categories.map((c) => [c.id, c]));
    return (expenseTxs: Transaction[]): CategoryBreakdown[] => {
      const totalOut = roundCents(
        expenseTxs.reduce((acc, tx) => acc + tx.amount, 0)
      );
      if (totalOut <= 0) return [];

      const byCat = new Map<string, number>();
      for (const tx of expenseTxs) {
        const key = catMap.has(tx.category_id)
          ? tx.category_id
          : 'uncategorized';
        byCat.set(key, (byCat.get(key) || 0) + tx.amount);
      }

      const sorted = Array.from(byCat.entries())
        .map(([category_id, amount]) => {
          const cat = catMap.get(category_id);
          return {
            category_id,
            name: cat?.name || 'Uncategorized',
            color: cat?.color || '#64748b',
            icon: cat?.icon || 'circle-dot',
            amount: roundCents(amount),
            percentage: roundCents((amount / totalOut) * 100),
          };
        })
        .sort((a, b) => b.amount - a.amount);

      if (sorted.length <= 5) return sorted;
      const top5 = sorted.slice(0, 5);
      const otherAmount = roundCents(
        sorted.slice(5).reduce((acc, item) => acc + item.amount, 0)
      );
      return [
        ...top5,
        {
          category_id: 'other',
          name: 'Other',
          color: '#94a3b8',
          icon: 'more-horizontal',
          amount: otherAmount,
          percentage: roundCents((otherAmount / totalOut) * 100),
        },
      ];
    };
  }, [categories]);

  // Compute active dashboard metrics for Month View vs Year View
  const activeMetrics = useMemo(() => {
    if (!summary) {
      return {
        moneyIn: 0,
        moneyOut: 0,
        leftToSpend: 0,
        categoryBreakdown: [] as CategoryBreakdown[],
        cashflow: [] as MonthlyCashflow[],
      };
    }

    const projectIdsSet = new Set(projectEntries.map((p) => p.id));
    const hasProjectTransactions =
      projectIdsSet.size > 0 &&
      txPool.some((tx) => Boolean(tx.project_id && projectIdsSet.has(tx.project_id)));

    const fallbackCashflow: MonthlyCashflow[] = hasProjectTransactions
      ? summary.monthly_cashflow.map((slot) => {
          const slotTxs = txPool.filter(
            (tx) =>
              (!tx.project_id || !projectIdsSet.has(tx.project_id)) &&
              tx.date.slice(0, 7) === slot.month
          );
          return {
            month: slot.month,
            label: slot.label,
            money_in: roundCents(
              slotTxs
                .filter((tx) => tx.type === 'income')
                .reduce((acc, tx) => acc + tx.amount, 0)
            ),
            money_out: roundCents(
              slotTxs
                .filter((tx) => tx.type === 'expense')
                .reduce((acc, tx) => acc + tx.amount, 0)
            ),
          };
        })
      : summary.monthly_cashflow;

    if (viewMode === 'month') {
      const selectedMonth =
        monthEntries.find((m) => m.id === selectedMonthId) ?? monthEntries[0];
      if (selectedMonth) {
        const monthTxs = txPool.filter(
          (tx) => tx.project_id === selectedMonth.id
        );
        const expenseTxs = monthTxs.filter((tx) => tx.type === 'expense');
        const moneyIn = roundCents(
          selectedMonth.target_budget + selectedMonth.income_amount
        );
        const moneyOut = roundCents(selectedMonth.spent_amount);
        const leftToSpend = roundCents(moneyIn - moneyOut);

        const cashflow: MonthlyCashflow[] = monthEntries
          .slice(0, 12)
          .reverse()
          .map((m) => ({
            month: m.id,
            label: m.name,
            money_in: roundCents(m.target_budget + m.income_amount),
            money_out: roundCents(m.spent_amount),
          }));

        return {
          moneyIn,
          moneyOut,
          leftToSpend,
          categoryBreakdown: buildCategoryBreakdown(expenseTxs),
          cashflow,
        };
      }

      // Fallback when no worksheet month exists yet: current calendar month excluding project contributions
      if (hasProjectTransactions) {
        const currentMonthPrefix =
          summary.monthly_cashflow[summary.monthly_cashflow.length - 1]?.month ||
          new Date().toISOString().slice(0, 7);
        const currentMonthTxs = txPool.filter(
          (tx) =>
            (!tx.project_id || !projectIdsSet.has(tx.project_id)) &&
            tx.date.slice(0, 7) === currentMonthPrefix
        );
        const moneyIn = roundCents(
          currentMonthTxs
            .filter((tx) => tx.type === 'income')
            .reduce((acc, tx) => acc + tx.amount, 0)
        );
        const moneyOut = roundCents(
          currentMonthTxs
            .filter((tx) => tx.type === 'expense')
            .reduce((acc, tx) => acc + tx.amount, 0)
        );
        return {
          moneyIn,
          moneyOut,
          leftToSpend: roundCents(moneyIn - moneyOut),
          categoryBreakdown: buildCategoryBreakdown(
            currentMonthTxs.filter((tx) => tx.type === 'expense')
          ),
          cashflow: fallbackCashflow,
        };
      }

      const moneyIn = roundCents(summary.money_in_this_month);
      const moneyOut = roundCents(summary.money_out_this_month);
      return {
        moneyIn,
        moneyOut,
        leftToSpend: roundCents(moneyIn - moneyOut),
        categoryBreakdown: summary.category_breakdown,
        cashflow: fallbackCashflow,
      };
    }

    // Year View ('year')
    const monthsInYear = monthEntries.filter((m) => {
      const mTxDates = txPool
        .filter((tx) => tx.project_id === m.id)
        .map((tx) => tx.date);
      return (
        extractYearFromMonthOrDate(m.name, m.created_at, mTxDates) ===
        selectedYear
      );
    });

    const monthIdsInYear = new Set(monthsInYear.map((m) => m.id));

    // Transactions belonging to worksheet months of this year, or unlinked transactions dated in this year
    const yearTxs = txPool.filter((tx) => {
      if (tx.project_id && monthIdsInYear.has(tx.project_id)) return true;
      if (tx.project_id && projectIdsSet.has(tx.project_id)) return false;
      if (!tx.project_id && tx.date.startsWith(selectedYear)) return true;
      return false;
    });

    const allocatedFromMonths = monthsInYear.reduce(
      (acc, m) => acc + m.target_budget,
      0
    );
    const incomeFromTxs = yearTxs
      .filter((tx) => tx.type === 'income')
      .reduce((acc, tx) => acc + tx.amount, 0);
    const expenseFromTxs = yearTxs
      .filter((tx) => tx.type === 'expense')
      .reduce((acc, tx) => acc + tx.amount, 0);

    const moneyIn = roundCents(allocatedFromMonths + incomeFromTxs);
    const moneyOut = roundCents(expenseFromTxs);
    const leftToSpend = roundCents(moneyIn - moneyOut);

    const cashflow: MonthlyCashflow[] =
      monthsInYear.length > 0
        ? monthsInYear
            .slice()
            .reverse()
            .map((m) => ({
              month: m.id,
              label: m.name,
              money_in: roundCents(m.target_budget + m.income_amount),
              money_out: roundCents(m.spent_amount),
            }))
        : fallbackCashflow;

    return {
      moneyIn,
      moneyOut,
      leftToSpend,
      categoryBreakdown: buildCategoryBreakdown(
        yearTxs.filter((tx) => tx.type === 'expense')
      ),
      cashflow,
    };
  }, [
    summary,
    viewMode,
    monthEntries,
    projectEntries,
    selectedMonthId,
    selectedYear,
    txPool,
    buildCategoryBreakdown,
  ]);

  // Global project contribution summary
  const projectsSummary = useMemo(() => {
    const rows = projectEntries.map((p) => {
      const contribution = roundCents(p.spent_amount + p.income_amount);
      const remaining = roundCents(Math.max(0, p.target_budget - contribution));
      const pct =
        p.target_budget > 0
          ? Math.min(100, Math.round((contribution / p.target_budget) * 100))
          : 0;
      return {
        ...p,
        contribution,
        remaining,
        pct,
      };
    });

    const totalContribution = roundCents(
      rows.reduce((acc, r) => acc + r.contribution, 0)
    );
    const totalTarget = roundCents(
      rows.reduce((acc, r) => acc + r.target_budget, 0)
    );
    const totalRemaining = roundCents(
      rows.reduce((acc, r) => acc + r.remaining, 0)
    );

    return {
      rows,
      totalContribution,
      totalTarget,
      totalRemaining,
    };
  }, [projectEntries]);

  if (!summary) return null;

  return (
    <div className="space-y-6" data-testid="dashboard-view">
      {/* Visual Brand Banner (Zero <button> elements) */}
      <section
        data-testid="dashboard-hero-banner"
        className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-white shadow-xs"
      >
        <div className="relative h-28 sm:h-36 w-full overflow-hidden">
          <img
            src="/banner.png"
            alt={t.appName}
            className="w-full h-full object-cover object-center opacity-50"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/60 to-transparent" />
          <div className="absolute inset-0 px-5 flex items-center gap-4">
            <img
              src="/logo.jpg"
              alt={t.appName}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border border-white/20 shadow-lg bg-slate-950 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight truncate">
                {t.appName}
              </h1>
              <p className="text-xs text-slate-300 truncate mt-0.5">
                {t.appTagline}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Period Selector Bar: Month View (sourced from Worksheet) vs Year View (Zero <button> tags) */}
      <section
        data-testid="dashboard-period-controls"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div
            role="radiogroup"
            aria-label="Dashboard View Mode"
            className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-1"
          >
            <label
              data-testid="view-mode-month"
              className={cn(
                'cursor-pointer px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all select-none',
                viewMode === 'month'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              )}
            >
              <input
                type="radio"
                name="dashboard-view-mode"
                value="month"
                checked={viewMode === 'month'}
                onChange={() => setViewMode('month')}
                className="sr-only"
              />
              {t.dashboard.viewModeMonth}
            </label>

            <label
              data-testid="view-mode-year"
              className={cn(
                'cursor-pointer px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all select-none',
                viewMode === 'year'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              )}
            >
              <input
                type="radio"
                name="dashboard-view-mode"
                value="year"
                checked={viewMode === 'year'}
                onChange={() => setViewMode('year')}
                className="sr-only"
              />
              {t.dashboard.viewModeYear}
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {viewMode === 'month' ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor="dashboard-month-select"
                className="text-xs font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap"
              >
                {t.dashboard.selectMonthLabel}
              </label>
              <select
                id="dashboard-month-select"
                data-testid="dashboard-month-select"
                value={selectedMonthId}
                onChange={(e) => setSelectedMonthId(e.target.value)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {monthEntries.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({formatAmount(m.target_budget)})
                  </option>
                ))}
                {monthEntries.length === 0 && (
                  <option value="calendar_current">
                    {t.dashboard.currentMonthDefault}
                  </option>
                )}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label
                htmlFor="dashboard-year-select"
                className="text-xs font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap"
              >
                {t.dashboard.selectYearLabel}
              </label>
              <select
                id="dashboard-year-select"
                data-testid="dashboard-year-select"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Main KPI Cards (3 cards: Money In, Money Out, Left to Spend) */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Money In (Month or Year) */}
        <div
          data-testid="kpi-money-in"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">
              {viewMode === 'year'
                ? t.dashboard.moneyInYear
                : t.dashboard.moneyInMonth}
            </span>
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          </div>
          <p
            data-testid="kpi-money-in-value"
            className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400"
          >
            {formatAmount(activeMetrics.moneyIn, true)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {viewMode === 'year'
              ? t.dashboard.moneyInYearSub
              : t.dashboard.moneyInMonthSub}
          </p>
        </div>

        {/* Card 2: Money Out (Month or Year) */}
        <div
          data-testid="kpi-money-out"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">
              {viewMode === 'year'
                ? t.dashboard.moneyOutYear
                : t.dashboard.moneyOutMonth}
            </span>
            <ArrowDownRight className="w-4 h-4 text-rose-500" />
          </div>
          <p
            data-testid="kpi-money-out-value"
            className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-rose-600 dark:text-rose-400"
          >
            {formatAmount(activeMetrics.moneyOut)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {viewMode === 'year'
              ? t.dashboard.moneyOutYearSub
              : t.dashboard.moneyOutMonthSub}
          </p>
        </div>

        {/* Card 3: Left to Spend (Month or Year) */}
        <div
          data-testid="kpi-left-to-spend"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">
              {viewMode === 'year'
                ? t.dashboard.leftToSpendYear
                : t.dashboard.leftToSpendCard}
            </span>
            <PiggyBank className="w-4 h-4 text-indigo-500" />
          </div>
          <p
            data-testid="kpi-left-to-spend-value"
            className={cn(
              'text-2xl font-extrabold font-mono tabular-nums tracking-tight',
              activeMetrics.leftToSpend < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            )}
          >
            {formatAmount(activeMetrics.leftToSpend)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {viewMode === 'year'
              ? t.dashboard.leftToSpendYearSub
              : t.dashboard.leftToSpendSub}
          </p>
        </div>
      </section>

      {/* Visual Analytics Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart: Where Did My Money Go? (Top 5 + Other) */}
        <div
          data-testid="chart-money-flow"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs flex flex-col justify-between"
        >
          <div>
            <h3 className="text-base font-bold tracking-tight">
              {t.dashboard.whereMoneyWent}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.dashboard.whereMoneyWentSub}
            </p>
          </div>

          {activeMetrics.categoryBreakdown.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">
              {t.dashboard.emptyChart}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center mt-4">
              <div className="h-56 w-full min-w-[180px]">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={100}
                  minHeight={180}
                >
                  <PieChart>
                    <Pie
                      data={activeMetrics.categoryBreakdown}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={82}
                      paddingAngle={3}
                    >
                      {activeMetrics.categoryBreakdown.map((entry) => (
                        <Cell key={entry.category_id} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(
                        val: number,
                        _name: string,
                        props: { payload?: { percentage?: number } }
                      ) => [
                        `${formatAmount(Number(val))} (${props?.payload?.percentage ?? 0}%)`,
                        '',
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2.5">
                {activeMetrics.categoryBreakdown.map((item) => (
                  <div
                    key={item.category_id}
                    data-testid={`breakdown-slice-${item.name}`}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: item.color }}
                      >
                        <BucketIcon name={item.icon} className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-semibold truncate">
                        {item.name === 'Other' ? t.common.other : item.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                      <span className="font-bold">
                        {formatAmount(item.amount)}
                      </span>
                      <span className="text-slate-400 w-11 text-right">
                        {item.percentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bar Chart: Money In vs Money Out Timeline */}
        <div
          data-testid="chart-cashflow-timeline"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold tracking-tight">
                {t.dashboard.timelineTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t.dashboard.timelineSub}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                {t.common.moneyIn}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                {t.common.moneyOut}
              </span>
            </div>
          </div>

          <div className="h-56 w-full mt-4">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={100}
              minHeight={180}
            >
              <BarChart data={activeMetrics.cashflow}>
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  width={55}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatAmount(Number(value)),
                    name === 'money_in' ? t.common.moneyIn : t.common.moneyOut,
                  ]}
                />
                <Bar
                  dataKey="money_in"
                  fill="#10b981"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="money_out"
                  fill="#f43f5e"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Projects Summary Table & Global Contribution */}
      <section
        data-testid="projects-summary-section"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight">
                {t.dashboard.projectsSummaryTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t.dashboard.projectsSummarySub}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 flex items-center justify-between sm:justify-end gap-4">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              {t.dashboard.globalContributionLabel}
            </span>
            <span
              data-testid="global-project-contribution"
              className="text-lg font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400"
            >
              {formatAmount(projectsSummary.totalContribution)}
            </span>
          </div>
        </div>

        {projectsSummary.rows.length === 0 ? (
          <div
            data-testid="projects-summary-empty"
            className="py-8 text-center text-sm text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl"
          >
            {t.dashboard.emptyProjectsSummary}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              data-testid="projects-summary-table"
              className="w-full text-sm text-start"
            >
              <thead className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border-y border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">{t.dashboard.colProjectName}</th>
                  <th className="py-3 px-4">{t.dashboard.colProjectStatus}</th>
                  <th className="py-3 px-4 text-end">
                    {t.dashboard.colTargetBudget}
                  </th>
                  <th className="py-3 px-4 text-end">
                    {t.dashboard.colContribution}
                  </th>
                  <th className="py-3 px-4 text-end">
                    {t.dashboard.colRemaining}
                  </th>
                  <th className="py-3 px-4">{t.dashboard.colProgress}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {projectsSummary.rows.map((proj) => {
                  const statusLabel =
                    proj.status === 'completed'
                      ? t.common.completed
                      : proj.status === 'paused'
                      ? t.common.paused
                      : t.common.active;
                  return (
                    <tr
                      key={proj.id}
                      data-testid={`project-summary-row-${proj.name}`}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-4 font-bold">{proj.name}</td>
                      <td className="py-3 px-4">
                        <span
                          className={cn(
                            'inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full',
                            proj.status === 'active' &&
                              'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                            proj.status === 'completed' &&
                              'bg-blue-500/15 text-blue-600 dark:text-blue-400',
                            proj.status === 'paused' &&
                              'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          )}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold">
                        {formatAmount(proj.target_budget)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                        {formatAmount(proj.contribution)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatAmount(proj.remaining)}
                      </td>
                      <td className="py-3 px-4 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${proj.pct}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono font-bold w-10 text-end">
                            {proj.pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50/90 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 font-bold">
                <tr>
                  <td className="py-3 px-4" colSpan={2}>
                    {t.dashboard.globalContributionLabel}
                  </td>
                  <td className="py-3 px-4 text-end font-mono tabular-nums">
                    {formatAmount(projectsSummary.totalTarget)}
                  </td>
                  <td
                    data-testid="projects-table-total-contribution"
                    className="py-3 px-4 text-end font-mono tabular-nums text-emerald-600 dark:text-emerald-400"
                  >
                    {formatAmount(projectsSummary.totalContribution)}
                  </td>
                  <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {formatAmount(projectsSummary.totalRemaining)}
                  </td>
                  <td className="py-3 px-4 text-end font-mono text-xs">
                    {projectsSummary.totalTarget > 0
                      ? `${Math.min(
                          100,
                          Math.round(
                            (projectsSummary.totalContribution /
                              projectsSummary.totalTarget) *
                              100
                          )
                        )}%`
                      : '0%'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
