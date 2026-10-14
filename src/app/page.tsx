'use client';

/**
 * @file page.tsx
 * @description Single-page workspace router for PocketClear.
 * Mounts the global AppProvider, security LockScreen, first-run OnboardingWizard,
 * AppShell navigation frame, and the active view (Dashboard, Activity Log,
 * Worksheet, Projects, Settings, or User Guide & Security Policy).
 */

import React from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import { AppShell } from '@/components/layout/AppShell';
import { LockScreen } from '@/components/layout/LockScreen';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { TransactionsView } from '@/components/transactions/TransactionsView';
import {
  ProjectsView,
  WorksheetView,
} from '@/components/projects/ProjectsView';
import { SettingsView } from '@/components/settings/SettingsView';
import { GuideAndSecurityView } from '@/components/guide/GuideAndSecurityView';
import { TransactionModal } from '@/components/transactions/TransactionModal';
import { DuplicateModal } from '@/components/transactions/DuplicateModal';

function FinanceWorkspace() {
  const { loading, activeTab } = useApp();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-500 text-sm font-semibold">
        Loading local database...
      </div>
    );
  }

  return (
    <>
      <LockScreen />
      <OnboardingWizard />
      <AppShell>
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'transactions' && <TransactionsView />}
        {activeTab === 'worksheet' && <WorksheetView />}
        {activeTab === 'projects' && <ProjectsView />}
        {activeTab === 'settings' && <SettingsView />}
        {activeTab === 'guide' && <GuideAndSecurityView />}
      </AppShell>
      <TransactionModal />
      <DuplicateModal />
    </>
  );
}

export default function HomePage() {
  return (
    <AppProvider>
      <FinanceWorkspace />
    </AppProvider>
  );
}
