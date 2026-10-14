'use client';

/**
 * @file AppContext.tsx
 * @description Global React context provider for PocketClear.
 * Coordinates local SQLite/browser data synchronization, active navigation tab state,
 * entity-scoped activity log routing (Worksheet Months & Projects), Argon2id PIN lock
 * and inactivity auto-lock timer, theme/RTL attributes, and shared transaction modals.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Account,
  AppSettings,
  AuthState,
  Category,
  DashboardSummary,
  Project,
  Transaction,
  TransactionFilter,
  TransactionType,
} from '@/types/finance';
import { TRANSLATIONS, TranslationDictionary } from '@/i18n/translations';
import { ipc } from '@/lib/ipc';
import { resolveAppSettings } from '@/lib/schemas';
import { formatDisplayDate, formatMoney } from '@/lib/utils';

export type NavTab =
  | 'dashboard'
  | 'transactions'
  | 'worksheet'
  | 'projects'
  | 'settings'
  | 'guide';

interface AppContextValue {
  loading: boolean;
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  activityLogSourceTab: NavTab | null;
  openEntityActivityLog: (projectId: string, fromTab?: NavTab) => void;
  clearEntityActivityLog: () => void;
  summary: DashboardSummary | null;
  accounts: Account[];
  categories: Category[];
  projects: Project[];
  transactions: Transaction[];
  allTransactions: Transaction[];
  txFilter: TransactionFilter;
  setTxFilter: React.Dispatch<React.SetStateAction<TransactionFilter>>;
  settings: AppSettings;
  updateAppSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => Promise<void>;
  t: TranslationDictionary;
  isRtl: boolean;
  authState: AuthState;
  isLocked: boolean;
  lockNow: () => void;
  unlockWithPin: (pin: string) => Promise<boolean>;
  refreshAll: (filterOverride?: TransactionFilter) => Promise<void>;
  formatAmount: (amount: number, showSign?: boolean) => string;
  formatDate: (isoDate: string) => string;
  // Shared modals
  txModalOpen: boolean;
  txModalMode: 'create' | 'edit';
  txModalDefaultType: TransactionType;
  txModalEditing: Transaction | null;
  openAddTransactionModal: (type: TransactionType) => void;
  openEditTransactionModal: (tx: Transaction) => void;
  closeTransactionModal: () => void;
  duplicateModalTarget: Transaction | null;
  openDuplicateModal: (tx?: Transaction) => void;
  closeDuplicateModal: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  currency: 'USD',
  language: 'en',
  theme: 'system',
  accent: 'emerald',
  decimal_separator: '.',
  date_format: 'YYYY-MM-DD',
  auto_lock_minutes: 15,
};

const FALLBACK_SUMMARY: DashboardSummary = {
  total_balance: 0,
  money_in_this_month: 0,
  money_out_this_month: 0,
  left_to_spend_this_month: 0,
  daily_allowance: 0,
  days_remaining_in_month: 1,
  health_status: 'safe',
  currency: 'USD',
  category_breakdown: [],
  monthly_cashflow: [],
  upcoming_recurring: [],
  has_accounts: false,
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [activityLogSourceTab, setActivityLogSourceTab] =
    useState<NavTab | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [txFilter, setTxFilter] = useState<TransactionFilter>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [authState, setAuthState] = useState<AuthState>({
    has_pin: false,
    auto_lock_minutes: 15,
  });
  const [isLocked, setIsLocked] = useState<boolean>(false);

  // Modal states
  const [txModalOpen, setTxModalOpen] = useState<boolean>(false);
  const [txModalMode, setTxModalMode] = useState<'create' | 'edit'>('create');
  const [txModalDefaultType, setTxModalDefaultType] =
    useState<TransactionType>('expense');
  const [txModalEditing, setTxModalEditing] = useState<Transaction | null>(null);
  const [duplicateModalTarget, setDuplicateModalTarget] =
    useState<Transaction | null>(null);

  const txFilterRef = useRef<TransactionFilter>(txFilter);
  txFilterRef.current = txFilter;

  const refreshAll = useCallback(async (filterOverride?: TransactionFilter) => {
    const activeFilter = filterOverride ?? txFilterRef.current;
    const [
      rawDash,
      rawAccs,
      rawCats,
      rawProjs,
      rawAllTxs,
      rawSettingsObj,
      rawAuth,
    ] = await Promise.all([
      ipc.getDashboardSummary().catch(() => null),
      ipc.getAccounts().catch(() => [] as Account[]),
      ipc.getCategories().catch(() => [] as Category[]),
      ipc.getProjects().catch(() => [] as Project[]),
      ipc.getTransactions().catch(() => [] as Transaction[]),
      ipc.getSettings().catch(() => ({} as Record<string, string>)),
      ipc.checkAuthState().catch(() => ({
        has_pin: false,
        auto_lock_minutes: 15,
      })),
    ]);

    const accs = Array.isArray(rawAccs) ? rawAccs : [];
    const cats = Array.isArray(rawCats) ? rawCats : [];
    const projs = Array.isArray(rawProjs) ? rawProjs : [];
    const allTxs = Array.isArray(rawAllTxs) ? rawAllTxs : [];
    const rawSettings =
      rawSettingsObj && typeof rawSettingsObj === 'object'
        ? rawSettingsObj
        : ({} as Record<string, string>);
    const auth: AuthState =
      rawAuth && typeof rawAuth === 'object'
        ? {
            has_pin: Boolean(rawAuth.has_pin),
            auto_lock_minutes:
              Number.isInteger(Number(rawAuth.auto_lock_minutes)) &&
              Number(rawAuth.auto_lock_minutes) > 0
                ? Number(rawAuth.auto_lock_minutes)
                : 15,
          }
        : { has_pin: false, auto_lock_minutes: 15 };

    const rawFilteredTxs = await ipc
      .getTransactions(activeFilter)
      .catch(() => allTxs);
    const txs = Array.isArray(rawFilteredTxs) ? rawFilteredTxs : allTxs;

    const resolvedDash: DashboardSummary =
      rawDash && typeof rawDash === 'object'
        ? {
            ...FALLBACK_SUMMARY,
            ...rawDash,
            category_breakdown: Array.isArray(rawDash.category_breakdown)
              ? rawDash.category_breakdown
              : [],
            monthly_cashflow: Array.isArray(rawDash.monthly_cashflow)
              ? rawDash.monthly_cashflow
              : [],
            upcoming_recurring: Array.isArray(rawDash.upcoming_recurring)
              ? rawDash.upcoming_recurring
              : [],
          }
        : {
            ...FALLBACK_SUMMARY,
            has_accounts: accs.length > 0,
            currency: accs[0]?.currency || rawSettings.currency || 'USD',
          };

    setSummary(resolvedDash);
    setAccounts(accs);
    setCategories(cats);
    setProjects(projs);
    setTransactions(txs);
    setAllTransactions(allTxs);
    setAuthState(auth);

    try {
      setSettings(
        resolveAppSettings(
          rawSettings,
          accs[0]?.currency,
          auth.auto_lock_minutes
        )
      );
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const auth = await ipc.checkAuthState().catch(() => ({
          has_pin: false,
          auto_lock_minutes: 15,
        }));
        if (mounted && auth?.has_pin) {
          setIsLocked(true);
        }
        await refreshAll();
      } catch {
        if (mounted) {
          setSummary((prev) => prev ?? FALLBACK_SUMMARY);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshAll]);

  // Re-fetch transactions when filter changes
  useEffect(() => {
    if (loading) return;
    ipc
      .getTransactions(txFilter)
      .then((res) => setTransactions(Array.isArray(res) ? res : []))
      .catch(() => {});
  }, [txFilter, loading]);

  // Apply theme, accent palette, and RTL/LTR direction to document root
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const isDark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches);

    root.classList.toggle('dark', isDark);
    root.setAttribute('data-accent', settings.accent);
    root.setAttribute('lang', settings.language);
    root.setAttribute('dir', settings.language === 'ar' ? 'rtl' : 'ltr');
  }, [settings.theme, settings.accent, settings.language]);

  // Auto-lock inactivity timer (5, 15, or 30 minutes)
  useEffect(() => {
    if (!authState.has_pin || isLocked || typeof window === 'undefined') return;
    const timeoutMs = Math.max(1, settings.auto_lock_minutes) * 60 * 1000;
    let timer = window.setTimeout(() => {
      setIsLocked(true);
    }, timeoutMs);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setIsLocked(true);
      }, timeoutMs);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'mousemove'];
    for (const ev of events) {
      window.addEventListener(ev, resetTimer, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const ev of events) {
        window.removeEventListener(ev, resetTimer);
      }
    };
  }, [authState.has_pin, isLocked, settings.auto_lock_minutes]);

  const updateAppSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      await ipc.updateSetting(String(key), String(value));
      if (key === 'currency' && accounts[0]) {
        await ipc.updateAccount({ id: accounts[0].id, currency: String(value) });
      }
      await refreshAll();
    },
    [accounts, refreshAll]
  );

  const lockNow = useCallback(() => {
    setIsLocked(true);
  }, []);

  const unlockWithPin = useCallback(
    async (pin: string): Promise<boolean> => {
      const ok = await ipc.verifyOrSetPin(pin);
      if (ok) {
        setIsLocked(false);
        await refreshAll();
      }
      return ok;
    },
    [refreshAll]
  );

  const openEntityActivityLog = useCallback(
    (projectId: string, fromTab?: NavTab) => {
      const nextFilter: TransactionFilter = { project_id: projectId };
      txFilterRef.current = nextFilter;
      setTxFilter(nextFilter);
      setActivityLogSourceTab(fromTab ?? activeTab);
      setActiveTab('transactions');
      ipc.getTransactions(nextFilter).then(setTransactions).catch(() => {});
    },
    [activeTab]
  );

  const clearEntityActivityLog = useCallback(() => {
    const nextFilter: TransactionFilter = {};
    txFilterRef.current = nextFilter;
    setTxFilter(nextFilter);
    setActivityLogSourceTab(null);
    ipc.getTransactions(nextFilter).then(setTransactions).catch(() => {});
  }, []);

  const openAddTransactionModal = useCallback((type: TransactionType) => {
    setTxModalMode('create');
    setTxModalDefaultType(type);
    setTxModalEditing(null);
    setTxModalOpen(true);
  }, []);

  const openEditTransactionModal = useCallback((tx: Transaction) => {
    setTxModalMode('edit');
    setTxModalDefaultType(tx.type);
    setTxModalEditing(tx);
    setTxModalOpen(true);
  }, []);

  const closeTransactionModal = useCallback(() => {
    setTxModalOpen(false);
    setTxModalEditing(null);
  }, []);

  const openDuplicateModal = useCallback(
    (tx?: Transaction) => {
      if (tx) {
        setDuplicateModalTarget(tx);
        return;
      }
      const pool = allTransactions.length > 0 ? allTransactions : transactions;
      // Pick latest recurring transaction or latest transaction overall
      const recurringCandidate =
        pool.find((t) => t.is_recurring) || pool[0] || null;
      if (recurringCandidate) {
        setDuplicateModalTarget(recurringCandidate);
      }
    },
    [allTransactions, transactions]
  );

  const closeDuplicateModal = useCallback(() => {
    setDuplicateModalTarget(null);
  }, []);

  const formatAmount = useCallback(
    (amount: number, showSign: boolean = false) =>
      formatMoney(
        amount,
        settings.currency,
        settings.decimal_separator,
        showSign
      ),
    [settings.currency, settings.decimal_separator]
  );

  const formatDate = useCallback(
    (isoDate: string) => formatDisplayDate(isoDate, settings.date_format),
    [settings.date_format]
  );

  const t = useMemo(
    () => (TRANSLATIONS[settings.language] || TRANSLATIONS.en) as TranslationDictionary,
    [settings.language]
  );

  const isRtl = settings.language === 'ar';

  const value = useMemo<AppContextValue>(
    () => ({
      loading,
      activeTab,
      setActiveTab,
      activityLogSourceTab,
      openEntityActivityLog,
      clearEntityActivityLog,
      summary,
      accounts,
      categories,
      projects,
      transactions,
      allTransactions,
      txFilter,
      setTxFilter,
      settings,
      updateAppSetting,
      t,
      isRtl,
      authState,
      isLocked,
      lockNow,
      unlockWithPin,
      refreshAll,
      formatAmount,
      formatDate,
      txModalOpen,
      txModalMode,
      txModalDefaultType,
      txModalEditing,
      openAddTransactionModal,
      openEditTransactionModal,
      closeTransactionModal,
      duplicateModalTarget,
      openDuplicateModal,
      closeDuplicateModal,
    }),
    [
      loading,
      activeTab,
      activityLogSourceTab,
      openEntityActivityLog,
      clearEntityActivityLog,
      summary,
      accounts,
      categories,
      projects,
      transactions,
      allTransactions,
      txFilter,
      settings,
      updateAppSetting,
      t,
      isRtl,
      authState,
      isLocked,
      lockNow,
      unlockWithPin,
      refreshAll,
      formatAmount,
      formatDate,
      txModalOpen,
      txModalMode,
      txModalDefaultType,
      txModalEditing,
      openAddTransactionModal,
      openEditTransactionModal,
      closeTransactionModal,
      duplicateModalTarget,
      openDuplicateModal,
      closeDuplicateModal,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
