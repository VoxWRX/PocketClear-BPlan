'use client';

/**
 * @file SettingsView.tsx
 * @description Local settings, cryptographic security (Argon2id PIN lock & inactivity
 * auto-lock timer), regional preferences (language, currency, theme, accent palette,
 * decimal separator, date format), SQLite database backup/restore, and CSV import/export wizard.
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Lock,
  Palette,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Modal } from '@/components/ui/Modal';
import { ipc } from '@/lib/ipc';
import { parseAndPreviewCsv } from '@/lib/csv';
import {
  AccentPalette,
  CurrencyCode,
  DateFormatOption,
  DecimalSeparator,
  LanguageCode,
  ThemeMode,
} from '@/types/finance';
import { cn } from '@/lib/utils';

export function SettingsView() {
  const {
    settings,
    updateAppSetting,
    authState,
    t,
    refreshAll,
  } = useApp();

  // Security PIN State
  const [pinInput, setPinInput] = useState('');
  const [pinMessage, setPinMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Backup / Restore & CSV State
  const [backupPath, setBackupPath] = useState('pocketclear-backup.sqlite');
  const [dataBanner, setDataBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [exportedCsv, setExportedCsv] = useState<string | null>(null);

  // CSV Import Wizard Modal
  const [csvWizardOpen, setCsvWizardOpen] = useState(false);
  const [csvRawText, setCsvRawText] = useState(
    'Date,Payee,Amount,Type,Category,Project,Notes\n2026-10-12,Neighborhood Bakery,18.50,expense,Groceries,,Fresh bread\n2026-10-12,Freelance Design,450.00,income,Side Hustle / Gift,,Logo project'
  );

  const previewRows = parseAndPreviewCsv(csvRawText);
  const validRowsCount = previewRows.filter((r) => r.valid).length;
  const invalidRowsCount = previewRows.length - validRowsCount;

  const handleSaveOrVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinMessage(null);
    try {
      const ok = await ipc.verifyOrSetPin(pinInput);
      if (ok) {
        setPinMessage({
          type: 'success',
          text: authState.has_pin
            ? 'PIN verified successfully!'
            : 'Local PIN lock enabled with Argon2id!',
        });
        setPinInput('');
        await refreshAll();
      } else {
        setPinMessage({
          type: 'error',
          text: t.lockScreen.invalidPin,
        });
      }
    } catch (err) {
      setPinMessage({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDisablePin = async () => {
    setPinMessage(null);
    try {
      const ok = await ipc.disablePin(pinInput);
      if (ok) {
        setPinMessage({
          type: 'success',
          text: 'PIN lock removed.',
        });
        setPinInput('');
        await refreshAll();
      } else {
        setPinMessage({
          type: 'error',
          text: 'Enter your current PIN to disable lock.',
        });
      }
    } catch (err) {
      setPinMessage({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleExportBackup = async () => {
    setDataBanner(null);
    try {
      const savedPath = await ipc.exportBackupDb(backupPath);
      setDataBanner({
        type: 'success',
        text: `${t.settings.backupSuccess} (${savedPath})`,
      });
    } catch (err) {
      setDataBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleRestoreBackup = async () => {
    setDataBanner(null);
    try {
      await ipc.importBackupDb(backupPath);
      await refreshAll();
      setDataBanner({
        type: 'success',
        text: t.settings.restoreSuccess,
      });
    } catch (err) {
      setDataBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleExportCsv = async () => {
    setDataBanner(null);
    try {
      const csv = await ipc.exportTransactionsCsv();
      setExportedCsv(csv);
      setDataBanner({
        type: 'success',
        text: 'CSV exported and ready below!',
      });
    } catch (err) {
      setDataBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleConfirmCsvImport = async () => {
    setDataBanner(null);
    try {
      const res = await ipc.importTransactionsCsv(csvRawText);
      setCsvWizardOpen(false);
      await refreshAll();
      setDataBanner({
        type: 'success',
        text: `Imported ${res.imported_count} transactions (${res.skipped_count} skipped).`,
      });
    } catch (err) {
      setDataBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-view">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {t.settings.title}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t.settings.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Local Security & PIN Lock (Argon2id) */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold">{t.settings.securityTitle}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.settings.securityDesc}
                </p>
              </div>
            </div>
            <span
              data-testid="pin-status-badge"
              className={cn(
                'px-3 py-1 rounded-full text-xs font-bold',
                authState.has_pin
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              )}
            >
              {authState.has_pin
                ? t.settings.pinStatusEnabled
                : t.settings.pinStatusDisabled}
            </span>
          </div>

          <form onSubmit={handleSaveOrVerifyPin} className="space-y-3">
            <div>
              <label
                htmlFor="settings-pin-input"
                className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                {authState.has_pin
                  ? t.settings.currentPinLabel
                  : t.settings.setPinLabel}
              </label>
              <input
                id="settings-pin-input"
                data-testid="settings-pin-input"
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                data-testid="settings-save-pin-btn"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                {t.settings.enablePinBtn}
              </button>
              {authState.has_pin && (
                <button
                  type="button"
                  data-testid="settings-disable-pin-btn"
                  onClick={handleDisablePin}
                  className="px-4 py-2 rounded-xl border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-500/10"
                >
                  {t.settings.disablePinBtn}
                </button>
              )}
            </div>
          </form>

          {pinMessage && (
            <div
              data-testid="pin-feedback-message"
              className={cn(
                'rounded-xl px-3.5 py-2 text-xs font-semibold',
                pinMessage.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              )}
            >
              {pinMessage.text}
            </div>
          )}

          {/* Auto-Lock Timeout Selector (5, 15, 30 minutes) */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">
              {t.settings.autoLockLabel}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { mins: 5, label: t.settings.minutes5 },
                { mins: 15, label: t.settings.minutes15 },
                { mins: 30, label: t.settings.minutes30 },
              ].map((opt) => (
                <button
                  key={opt.mins}
                  type="button"
                  data-testid={`autolock-${opt.mins}`}
                  onClick={() => updateAppSetting('auto_lock_minutes', opt.mins)}
                  className={cn(
                    'py-2 rounded-xl text-xs font-bold border transition-all',
                    settings.auto_lock_minutes === opt.mins
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Card 2: Customization (Currency, Language, Theme, Accent Palette, Formats) */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Palette className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold">
              {t.settings.customizationTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Currency */}
            <div>
              <label
                htmlFor="settings-currency-select"
                className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                {t.onboarding.currencyLabel}
              </label>
              <select
                id="settings-currency-select"
                data-testid="settings-currency-select"
                value={settings.currency}
                onChange={(e) =>
                  updateAppSetting('currency', e.target.value as CurrencyCode)
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-semibold"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="MAD">MAD (DH)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>

            {/* Language */}
            <div>
              <label
                htmlFor="settings-language-select"
                className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                {t.onboarding.languageLabel}
              </label>
              <select
                id="settings-language-select"
                data-testid="settings-language-select"
                value={settings.language}
                onChange={(e) =>
                  updateAppSetting('language', e.target.value as LanguageCode)
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-semibold"
              >
                <option value="en">English (EN)</option>
                <option value="fr">Français (FR)</option>
                <option value="ar">العربية (AR)</option>
              </select>
            </div>

            {/* Decimal Separator */}
            <div>
              <label
                htmlFor="settings-decimal-select"
                className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                {t.settings.decimalSeparatorLabel}
              </label>
              <select
                id="settings-decimal-select"
                data-testid="settings-decimal-select"
                value={settings.decimal_separator}
                onChange={(e) =>
                  updateAppSetting(
                    'decimal_separator',
                    e.target.value as DecimalSeparator
                  )
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-semibold"
              >
                <option value=".">1,234.56 (.)</option>
                <option value=",">1 234,56 (,)</option>
              </select>
            </div>

            {/* Date Format */}
            <div>
              <label
                htmlFor="settings-datefmt-select"
                className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                {t.settings.dateFormatLabel}
              </label>
              <select
                id="settings-datefmt-select"
                data-testid="settings-datefmt-select"
                value={settings.date_format}
                onChange={(e) =>
                  updateAppSetting(
                    'date_format',
                    e.target.value as DateFormatOption
                  )
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-semibold"
              >
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              </select>
            </div>
          </div>

          {/* Theme Toggle */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              {t.settings.themeLabel}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'light', label: t.settings.themeLight },
                  { id: 'dark', label: t.settings.themeDark },
                  { id: 'system', label: t.settings.themeSystem },
                ] as Array<{ id: ThemeMode; label: string }>
              ).map((th) => (
                <button
                  key={th.id}
                  type="button"
                  data-testid={`theme-btn-${th.id}`}
                  onClick={() => updateAppSetting('theme', th.id)}
                  className={cn(
                    'py-2 rounded-xl text-xs font-bold border transition-all',
                    settings.theme === th.id
                      ? 'border-accent bg-accent text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  )}
                >
                  {th.label}
                </button>
              ))}
            </div>
          </div>

          {/* Accent Palette Toggle */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              {t.settings.accentLabel}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    id: 'emerald',
                    label: t.settings.accentEmerald,
                    color: '#10b981',
                  },
                  {
                    id: 'blue',
                    label: t.settings.accentBlue,
                    color: '#2563eb',
                  },
                ] as Array<{ id: AccentPalette; label: string; color: string }>
              ).map((pal) => (
                <button
                  key={pal.id}
                  type="button"
                  data-testid={`accent-btn-${pal.id}`}
                  onClick={() => updateAppSetting('accent', pal.id)}
                  className={cn(
                    'flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold border transition-all',
                    settings.accent === pal.id
                      ? 'border-slate-900 dark:border-white bg-slate-100 dark:bg-slate-800'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                  )}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ backgroundColor: pal.color }}
                  />
                  <span className="truncate">{pal.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Card 3: Data Management (SQLite Backup/Restore + CSV Export/Import) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">{t.settings.dataTitle}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              SQLite WAL mode • Local file portability
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input
            type="text"
            data-testid="backup-path-input"
            value={backupPath}
            onChange={(e) => setBackupPath(e.target.value)}
            placeholder="pocketclear-backup.sqlite"
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-xs font-mono"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="export-backup-btn"
              onClick={handleExportBackup}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t.settings.backupBtn}</span>
            </button>

            <button
              type="button"
              data-testid="restore-backup-btn"
              onClick={handleRestoreBackup}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{t.settings.restoreBtn}</span>
            </button>

            <button
              type="button"
              data-testid="export-csv-btn"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
              <span>{t.settings.exportCsvBtn}</span>
            </button>

            <button
              type="button"
              data-testid="open-csv-wizard-btn"
              onClick={() => setCsvWizardOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t.settings.importCsvBtn}</span>
            </button>
          </div>
        </div>

        {dataBanner && (
          <div
            data-testid="data-feedback-banner"
            className={cn(
              'rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center gap-2',
              dataBanner.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
            )}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{dataBanner.text}</span>
          </div>
        )}

        {exportedCsv !== null && (
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">
              Exported CSV Output:
            </label>
            <textarea
              readOnly
              data-testid="exported-csv-textarea"
              value={exportedCsv}
              rows={5}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono"
            />
          </div>
        )}
      </section>

      {/* CSV Import Wizard Modal with Preview */}
      <Modal
        open={csvWizardOpen}
        onClose={() => setCsvWizardOpen(false)}
        title={t.settings.csvImportTitle}
        subtitle={t.settings.csvImportSubtitle}
        maxWidthClass="max-w-2xl"
        dataTestId="csv-import-modal"
      >
        <div className="space-y-4">
          <textarea
            data-testid="csv-import-textarea"
            value={csvRawText}
            onChange={(e) => setCsvRawText(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              {t.settings.csvPreviewTitle
                .replace('{valid}', String(validRowsCount))
                .replace('{invalid}', String(invalidRowsCount))}
            </h3>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                  <tr>
                    <th className="p-2">Date</th>
                    <th className="p-2">Payee</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Category</th>
                    <th className="p-2 text-right">Amount</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2 font-mono">{r.date}</td>
                      <td className="p-2 font-semibold">{r.payee || '—'}</td>
                      <td className="p-2">{r.type}</td>
                      <td className="p-2">{r.category}</td>
                      <td className="p-2 text-right font-mono">
                        {r.amount.toFixed(2)}
                      </td>
                      <td className="p-2">
                        {r.valid ? (
                          <span className="text-emerald-600 font-bold">OK</span>
                        ) : (
                          <span className="text-rose-500 font-semibold">
                            {r.error}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCsvWizardOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              disabled={validRowsCount === 0}
              data-testid="csv-confirm-import-btn"
              onClick={handleConfirmCsvImport}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
            >
              {t.settings.csvConfirmImport} ({validRowsCount})
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
