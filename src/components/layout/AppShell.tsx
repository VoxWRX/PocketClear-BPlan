'use client';

/**
 * @file AppShell.tsx
 * @description Primary responsive application shell for PocketClear.
 * Renders the sidebar navigation (Dashboard, Activity Log, Worksheet, Projects,
 * Settings, and User Guide & Security), brand logo (`/logo.jpg`), quick language
 * switcher (EN/FR/AR with RTL layout adaptation), manual PIN lock trigger, and
 * global keyboard shortcut listener (`Ctrl/Cmd + D` for recurring duplication).
 */

import React, { useEffect } from 'react';
import {
  BookOpen,
  FileSpreadsheet,
  FolderKanban,
  LayoutDashboard,
  ListOrdered,
  Lock,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { NavTab, useApp } from '@/context/AppContext';
import { LanguageCode } from '@/types/finance';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    activeTab,
    setActiveTab,
    txFilter,
    clearEntityActivityLog,
    t,
    isRtl,
    settings,
    updateAppSetting,
    authState,
    lockNow,
    openDuplicateModal,
  } = useApp();

  // Global keyboard shortcut: Ctrl/Cmd + D to open Smart Recurring Duplication Modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        openDuplicateModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openDuplicateModal]);

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'dashboard',
      label: t.nav.dashboard,
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'transactions',
      label: t.nav.transactions,
      icon: <ListOrdered className="w-4 h-4" />,
    },
    {
      id: 'worksheet',
      label: t.nav.worksheet,
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },
    {
      id: 'projects',
      label: t.nav.projects,
      icon: <FolderKanban className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: t.nav.settings,
      icon: <Settings className="w-4 h-4" />,
    },
    {
      id: 'guide',
      label: t.nav.guide,
      icon: <BookOpen className="w-4 h-4" />,
    },
  ];

  const handleSelectNav = (tabId: NavTab) => {
    if (txFilter.project_id) {
      clearEntityActivityLog();
    }
    setActiveTab(tabId);
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="min-h-screen flex flex-col lg:flex-row bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
    >
      {/* Sidebar */}
      <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between p-4">
        <div>
          <div className="flex items-center justify-between lg:justify-start gap-3 px-2 py-2">
            <div className="flex items-center gap-2.5">
              <img
                src="/logo.jpg"
                alt={t.appName}
                data-testid="sidebar-brand-logo"
                className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm shrink-0"
              />
              <div>
                <span className="font-extrabold text-lg tracking-tight block leading-none">
                  {t.appName}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  100% Offline SQLite
                </span>
              </div>
            </div>

            {/* Mobile Language Selector */}
            <div className="flex lg:hidden items-center gap-1">
              {(['en', 'fr', 'ar'] as LanguageCode[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => updateAppSetting('language', lang)}
                  className={cn(
                    'px-2 py-1 rounded-md text-xs font-bold uppercase',
                    settings.language === lang
                      ? 'bg-accent text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  )}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          <nav className="mt-4 flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`nav-${item.id}`}
                  onClick={() => handleSelectNav(item.id)}
                  className={cn(
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap lg:whitespace-normal text-start',
                    active
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                  )}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="leading-snug">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom sidebar controls */}
        <div className="hidden lg:flex flex-col gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl">
            {(['en', 'fr', 'ar'] as LanguageCode[]).map((lang) => (
              <button
                key={lang}
                type="button"
                data-testid={`lang-switch-${lang}`}
                onClick={() => updateAppSetting('language', lang)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-bold uppercase transition-all',
                  settings.language === lang
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                )}
              >
                {lang}
              </button>
            ))}
          </div>

          {authState.has_pin && (
            <button
              type="button"
              data-testid="sidebar-lock-btn"
              onClick={lockNow}
              className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{t.nav.lockApp}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Utility Bar */}
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span>{t.offlineBadge}</span>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
