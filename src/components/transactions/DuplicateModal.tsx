'use client';

/**
 * @file DuplicateModal.tsx
 * @description Smart Recurring Bill Duplication modal (triggered via row action or `Ctrl/Cmd + D`).
 * Allows recording a repeat bill or payment with a new date and recurring interval in two clicks.
 */

import React, { useEffect, useState } from 'react';
import { Calendar, CopyCheck, Repeat } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Modal } from '@/components/ui/Modal';
import { BucketIcon } from '@/components/ui/BucketIcon';
import { ipc } from '@/lib/ipc';
import { duplicateTransactionSchema } from '@/lib/schemas';
import { RecurringInterval } from '@/types/finance';
import { getTodayIso } from '@/lib/utils';

export function DuplicateModal() {
  const {
    accounts,
    duplicateModalTarget,
    closeDuplicateModal,
    t,
    formatAmount,
    refreshAll,
  } = useApp();

  const [scheduledDate, setScheduledDate] = useState<string>(getTodayIso());
  const [markRecurring, setMarkRecurring] = useState<boolean>(true);
  const [interval, setInterval] = useState<RecurringInterval>('monthly');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (duplicateModalTarget) {
      setScheduledDate(getTodayIso());
      setMarkRecurring(true);
      setInterval(duplicateModalTarget.recurring_interval || 'monthly');
      setError(null);
    }
  }, [duplicateModalTarget]);

  if (!duplicateModalTarget) return null;

  const accountName =
    accounts.find((a) => a.id === duplicateModalTarget.account_id)?.name ||
    accounts[0]?.name ||
    t.common.pocket;

  const handleConfirmDuplicate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = duplicateTransactionSchema.safeParse({
      id: duplicateModalTarget.id,
      newDate: scheduledDate,
      markRecurring,
      recurringInterval: markRecurring ? interval : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Validation failed.');
      return;
    }

    setSubmitting(true);
    try {
      await ipc.duplicateTransaction(
        parsed.data.id,
        parsed.data.newDate,
        parsed.data.markRecurring,
        parsed.data.recurringInterval
      );
      await refreshAll();
      closeDuplicateModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={Boolean(duplicateModalTarget)}
      onClose={closeDuplicateModal}
      title={t.transactions.duplicateModalTitle}
      subtitle={t.transactions.duplicateModalSubtitle}
      maxWidthClass="max-w-md"
      dataTestId="duplicate-modal"
    >
      <form onSubmit={handleConfirmDuplicate} className="space-y-4">
        {/* Pre-filled summary card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
              style={{
                backgroundColor:
                  duplicateModalTarget.category_color || '#10b981',
              }}
            >
              <BucketIcon
                name={duplicateModalTarget.category_icon}
                className="w-5 h-5"
              />
            </span>
            <div className="min-w-0">
              <p
                data-testid="duplicate-modal-payee"
                className="text-sm font-bold truncate"
              >
                {duplicateModalTarget.payee}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {duplicateModalTarget.category_name || t.common.bucket}
                {' • '}
                <span data-testid="duplicate-modal-account">{accountName}</span>
              </p>
            </div>
          </div>

          <span
            data-testid="duplicate-modal-amount"
            className="text-base font-extrabold font-mono tabular-nums"
          >
            {formatAmount(duplicateModalTarget.amount)}
          </span>
        </div>

        {/* Date Picker */}
        <div>
          <label
            htmlFor="duplicate-date-input"
            className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5"
          >
            {t.transactions.duplicateScheduleDate}
          </label>
          <div className="relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="duplicate-date-input"
              data-testid="duplicate-date-input"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-10 pe-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Optional flag: Mark as recurring */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              data-testid="duplicate-mark-recurring"
              checked={markRecurring}
              onChange={(e) => setMarkRecurring(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600"
            />
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Repeat className="w-3.5 h-3.5 text-indigo-500" />
              {t.transactions.duplicateMarkRecurring}
            </span>
          </label>

          {markRecurring && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-500">
                {t.transactions.intervalLabel}:
              </span>
              <select
                data-testid="duplicate-interval-select"
                value={interval}
                onChange={(e) =>
                  setInterval(e.target.value as RecurringInterval)
                }
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold"
              >
                <option value="weekly">{t.common.weekly}</option>
                <option value="monthly">{t.common.monthly}</option>
                <option value="yearly">{t.common.yearly}</option>
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2 text-xs font-medium text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          data-testid="duplicate-confirm-btn"
          className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50"
        >
          <CopyCheck className="w-4 h-4" />
          <span>{t.transactions.duplicateRecordBtn}</span>
        </button>
      </form>
    </Modal>
  );
}
