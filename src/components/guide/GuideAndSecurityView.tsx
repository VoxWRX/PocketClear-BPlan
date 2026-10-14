'use client';

/**
 * @file GuideAndSecurityView.tsx
 * @description Dedicated User Guide and Security Policy view for PocketClear.
 * Displays the application banner (`/banner.png`), brand logo (`/logo.jpg`),
 * a 6-step interactive user manual, keyboard shortcut reference, and a
 * comprehensive breakdown of PocketClear's 100% offline local-first security model
 * (SQLite WAL, Argon2id key derivation, inactivity auto-lock, CSP, and backup verification).
 */

import React, { useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FolderKanban,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  ListOrdered,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { cn } from '@/lib/utils';

type GuideSectionTab = 'guide' | 'security';

export function GuideAndSecurityView() {
  const { t } = useApp();
  const [subTab, setSubTab] = useState<GuideSectionTab>('guide');

  const guideCards = [
    {
      id: 'onboarding',
      title: t.guide.sections.onboardingTitle,
      body: t.guide.sections.onboardingBody,
      icon: <Sparkles className="w-5 h-5 text-emerald-500" />,
    },
    {
      id: 'worksheet',
      title: t.guide.sections.worksheetTitle,
      body: t.guide.sections.worksheetBody,
      icon: <Calendar className="w-5 h-5 text-blue-500" />,
    },
    {
      id: 'projects',
      title: t.guide.sections.projectsTitle,
      body: t.guide.sections.projectsBody,
      icon: <FolderKanban className="w-5 h-5 text-purple-500" />,
    },
    {
      id: 'activity',
      title: t.guide.sections.activityTitle,
      body: t.guide.sections.activityBody,
      icon: <ListOrdered className="w-5 h-5 text-amber-500" />,
    },
    {
      id: 'dashboard',
      title: t.guide.sections.dashboardTitle,
      body: t.guide.sections.dashboardBody,
      icon: <LayoutDashboard className="w-5 h-5 text-cyan-500" />,
    },
    {
      id: 'backup',
      title: t.guide.sections.backupTitle,
      body: t.guide.sections.backupBody,
      icon: <FileSpreadsheet className="w-5 h-5 text-rose-500" />,
    },
  ];

  const securityPillars = [
    {
      id: 'sqlite-wal',
      title: t.guide.security.pillar1Title,
      body: t.guide.security.pillar1Body,
      icon: <Database className="w-5 h-5 text-emerald-500" />,
    },
    {
      id: 'argon2id',
      title: t.guide.security.pillar2Title,
      body: t.guide.security.pillar2Body,
      icon: <KeyRound className="w-5 h-5 text-blue-500" />,
    },
    {
      id: 'autolock',
      title: t.guide.security.pillar3Title,
      body: t.guide.security.pillar3Body,
      icon: <Lock className="w-5 h-5 text-amber-500" />,
    },
    {
      id: 'csp',
      title: t.guide.security.pillar4Title,
      body: t.guide.security.pillar4Body,
      icon: <ShieldCheck className="w-5 h-5 text-purple-500" />,
    },
    {
      id: 'backup-integrity',
      title: t.guide.security.pillar5Title,
      body: t.guide.security.pillar5Body,
      icon: <CheckCircle2 className="w-5 h-5 text-cyan-500" />,
    },
  ];

  return (
    <div className="space-y-6" data-testid="guide-security-view">
      {/* Visual Hero Banner with Brand Logo & Official Banner Image */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-white shadow-lg">
        <div className="relative h-44 sm:h-56 w-full overflow-hidden">
          <img
            src="/banner.png"
            alt="PocketClear Banner"
            data-testid="guide-hero-banner-img"
            className="w-full h-full object-cover object-center opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />
        </div>

        <div className="relative -mt-20 sm:-mt-24 px-6 pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src="/logo.jpg"
              alt="PocketClear Logo"
              data-testid="guide-brand-logo-img"
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-white/20 shadow-xl bg-slate-950 shrink-0"
            />
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 mb-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t.guide.heroBadge}
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {t.guide.title}
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
                {t.guide.subtitle}
              </p>
            </div>
          </div>

          {/* Sub-navigation Tabs: User Guide vs Security Policy */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 p-1.5 rounded-2xl shrink-0">
            <button
              type="button"
              data-testid="guide-tab-manual"
              onClick={() => setSubTab('guide')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all',
                subTab === 'guide'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              )}
            >
              <BookOpen className="w-4 h-4" />
              <span>{t.guide.tabGuide}</span>
            </button>
            <button
              type="button"
              data-testid="guide-tab-security"
              onClick={() => setSubTab('security')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all',
                subTab === 'security'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              )}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{t.guide.tabSecurity}</span>
            </button>
          </div>
        </div>
      </section>

      {subTab === 'guide' ? (
        <div className="space-y-6" data-testid="user-guide-content">
          {/* Quick Start Overview */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">
                  {t.guide.quickStartTitle}
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  {t.guide.quickStartDesc}
                </p>
              </div>
            </div>
          </section>

          {/* 6 Step-by-Step Guide Cards */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guideCards.map((card) => (
              <div
                key={card.id}
                data-testid={`guide-card-${card.id}`}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col justify-between gap-3"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      {card.icon}
                    </div>
                    <h3 className="text-sm font-extrabold tracking-tight">
                      {card.title}
                    </h3>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {card.body}
                  </p>
                </div>
              </div>
            ))}
          </section>

          {/* Keyboard Shortcuts & Tips */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center">
                <Keyboard className="w-5 h-5" />
              </div>
              <h2 className="text-base font-extrabold tracking-tight">
                {t.guide.shortcutsTitle}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 p-3.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.guide.shortcutDuplicate}
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 p-3.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.guide.shortcutEscape}
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 p-3.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.guide.shortcutEntityClick}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-6" data-testid="security-policy-content">
          {/* Security Policy Overview Banner */}
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/15 p-6">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                  {t.guide.security.bannerTitle}
                </h2>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 mt-1 leading-relaxed">
                  {t.guide.security.bannerDesc}
                </p>
              </div>
            </div>
          </section>

          {/* 5 Security Pillars */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {securityPillars.map((pillar) => (
              <div
                key={pillar.id}
                data-testid={`security-pillar-${pillar.id}`}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-2.5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    {pillar.icon}
                  </div>
                  <h3 className="text-sm font-extrabold tracking-tight">
                    {pillar.title}
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {pillar.body}
                </p>
              </div>
            ))}
          </section>

          {/* Compliance & Verification Checklist */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
            <h3 className="text-base font-extrabold tracking-tight flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span>{t.guide.security.auditTitle}</span>
            </h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {t.guide.security.auditItems.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 p-3 text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
