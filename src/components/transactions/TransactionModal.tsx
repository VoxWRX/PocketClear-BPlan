'use client';

/**
 * @file TransactionModal.tsx
 * @description Create / Edit transaction modal with automatic Project contribution mode.
 * When linked to a Project (`kind === 'project'`), locks flow direction to `'expense'`
 * (contribution) and hides the Money In / Money Out toggle to prevent misclassifying
 * project contributions as income.
 */

import React, { useEffect, useState } from 'react';
import { Calendar, Repeat } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Modal } from '@/components/ui/Modal';
import { BucketIcon } from '@/components/ui/BucketIcon';
import { ipc } from '@/lib/ipc';
import {
  newTransactionSchema,
  updateTransactionSchema,
} from '@/lib/schemas';
import { RecurringInterval, TransactionType } from '@/types/finance';
import {
  cn,
  getTodayIso,
  getYesterdayIso,
  inferProjectKind,
} from '@/lib/utils';

export function TransactionModal() {
  const {
    txModalOpen,
    txModalMode,
    txModalDefaultType,
    txModalEditing,
    closeTransactionModal,
    accounts,
    categories,
    projects,
    txFilter,
    t,
    refreshAll,
  } = useApp();

  const [txType, setTxType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState<string>('');
  const [payee, setPayee] = useState<string>('');
  const [date, setDate] = useState<string>(getTodayIso());
  const [categoryId, setCategoryId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [recurringInterval, setRecurringInterval] =
    useState<RecurringInterval>('monthly');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const filteredCategories = categories.filter((c) => c.type === txType);

  useEffect(() => {
    if (!txModalOpen) {
      setProjectId(txFilter.project_id || '');
      return;
    }
    setError(null);
    if (txModalMode === 'edit' && txModalEditing) {
      setTxType(txModalEditing.type);
      setAmount(String(txModalEditing.amount));
      setPayee(txModalEditing.payee);
      setDate(txModalEditing.date);
      setCategoryId(txModalEditing.category_id);
      setProjectId(txModalEditing.project_id || '');
      setIsRecurring(txModalEditing.is_recurring);
      setRecurringInterval(txModalEditing.recurring_interval || 'monthly');
      setNotes(txModalEditing.notes || '');
    } else {
      const defaultProjId = txFilter.project_id || '';
      const defaultEntity = defaultProjId
        ? projects.find((p) => p.id === defaultProjId) || null
        : null;
      const isDefaultProject = Boolean(
        defaultEntity &&
          inferProjectKind(defaultEntity.name, defaultEntity.kind) === 'project'
      );
      const targetType: TransactionType = isDefaultProject
        ? 'expense'
        : txModalDefaultType;
      setTxType(targetType);
      setAmount('');
      setPayee('');
      setDate(getTodayIso());
      const matchingCats = categories.filter((c) => c.type === targetType);
      setCategoryId(matchingCats[0]?.id || '');
      setProjectId(defaultProjId);
      setIsRecurring(false);
      setRecurringInterval('monthly');
      setNotes('');
    }
  }, [
    txModalOpen,
    txModalMode,
    txModalDefaultType,
    txModalEditing,
    categories,
    projects,
    txFilter.project_id,
  ]);

  const handleTypeSwitch = (newType: TransactionType) => {
    setTxType(newType);
    const matching = categories.filter((c) => c.type === newType);
    if (!matching.some((c) => c.id === categoryId)) {
      setCategoryId(matching[0]?.id || '');
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    const entity = newProjectId
      ? projects.find((p) => p.id === newProjectId) || null
      : null;
    if (
      entity &&
      inferProjectKind(entity.name, entity.kind) === 'project' &&
      txType !== 'expense'
    ) {
      handleTypeSwitch('expense');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount.replace(',', '.'));
    const resolvedCategoryId =
      categoryId ||
      filteredCategories[0]?.id ||
      'uncategorized';
    const accountId = txModalEditing?.account_id || accounts[0]?.id || '';

    setSubmitting(true);
    try {
      if (txModalMode === 'edit' && txModalEditing) {
        const parsed = updateTransactionSchema.safeParse({
          id: txModalEditing.id,
          account_id: accountId,
          category_id: resolvedCategoryId,
          project_id: projectId || null,
          clear_project_id: !projectId,
          amount: parsedAmount,
          type: txType,
          payee: payee.trim(),
          date,
          is_recurring: isRecurring,
          recurring_interval: isRecurring ? recurringInterval : null,
          notes: notes.trim() || null,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message || 'Validation failed.');
          return;
        }
        await ipc.updateTransaction(parsed.data);
      } else {
        const parsed = newTransactionSchema.safeParse({
          account_id: accountId,
          category_id: resolvedCategoryId,
          project_id: projectId || null,
          amount: parsedAmount,
          type: txType,
          payee: payee.trim(),
          date,
          is_recurring: isRecurring,
          recurring_interval: isRecurring ? recurringInterval : null,
          notes: notes.trim() || null,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message || 'Validation failed.');
          return;
        }
        await ipc.createTransaction(parsed.data);
      }
      await refreshAll();
      closeTransactionModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const todayIso = getTodayIso();
  const yesterdayIso = getYesterdayIso();

  const selectedEntity = projectId
    ? projects.find((p) => p.id === projectId) || null
    : null;
  const isProjectContribution = Boolean(
    selectedEntity &&
      inferProjectKind(selectedEntity.name, selectedEntity.kind) === 'project'
  );

  const showTypeToggle =
    !isProjectContribution || (txModalMode === 'edit' && txType === 'income');

  const title =
    txModalMode === 'edit'
      ? t.transactions.editModalTitle
      : isProjectContribution
      ? t.transactions.contributeModalTitle
      : txType === 'income'
      ? t.transactions.addModalTitleIn
      : t.transactions.addModalTitleOut;

  return (
    <Modal
      open={txModalOpen}
      onClose={closeTransactionModal}
      title={title}
      maxWidthClass="max-w-xl"
      dataTestId="transaction-modal"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Flow Type Toggle (Money In vs Money Out) */}
        {showTypeToggle && (
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              data-testid="tx-type-income"
              onClick={() => handleTypeSwitch('income')}
              className={cn(
                'py-2 rounded-lg text-xs font-bold transition-all',
                txType === 'income'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              )}
            >
              + {t.common.moneyIn}
            </button>
            <button
              type="button"
              data-testid="tx-type-expense"
              onClick={() => handleTypeSwitch('expense')}
              className={cn(
                'py-2 rounded-lg text-xs font-bold transition-all',
                txType === 'expense'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              )}
            >
              - {t.common.moneyOut}
            </button>
          </div>
        )}

        {/* Fast Amount Input & Payee */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="tx-amount-input"
              className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {t.transactions.amountLabel}
            </label>
            <input
              id="tx-amount-input"
              data-testid="tx-amount-input"
              type="number"
              step="0.01"
              min="0.01"
              autoFocus
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-lg font-extrabold font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="tx-payee-input"
              className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {t.transactions.payeeLabel}
            </label>
            <input
              id="tx-payee-input"
              data-testid="tx-payee-input"
              type="text"
              required
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder={
                txType === 'income'
                  ? t.transactions.payeePlaceholderIn
                  : t.transactions.payeePlaceholderOut
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Smart Date Selector (Today, Yesterday, Pick Date) */}
        <div>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
            {t.transactions.dateLabel}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="date-btn-today"
              onClick={() => setDate(todayIso)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                date === todayIso
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              )}
            >
              {t.common.today}
            </button>
            <button
              type="button"
              data-testid="date-btn-yesterday"
              onClick={() => setDate(yesterdayIso)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                date === yesterdayIso
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              )}
            >
              {t.common.yesterday}
            </button>
            <div className="relative flex-1 min-w-[150px]">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                data-testid="tx-date-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-8 pe-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Category ("Bucket") Selector with Large Icons */}
        {filteredCategories.length > 0 && (
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              {t.transactions.bucketLabel}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto p-0.5">
              {filteredCategories.map((cat) => {
                const selected = categoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    data-testid={`bucket-option-${cat.name}`}
                    onClick={() => setCategoryId(cat.id)}
                    className={cn(
                      'flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all',
                      selected
                        ? 'border-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/20 ring-1 ring-emerald-500'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    )}
                  >
                    <span
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                      style={{ backgroundColor: cat.color }}
                    >
                      <BucketIcon name={cat.icon} className="w-4 h-4" />
                    </span>
                    <span className="text-xs font-semibold truncate">
                      {cat.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Optional Project Assignment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="tx-project-select"
              className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {t.transactions.projectLabel}
            </label>
            <select
              id="tx-project-select"
              data-testid="tx-project-select"
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">{t.common.none}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="tx-notes-input"
              className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {t.transactions.notesLabel}
            </label>
            <input
              id="tx-notes-input"
              data-testid="tx-notes-input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.transactions.notesPlaceholder}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Recurring Toggle */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              data-testid="tx-recurring-checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Repeat className="w-3.5 h-3.5 text-indigo-500" />
              {t.transactions.recurringLabel}
            </span>
          </label>

          {isRecurring && (
            <select
              data-testid="tx-recurring-interval"
              value={recurringInterval}
              onChange={(e) =>
                setRecurringInterval(e.target.value as RecurringInterval)
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold"
            >
              <option value="weekly">{t.common.weekly}</option>
              <option value="monthly">{t.common.monthly}</option>
              <option value="yearly">{t.common.yearly}</option>
            </select>
          )}
        </div>

        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2 text-xs font-medium text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={closeTransactionModal}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="tx-submit-btn"
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50"
          >
            {t.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
