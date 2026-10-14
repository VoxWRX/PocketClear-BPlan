'use client';

/**
 * @file TransactionsView.tsx
 * @description Plain-language Money Activity Log view ("Journal d’activité").
 * Supports:
 * - Global transaction history or entity-scoped activity log (Month from Worksheet or Project)
 * - Context banner showing Allocated Base / Target Budget, Spent/Contributed, and Remaining Balance
 * - Single `[Contribute]` button when viewing a Project activity log vs `[- Add Money Out]` / `[+ Add Money In]`
 * - Instant filter pills (All, Money In, Money Out, Recurring, Linked) and full-text search
 */

import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Copy,
  Edit3,
  FolderKanban,
  MinusCircle,
  PlusCircle,
  Repeat,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { BucketIcon } from '@/components/ui/BucketIcon';
import { Modal } from '@/components/ui/Modal';
import { ipc } from '@/lib/ipc';
import { Transaction } from '@/types/finance';
import { cn, inferProjectKind, roundCents } from '@/lib/utils';

type PillFilter = 'all' | 'income' | 'expense' | 'recurring' | 'projects';

export function TransactionsView() {
  const {
    transactions,
    projects,
    txFilter,
    setTxFilter,
    activityLogSourceTab,
    setActiveTab,
    clearEntityActivityLog,
    t,
    formatAmount,
    formatDate,
    openAddTransactionModal,
    openEditTransactionModal,
    openDuplicateModal,
    refreshAll,
  } = useApp();

  const activeEntity = txFilter.project_id
    ? projects.find((p) => p.id === txFilter.project_id) || null
    : null;
  const isMonthEntity = activeEntity
    ? inferProjectKind(activeEntity.name, activeEntity.kind) === 'month'
    : false;
  const isProjectEntity = Boolean(activeEntity && !isMonthEntity);
  const activeEntityUsed = activeEntity
    ? isMonthEntity
      ? roundCents(activeEntity.spent_amount)
      : roundCents(activeEntity.spent_amount + activeEntity.income_amount)
    : 0;
  const activeEntityRemaining = activeEntity
    ? isMonthEntity
      ? roundCents(
          Math.max(
            0,
            activeEntity.target_budget +
              activeEntity.income_amount -
              activeEntity.spent_amount
          )
        )
      : roundCents(Math.max(0, activeEntity.target_budget - activeEntityUsed))
    : 0;

  const activePill: PillFilter =
    txFilter.type === 'income'
      ? 'income'
      : txFilter.type === 'expense'
      ? 'expense'
      : txFilter.only_recurring
      ? 'recurring'
      : txFilter.only_projects
      ? 'projects'
      : 'all';
  const [searchQuery, setSearchQuery] = useState<string>(txFilter.search || '');
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    setSearchQuery(txFilter.search || '');
  }, [txFilter.search]);

  const applyPillFilter = (pill: PillFilter, searchVal: string = searchQuery) => {
    setTxFilter((prev) => ({
      project_id: prev.project_id,
      search: searchVal.trim() || undefined,
      type:
        pill === 'income'
          ? 'income'
          : pill === 'expense'
          ? 'expense'
          : undefined,
      only_recurring: pill === 'recurring' ? true : undefined,
      only_projects: pill === 'projects' ? true : undefined,
    }));
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    applyPillFilter(activePill, val);
  };

  const handleBackToSource = () => {
    const targetTab =
      activityLogSourceTab || (isMonthEntity ? 'worksheet' : 'projects');
    clearEntityActivityLog();
    setActiveTab(targetTab);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await ipc.deleteTransaction(deleteTarget.id);
      setDeleteTarget(null);
      await refreshAll();
    } finally {
      setDeleting(false);
    }
  };

  const pills: Array<{ id: PillFilter; label: string }> = [
    { id: 'all', label: t.transactions.filterAll },
    { id: 'income', label: t.transactions.filterIn },
    { id: 'expense', label: t.transactions.filterOut },
    { id: 'recurring', label: t.transactions.filterRecurring },
    { id: 'projects', label: t.transactions.filterProjects },
  ];

  return (
    <div className="space-y-5" data-testid="transactions-view">
      {/* Active Month / Project Context Banner */}
      {activeEntity && (
        <div
          data-testid="active-entity-banner"
          className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-500/15 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              {isMonthEntity ? (
                <Calendar className="w-5 h-5" />
              ) : (
                <FolderKanban className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2
                data-testid="active-entity-title"
                className="text-sm font-extrabold text-slate-900 dark:text-white"
              >
                {isMonthEntity
                  ? t.transactions.activeMonthBadge
                  : t.transactions.activeProjectBadge}{' '}
                : {activeEntity.name}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-mono mt-0.5">
                {isMonthEntity
                  ? t.worksheet.allocatedBase
                  : t.projects.targetBudget}
                : <strong>{formatAmount(activeEntity.target_budget)}</strong> •{' '}
                {isMonthEntity ? t.common.moneyOut : t.dashboard.colContribution}:{' '}
                <strong className="text-rose-600 dark:text-rose-400">
                  {formatAmount(activeEntityUsed)}
                </strong>{' '}
                •{' '}
                {isMonthEntity
                  ? t.worksheet.remainingBalance
                  : t.projects.remainingBalance}
                :{' '}
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {formatAmount(activeEntityRemaining)}
                </strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="back-to-source-btn"
              onClick={handleBackToSource}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>
                {isMonthEntity
                  ? t.transactions.backToWorksheet
                  : t.transactions.backToProjects}
              </span>
            </button>
            <button
              type="button"
              data-testid="clear-entity-filter-btn"
              onClick={clearEntityActivityLog}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-emerald-500/30 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t.transactions.showAllEntries}</span>
            </button>
          </div>
        </div>
      )}

      {/* Header & Add Expense / Income Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {t.transactions.title}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.transactions.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isProjectEntity ? (
            <button
              type="button"
              data-testid="tx-contribute-btn"
              onClick={() => openAddTransactionModal('expense')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t.transactions.contributeBtn}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="tx-add-expense-btn"
                onClick={() => openAddTransactionModal('expense')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-xs"
              >
                <MinusCircle className="w-4 h-4" />
                <span>{t.dashboard.addMoneyOut}</span>
              </button>
              <button
                type="button"
                data-testid="tx-add-income-btn"
                onClick={() => openAddTransactionModal('income')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{t.dashboard.addMoneyIn}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search & Pill Filters Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            data-testid="tx-search-input"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t.common.search}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-10 pe-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {pills.map((pill) => (
            <button
              key={pill.id}
              type="button"
              data-testid={`filter-pill-${pill.id}`}
              title={
                pill.id === 'projects'
                  ? t.transactions.filterProjectsHint
                  : undefined
              }
              onClick={() => applyPillFilter(pill.id)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-bold transition-all',
                activePill === pill.id
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* High-Contrast Transaction Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {transactions.length === 0 ? (
          <div
            data-testid="tx-empty-state"
            className="py-16 px-4 text-center text-sm text-slate-400"
          >
            {isProjectEntity
              ? t.transactions.emptyStateProject
              : t.transactions.emptyState}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3.5 px-4">{t.transactions.colDate}</th>
                  <th className="py-3.5 px-4">{t.transactions.colPayee}</th>
                  <th className="py-3.5 px-4">{t.transactions.colBucket}</th>
                  <th className="py-3.5 px-4">{t.transactions.colProject}</th>
                  <th className="py-3.5 px-4 text-end">
                    {t.transactions.colAmount}
                  </th>
                  <th className="py-3.5 px-4 text-end">
                    {t.transactions.colActions}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    tabIndex={0}
                    data-testid={`tx-row-${tx.id}`}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
                        e.preventDefault();
                        e.stopPropagation();
                        openDuplicateModal(tx);
                      }
                    }}
                    className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition-colors focus:outline-none focus:bg-emerald-500/5"
                  >
                    <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {tx.payee}
                        </span>
                        {tx.is_recurring && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
                            <Repeat className="w-2.5 h-2.5" />
                            {t.transactions.recurringBadge}
                          </span>
                        )}
                      </div>
                      {tx.notes && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {tx.notes}
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold">
                        <span
                          className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
                          style={{
                            backgroundColor: tx.category_color || '#10b981',
                          }}
                        >
                          <BucketIcon
                            name={tx.category_icon}
                            className="w-3.5 h-3.5"
                          />
                        </span>
                        <span>{tx.category_name || t.common.bucket}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {tx.project_name ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <FolderKanban className="w-3 h-3 text-accent" />
                          {tx.project_name}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'py-3.5 px-4 text-end font-mono tabular-nums font-extrabold whitespace-nowrap',
                        tx.type === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-900 dark:text-slate-100'
                      )}
                    >
                      {tx.type === 'income'
                        ? formatAmount(tx.amount, true)
                        : `-${formatAmount(tx.amount)}`}
                    </td>
                    <td className="py-3.5 px-4 text-end whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          title={t.common.duplicate}
                          data-testid={`duplicate-tx-${tx.id}`}
                          onClick={() => openDuplicateModal(tx)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title={t.common.edit}
                          data-testid={`edit-tx-${tx.id}`}
                          onClick={() => openEditTransactionModal(tx)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title={t.common.delete}
                          data-testid={`delete-tx-${tx.id}`}
                          onClick={() => setDeleteTarget(tx)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t.transactions.deleteConfirmTitle}
        subtitle={t.transactions.deleteConfirmDesc}
        maxWidthClass="max-w-sm"
        dataTestId="delete-confirm-modal"
      >
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={deleting}
            data-testid="confirm-delete-btn"
            onClick={handleConfirmDelete}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
          >
            {t.common.delete}
          </button>
        </div>
      </Modal>
    </div>
  );
}
