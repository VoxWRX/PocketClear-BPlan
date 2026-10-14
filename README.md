# PocketClear — 100% Offline Personal Finance & Project Tracker

![PocketClear Banner](public/banner.png)

<p align="center">
  <img src="public/logo.jpg" alt="PocketClear Logo" width="96" height="96" style="border-radius: 20px;" />
</p>

**PocketClear** is a beginner-friendly, **100% offline**, cross-platform desktop application for personal finance, monthly income/expense worksheets, and project/goal tracking. Built with **Tauri v2 (Rust + SQLite)** and **Next.js 14 (React 18 + TypeScript + Tailwind CSS)**, it operates with zero cloud accounts, zero external network calls, and full multilingual support (**English, Français, العربية with RTL**).

---

## ✨ Key Features

1. **First-Run Onboarding Wizard**
   - Guided 3-step setup on a fresh database: choose your language (`EN`, `FR`, `AR` with dynamic RTL layout) and currency (`USD`, `EUR`, `MAD`, `GBP`), set your initial pocket balance, and pick 4–6 starter spending categories.
2. **Income / Expense Worksheet (*Feuille de calcul revenus / dépenses*)**
   - Create monthly budget entries (e.g., `"Mois 11"`, `"November 2026"`) with an **Allocated Base Amount**.
   - Click any Month card to open its dedicated **Activity Log** and record monthly expenses or additional income.
   - Manage global **Expense Categories (*Catégories de dépenses*)** with custom icons, color swatches, and optional monthly limits.
3. **Project & Goal Tracking (*Suivis de projet et d’objectifs*)**
   - Track long-term savings or spending goals (e.g., *Achat Voiture*, *Emergency Fund*, *Home Renovation*) separately from monthly living expenses.
   - Clicking a Project card opens its dedicated Activity Log featuring a single **`[Contribute]`** button that records contributions without polluting monthly worksheet totals.
4. **Read-Only Analytical Dashboard (*Tableau de bord*)**
   - **Month View (*Vue de mois*)** vs **Year View (*Vue d’année*)** selector.
   - **3 Core KPI Cards**: *Money In*, *Money Out*, and *Left to Spend*.
   - **Visual Charts**: *Where Did My Money Go?* (Top 5 Categories + `"Other"` Donut Chart) and *Money In vs. Money Out Timeline* (Bar Chart).
   - **Projects Summary Table**: Displays every project's status, target budget, contributed amount, remaining balance, progress bar, and the **Total Global Contribution**.
5. **Smart Recurring Duplication (`Ctrl/Cmd + D`)**
   - Duplicate any recurring bill or paycheck in 2 clicks with a custom payment date and interval (`weekly`, `monthly`, `yearly`).
6. **In-App User Guide & Security Policy**
   - Built-in **User Guide & Security** navigation tab providing interactive documentation and a transparent breakdown of the local-first security model.
7. **Local Cryptographic Security & Data Portability**
   - **Argon2id PIN / Master Password Lock** with configurable inactivity auto-lock (`5`, `15`, or `30` minutes).
   - **Verified SQLite Backup & Restore** (`.sqlite` files checked via `PRAGMA integrity_check`).
   - **RFC-4180 CSV Import & Export Wizard** with live validation preview.

---

## 🏗️ Architecture & Tech Stack

```text
BPlan_V4/
├── public/
│   ├── logo.jpg              # Official brand logo
│   ├── favicon.jpg           # Brand favicon (JPEG)
│   ├── favicon.ico           # Browser/OS icon
│   └── banner.png            # Official wide header banner
├── src/
│   ├── app/                  # Next.js App Router (layout.tsx, page.tsx, globals.css)
│   ├── components/
│   │   ├── dashboard/        # DashboardView.tsx (Month/Year KPIs, Charts, Projects Summary)
│   │   ├── guide/            # GuideAndSecurityView.tsx (In-app User Guide & Security Policy)
│   │   ├── layout/           # AppShell.tsx (Sidebar + Header) & LockScreen.tsx (Argon2id Lock)
│   │   ├── onboarding/       # OnboardingWizard.tsx (3-step first-run wizard)
│   │   ├── projects/         # ProjectsView.tsx (WorksheetView & ProjectsView)
│   │   ├── settings/         # SettingsView.tsx (PIN Lock, Preferences, SQLite/CSV Portability)
│   │   ├── transactions/     # TransactionsView.tsx, TransactionModal.tsx, DuplicateModal.tsx
│   │   └── ui/               # Modal.tsx & BucketIcon.tsx
│   ├── context/              # AppContext.tsx (Global state, i18n, auto-lock timer, modals)
│   ├── i18n/                 # translations.ts (Complete EN, FR, AR dictionaries)
│   ├── lib/                  # ipc.ts, schemas.ts (Zod), utils.ts, csv.ts, argon2-auth.ts, engines
│   └── types/                # finance.ts (Domain interfaces)
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs / main.rs  # Tauri v2 bootstrap & plugin registration
│   │   ├── db.rs             # SQLite WAL schema, foreign keys, backup integrity validator
│   │   ├── auth.rs           # Argon2id PIN hashing & verification (Rust argon2 crate)
│   │   ├── models.rs         # Serde request/response DTO structs
│   │   └── commands.rs       # 25 Tauri IPC commands with ACID SQLite transactions
│   ├── icons/                # Desktop bundle icons (PNG, ICNS, ICO)
│   └── tauri.conf.json       # Strict CSP & cross-platform bundle config
└── tests/                    # Vitest + React Testing Library + real SQLite integration suites
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** `>= 20.x` (includes native `node:sqlite` for running the integration test suite)
- **Rust** `>= 1.77` & Cargo (for building the native Tauri v2 desktop executable)

### Installation & Development

```bash
# Install dependencies
npm install

# Run Next.js web development server
npm run dev

# Launch full Tauri v2 native desktop app in development mode
npm run tauri dev

# Build production desktop bundles (.dmg, .app, .msi, .nsis, .deb, .AppImage)
npm run tauri build
```

### Verification & Testing

```bash
# Type-check the entire TypeScript codebase
npx tsc --noEmit

# Run all unit, domain, SQLite, and UI integration tests
npm test
```

---

## 📚 Additional Documentation

- [**Detailed User Guide (`USER_GUIDE.md`)**](./USER_GUIDE.md) — Step-by-step instructions in English & French.
- [**Security & Privacy Policy (`SECURITY.md`)**](./SECURITY.md) — Technical specification of our offline SQLite, Argon2id, and CSP security guarantees.
