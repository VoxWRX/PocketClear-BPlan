'use client';

/**
 * @file OnboardingWizard.tsx
 * @description First-run onboarding modal displayed when the local SQLite database
 * has zero accounts (`summary.has_accounts === false`). Guides the user through:
 * 1. Choosing app language (EN, FR, AR with live RTL switching) and currency
 * 2. Setting initial pocket name and starting balance
 * 3. Selecting 4–6 starter spending category buckets
 */

import React, { useState } from 'react';
import { Check, Globe, ShieldCheck, Wallet } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  STARTER_BUCKET_PRESETS,
  TRANSLATIONS,
  getStarterCategoriesForLanguage,
} from '@/i18n/translations';
import { CurrencyCode, LanguageCode } from '@/types/finance';
import { ipc } from '@/lib/ipc';
import { onboardingPayloadSchema } from '@/lib/schemas';
import { BucketIcon } from '@/components/ui/BucketIcon';
import { cn } from '@/lib/utils';

const CURRENCIES: Array<{ code: CurrencyCode; label: string }> = [
  { code: 'USD', label: 'USD ($)' },
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'MAD', label: 'MAD (DH)' },
  { code: 'GBP', label: 'GBP (£)' },
];

const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English (EN)' },
  { code: 'fr', label: 'Français (FR)' },
  { code: 'ar', label: 'العربية (AR)' },
];

export function OnboardingWizard() {
  const { summary, settings, updateAppSetting, refreshAll } = useApp();

  const [language, setLanguage] = useState<LanguageCode>(settings.language);
  const [currency, setCurrency] = useState<CurrencyCode>(
    (settings.currency as CurrencyCode) || 'USD'
  );
  const [accountName, setAccountName] = useState<string>('');
  const [startingBalance, setStartingBalance] = useState<string>('1500');
  const [selectedPresets, setSelectedPresets] = useState<string[]>(
    STARTER_BUCKET_PRESETS.filter((p) => p.defaultSelected).map((p) => p.id)
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!summary || summary.has_accounts) {
    return null;
  }

  const dict = TRANSLATIONS[language] || TRANSLATIONS.en;
  const isRtl = language === 'ar';

  const handleLanguageChange = async (lang: LanguageCode) => {
    setLanguage(lang);
    await updateAppSetting('language', lang);
  };

  const togglePreset = (id: string) => {
    setSelectedPresets((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedBalance = parseFloat(startingBalance.replace(',', '.'));
    const safeBalance = Number.isFinite(parsedBalance) ? parsedBalance : 0;

    const chosenExpenseCount = STARTER_BUCKET_PRESETS.filter(
      (p) => p.type === 'expense' && selectedPresets.includes(p.id)
    ).length;

    if (chosenExpenseCount === 0) {
      setError('Please select at least 1 starter spending bucket.');
      return;
    }

    setSubmitting(true);
    try {
      const categories = getStarterCategoriesForLanguage(
        language,
        selectedPresets
      );
      const parsed = onboardingPayloadSchema.safeParse({
        account_name: accountName.trim() || dict.onboarding.accountNamePlaceholder,
        starting_balance: safeBalance,
        currency,
        language,
        categories,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message || 'Validation failed.');
        return;
      }
      await ipc.completeOnboarding(parsed.data);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const expensePresets = STARTER_BUCKET_PRESETS.filter((p) => p.type === 'expense');

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      data-testid="onboarding-wizard"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl overflow-hidden my-8">
        {/* Visual Brand Banner */}
        <div className="relative h-32 w-full bg-slate-900 overflow-hidden">
          <img
            src="/banner.png"
            alt="PocketClear Banner"
            className="w-full h-full object-cover object-center opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent" />
        </div>

        <div className="p-6 sm:p-8 -mt-12 relative">
          <div className="flex items-center gap-3.5 mb-2">
            <img
              src="/logo.jpg"
              alt="PocketClear Logo"
              className="w-14 h-14 rounded-2xl object-cover border-2 border-white dark:border-slate-800 shadow-lg bg-slate-950 shrink-0"
            />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                {dict.onboarding.welcomeTitle}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {dict.onboarding.welcomeSubtitle}
              </p>
            </div>
          </div>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Step 1: Language & Currency */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/60 dark:bg-slate-800/40">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-500" />
              {dict.onboarding.step1Title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                  {dict.onboarding.languageLabel}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      data-testid={`onboarding-lang-${l.code}`}
                      onClick={() => handleLanguageChange(l.code)}
                      className={cn(
                        'px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all',
                        language === l.code
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-500'
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="onboarding-currency"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  {dict.onboarding.currencyLabel}
                </label>
                <select
                  id="onboarding-currency"
                  data-testid="onboarding-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Step 2: Account & Starting Balance */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/60 dark:bg-slate-800/40">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-500" />
              {dict.onboarding.step2Title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="onboarding-account-name"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  {dict.onboarding.accountNameLabel}
                </label>
                <input
                  id="onboarding-account-name"
                  data-testid="onboarding-account-name"
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder={dict.onboarding.accountNamePlaceholder}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label
                  htmlFor="onboarding-starting-balance"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  {dict.onboarding.startingBalanceLabel} ({currency})
                </label>
                <input
                  id="onboarding-starting-balance"
                  data-testid="onboarding-starting-balance"
                  type="number"
                  step="0.01"
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Starter Buckets */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/60 dark:bg-slate-800/40">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {dict.onboarding.step3Title}
              </h2>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                {
                  expensePresets.filter((p) => selectedPresets.includes(p.id))
                    .length
                }{' '}
                {dict.onboarding.selectedCount}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {expensePresets.map((preset) => {
                const isSelected = selectedPresets.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`preset-${preset.key}`}
                    onClick={() => togglePreset(preset.id)}
                    className={cn(
                      'flex items-center justify-between gap-2 p-3 rounded-xl border text-left transition-all',
                      isSelected
                        ? 'border-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/15 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:border-slate-300'
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: preset.color }}
                      >
                        <BucketIcon name={preset.icon} className="w-4 h-4" />
                      </span>
                      <span className="text-xs font-semibold truncate">
                        {dict.presets[preset.key]}
                      </span>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-2.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{dict.onboarding.privacyNote}</span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              data-testid="onboarding-submit"
              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 shrink-0"
            >
              {dict.onboarding.finishButton}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
