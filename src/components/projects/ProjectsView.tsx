'use client';

/**
 * @file ProjectsView.tsx
 * @description Shared entity workspace component powering two distinct views:
 * 1. `WorksheetView` (`mode = 'month'`): "Feuille de calcule revenus / dépenses" —
 *    manages monthly budget allocations and global expense categories ("Catégorie de dépenses").
 * 2. `ProjectsView` (`mode = 'project'`): "Suivis de projet et d’objectifs" —
 *    manages dedicated savings/spending projects and goals.
 * Clicking any Month or Project card opens its filtered Activity Log in `TransactionsView`.
 */

import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Calendar,
  Edit3,
  FolderKanban,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  AVAILABLE_BUCKET_ICONS,
  BucketIcon,
} from '@/components/ui/BucketIcon';
import { Modal } from '@/components/ui/Modal';
import { ipc } from '@/lib/ipc';
import {
  newCategorySchema,
  newProjectSchema,
  updateCategorySchema,
  updateProjectSchema,
} from '@/lib/schemas';
import {
  Category,
  Project,
  ProjectKind,
  ProjectStatus,
} from '@/types/finance';
import { cn, inferProjectKind } from '@/lib/utils';

const COLOR_SWATCHES = [
  '#10b981',
  '#2563eb',
  '#8b5cf6',
  '#f59e0b',
  '#f43f5e',
  '#06b6d4',
  '#ec4899',
  '#64748b',
];

interface EntityWorkspaceProps {
  mode: ProjectKind;
}

function EntityWorkspace({ mode }: EntityWorkspaceProps) {
  const {
    projects,
    categories,
    t,
    formatAmount,
    refreshAll,
    openEntityActivityLog,
  } = useApp();

  const isMonthMode = mode === 'month';

  const filteredEntities = useMemo(
    () =>
      projects.filter((p) => inferProjectKind(p.name, p.kind) === mode),
    [projects, mode]
  );

  // Expense categories ("Catégorie de dépenses")
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories]
  );

  const [subTab, setSubTab] = useState<'entities' | 'categories'>('entities');

  // Entity (Month or Project) Modal State
  const [entityModalOpen, setEntityModalOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Project | null>(null);
  const [entityName, setEntityName] = useState('');
  const [entityBudget, setEntityBudget] = useState('1000');
  const [entityStatus, setEntityStatus] = useState<ProjectStatus>('active');
  const [entityError, setEntityError] = useState<string | null>(null);

  // Expense Category Modal State
  const [bucketModalOpen, setBucketModalOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<Category | null>(null);
  const [bucketName, setBucketName] = useState('');
  const [bucketIcon, setBucketIcon] = useState<string>('shopping-cart');
  const [bucketColor, setBucketColor] = useState<string>('#10b981');
  const [bucketLimit, setBucketLimit] = useState<string>('');
  const [bucketError, setBucketError] = useState<string | null>(null);

  const openNewEntity = () => {
    setEditingEntity(null);
    setEntityName('');
    setEntityBudget('1000');
    setEntityStatus('active');
    setEntityError(null);
    setEntityModalOpen(true);
  };

  const openEditEntity = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEntity(p);
    setEntityName(p.name);
    setEntityBudget(String(p.target_budget));
    setEntityStatus(p.status);
    setEntityError(null);
    setEntityModalOpen(true);
  };

  const handleSaveEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntityError(null);
    const budget = parseFloat(entityBudget.replace(',', '.'));

    try {
      if (editingEntity) {
        const parsed = updateProjectSchema.safeParse({
          id: editingEntity.id,
          name: entityName.trim(),
          target_budget: budget,
          status: entityStatus,
          kind: mode,
        });
        if (!parsed.success) {
          setEntityError(
            parsed.error.issues[0]?.message || 'Invalid input.'
          );
          return;
        }
        await ipc.updateProject(parsed.data);
      } else {
        const parsed = newProjectSchema.safeParse({
          name: entityName.trim(),
          target_budget: budget,
          status: entityStatus,
          kind: mode,
        });
        if (!parsed.success) {
          setEntityError(
            parsed.error.issues[0]?.message || 'Invalid input.'
          );
          return;
        }
        await ipc.createProject(parsed.data);
      }
      setEntityModalOpen(false);
      await refreshAll();
    } catch (err) {
      setEntityError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteEntity = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await ipc.deleteProject(id);
    await refreshAll();
  };

  const handleOpenActivityLog = (entityId: string) => {
    openEntityActivityLog(entityId, isMonthMode ? 'worksheet' : 'projects');
  };

  const openNewBucket = () => {
    setEditingBucket(null);
    setBucketName('');
    setBucketIcon('shopping-cart');
    setBucketColor('#10b981');
    setBucketLimit('');
    setBucketError(null);
    setBucketModalOpen(true);
  };

  const openEditBucket = (c: Category) => {
    setEditingBucket(c);
    setBucketName(c.name);
    setBucketIcon(c.icon);
    setBucketColor(c.color || '#10b981');
    setBucketLimit(
      c.monthly_budget !== null && c.monthly_budget !== undefined
        ? String(c.monthly_budget)
        : ''
    );
    setBucketError(null);
    setBucketModalOpen(true);
  };

  const handleSaveBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    setBucketError(null);
    const parsedLimit = bucketLimit.trim()
      ? parseFloat(bucketLimit.replace(',', '.'))
      : null;

    try {
      if (editingBucket) {
        const parsed = updateCategorySchema.safeParse({
          id: editingBucket.id,
          name: bucketName.trim(),
          icon: bucketIcon,
          color: bucketColor,
          monthly_budget: parsedLimit,
        });
        if (!parsed.success) {
          setBucketError(
            parsed.error.issues[0]?.message || 'Invalid category input.'
          );
          return;
        }
        await ipc.updateCategory(parsed.data);
      } else {
        const parsed = newCategorySchema.safeParse({
          name: bucketName.trim(),
          type: 'expense',
          icon: bucketIcon,
          color: bucketColor,
          monthly_budget: parsedLimit,
        });
        if (!parsed.success) {
          setBucketError(
            parsed.error.issues[0]?.message || 'Invalid category input.'
          );
          return;
        }
        await ipc.createCategory(parsed.data);
      }
      setBucketModalOpen(false);
      await refreshAll();
    } catch (err) {
      setBucketError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteBucket = async (id: string) => {
    await ipc.deleteCategory(id);
    await refreshAll();
  };

  const viewTestId = isMonthMode ? 'worksheet-view' : 'projects-view';
  const title = isMonthMode ? t.worksheet.title : t.projects.title;
  const subtitle = isMonthMode ? t.worksheet.subtitle : t.projects.subtitle;
  const newEntityBtnLabel = isMonthMode
    ? t.worksheet.newMonthBtn
    : t.projects.newProjectBtn;
  const newEntityBtnTestId = isMonthMode ? 'new-month-btn' : 'new-project-btn';
  const newCategoryBtnLabel = t.worksheet.newCategoryBtn;
  const newCategoryBtnTestId = 'new-category-btn';
  const tabEntitiesLabel = isMonthMode
    ? t.worksheet.tabMonths
    : t.projects.tabProjects;
  const tabEntitiesTestId = isMonthMode ? 'subtab-months' : 'subtab-projects';
  const tabCategoriesLabel = t.worksheet.tabCategories;
  const tabCategoriesTestId = 'subtab-categories';
  const emptyEntitiesLabel = isMonthMode
    ? t.worksheet.emptyMonths
    : t.projects.emptyProjects;
  const emptyEntitiesTestId = isMonthMode
    ? 'months-empty-state'
    : 'projects-empty-state';

  return (
    <div className="space-y-6" data-testid={viewTestId}>
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid={newEntityBtnTestId}
            onClick={openNewEntity}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:opacity-95 text-white text-xs font-bold shadow-xs transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>{newEntityBtnLabel}</span>
          </button>
          {isMonthMode && (
            <button
              type="button"
              data-testid={newCategoryBtnTestId}
              onClick={openNewBucket}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition-all"
            >
              <Layers className="w-4 h-4 text-emerald-500" />
              <span>{newCategoryBtnLabel}</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          type="button"
          data-testid={tabEntitiesTestId}
          onClick={() => setSubTab('entities')}
          className={cn(
            'px-4 py-2 rounded-xl text-xs font-bold transition-all',
            !isMonthMode || subTab === 'entities'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
        >
          {tabEntitiesLabel} ({filteredEntities.length})
        </button>
        {isMonthMode && (
          <button
            type="button"
            data-testid={tabCategoriesTestId}
            onClick={() => setSubTab('categories')}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all',
              subTab === 'categories'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
          >
            {tabCategoriesLabel} ({expenseCategories.length})
          </button>
        )}
      </div>

      {/* Clickable Month / Project Cards */}
      {!isMonthMode || subTab === 'entities' ? (
        filteredEntities.length === 0 ? (
          <div
            data-testid={emptyEntitiesTestId}
            className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center text-sm text-slate-400"
          >
            {emptyEntitiesLabel}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredEntities.map((p) => {
              const totalBudget = isMonthMode
                ? Math.round((p.target_budget + p.income_amount) * 100) / 100
                : Math.round(p.target_budget * 100) / 100;
              const activityAmount = isMonthMode
                ? Math.round(p.spent_amount * 100) / 100
                : Math.round((p.spent_amount + p.income_amount) * 100) / 100;
              const remaining = Math.max(
                0,
                Math.round((totalBudget - activityAmount) * 100) / 100
              );
              const rawPct =
                totalBudget > 0
                  ? Math.round((activityAmount / totalBudget) * 100)
                  : 0;
              const barPct = Math.min(100, Math.max(0, rawPct));
              const isOverBudget =
                totalBudget > 0 && activityAmount > totalBudget;

              const statusLabel =
                p.status === 'completed'
                  ? t.common.completed
                  : p.status === 'paused'
                  ? t.common.paused
                  : t.common.active;

              const cardTestId = isMonthMode
                ? `month-card-${p.name}`
                : `project-card-${p.name}`;
              const editTestId = isMonthMode
                ? `edit-month-${p.name}`
                : `edit-project-${p.name}`;
              const deleteTestId = isMonthMode
                ? `delete-month-${p.name}`
                : `delete-project-${p.name}`;
              const progressTestId = isMonthMode
                ? `month-progress-bar-${p.name}`
                : `project-progress-bar-${p.name}`;

              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  data-testid={cardTestId}
                  onClick={() => handleOpenActivityLog(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenActivityLog(p.id);
                    }
                  }}
                  className="group cursor-pointer text-start rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 bg-white dark:bg-slate-900 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-4 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                          {isMonthMode ? (
                            <Calendar className="w-5 h-5" />
                          ) : (
                            <FolderKanban className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-base truncate flex items-center gap-1.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            <span>{p.name}</span>
                            <ArrowUpRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity shrink-0" />
                          </h3>
                          <span
                            className={cn(
                              'inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full mt-0.5',
                              p.status === 'active' &&
                                'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                              p.status === 'completed' &&
                                'bg-blue-500/15 text-blue-600 dark:text-blue-400',
                              p.status === 'paused' &&
                                'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            )}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={editTestId}
                          onClick={(e) => openEditEntity(p, e)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          data-testid={deleteTestId}
                          onClick={(e) => handleDeleteEntity(p.id, e)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Visual Budget Meter */}
                    <div className="mt-4 space-y-2">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-slate-500 font-medium">
                          {(isMonthMode
                            ? t.worksheet.usedPercent
                            : t.projects.usedPercent
                          ).replace('{pct}', String(rawPct))}
                        </span>
                        <span className="font-mono font-bold tabular-nums">
                          {formatAmount(activityAmount)} /{' '}
                          {formatAmount(totalBudget)}
                        </span>
                      </div>

                      <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          data-testid={progressTestId}
                          className={cn(
                            'h-full rounded-full transition-all duration-300',
                            isOverBudget
                              ? 'bg-rose-500'
                              : rawPct >= 85
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          )}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stats Footer */}
                  <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          {isMonthMode
                            ? t.worksheet.allocatedBase
                            : t.projects.targetBudget}
                        </span>
                        <span className="font-mono font-bold tabular-nums">
                          {formatAmount(p.target_budget)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          {isMonthMode
                            ? t.worksheet.spentAmount
                            : t.projects.currentSpend}
                        </span>
                        <span className="font-mono font-bold tabular-nums text-rose-600 dark:text-rose-400">
                          {formatAmount(activityAmount)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          {isMonthMode
                            ? t.worksheet.remainingBalance
                            : t.projects.remainingBalance}
                        </span>
                        <span className="font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatAmount(remaining)}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 pt-1">
                      <ArrowUpRight className="w-3 h-3" />
                      <span>
                        {isMonthMode
                          ? t.worksheet.openActivityLogHint
                          : t.projects.openActivityLogHint}
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Expense Categories ("Catégorie de dépenses") Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {expenseCategories.map((cat) => (
            <div
              key={cat.id}
              data-testid={`bucket-card-${cat.name}`}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: cat.color || '#10b981' }}
                >
                  <BucketIcon name={cat.icon} className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{cat.name}</p>
                  <p className="text-xs text-slate-400">
                    {cat.monthly_budget !== null &&
                    cat.monthly_budget !== undefined ? (
                      <>
                        {t.worksheet.allocatedCeiling} •{' '}
                        <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                          {formatAmount(cat.monthly_budget)}
                        </span>
                      </>
                    ) : (
                      <span>{t.worksheet.noCeiling}</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title={t.common.edit}
                  data-testid={`edit-bucket-${cat.name}`}
                  onClick={() => openEditBucket(cat)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title={t.common.delete}
                  data-testid={`delete-bucket-${cat.name}`}
                  onClick={() => handleDeleteBucket(cat.id)}
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Entity (Month or Project) Create/Edit Modal */}
      <Modal
        open={entityModalOpen}
        onClose={() => setEntityModalOpen(false)}
        title={
          editingEntity
            ? isMonthMode
              ? t.worksheet.monthModalEdit
              : t.projects.projectModalEdit
            : isMonthMode
            ? t.worksheet.monthModalNew
            : t.projects.projectModalNew
        }
        maxWidthClass="max-w-md"
        dataTestId={isMonthMode ? 'month-modal' : 'project-modal'}
      >
        <form onSubmit={handleSaveEntity} className="space-y-4">
          <div>
            <label
              htmlFor={isMonthMode ? 'month-name-input' : 'project-name-input'}
              className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {isMonthMode
                ? t.worksheet.monthNameLabel
                : t.projects.projectNameLabel}
            </label>
            <input
              id={isMonthMode ? 'month-name-input' : 'project-name-input'}
              data-testid={
                isMonthMode ? 'month-name-input' : 'project-name-input'
              }
              type="text"
              required
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              placeholder={
                isMonthMode
                  ? t.worksheet.monthNamePlaceholder
                  : t.projects.projectNamePlaceholder
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={
                  isMonthMode ? 'month-budget-input' : 'project-budget-input'
                }
                className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                {isMonthMode
                  ? t.worksheet.monthTargetLabel
                  : t.projects.projectTargetLabel}
              </label>
              <input
                id={
                  isMonthMode ? 'month-budget-input' : 'project-budget-input'
                }
                data-testid={
                  isMonthMode ? 'month-budget-input' : 'project-budget-input'
                }
                type="number"
                step="0.01"
                min="0"
                required
                value={entityBudget}
                onChange={(e) => setEntityBudget(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label
                htmlFor={
                  isMonthMode ? 'month-status-select' : 'project-status-select'
                }
                className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
              >
                {isMonthMode
                  ? t.worksheet.monthStatusLabel
                  : t.projects.projectStatusLabel}
              </label>
              <select
                id={
                  isMonthMode ? 'month-status-select' : 'project-status-select'
                }
                data-testid={
                  isMonthMode ? 'month-status-select' : 'project-status-select'
                }
                value={entityStatus}
                onChange={(e) =>
                  setEntityStatus(e.target.value as ProjectStatus)
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="active">{t.common.active}</option>
                <option value="completed">{t.common.completed}</option>
                <option value="paused">{t.common.paused}</option>
              </select>
            </div>
          </div>

          {entityError && (
            <p className="text-xs text-rose-500 font-medium">{entityError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEntityModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              data-testid={
                isMonthMode ? 'month-submit-btn' : 'project-submit-btn'
              }
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              {t.common.save}
            </button>
          </div>
        </form>
      </Modal>

      {/* Expense Category ("Catégorie de dépenses") Create/Edit Modal */}
      <Modal
        open={bucketModalOpen}
        onClose={() => setBucketModalOpen(false)}
        title={
          editingBucket ? t.projects.bucketModalEdit : t.projects.bucketModalNew
        }
        maxWidthClass="max-w-md"
        dataTestId="bucket-modal"
      >
        <form onSubmit={handleSaveBucket} className="space-y-4">
          <div>
            <label
              htmlFor="bucket-name-input"
              className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {t.projects.bucketNameLabel}
            </label>
            <input
              id="bucket-name-input"
              data-testid="bucket-name-input"
              type="text"
              required
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="bucket-limit-input"
              className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {t.projects.bucketBudgetLabel}
            </label>
            <input
              id="bucket-limit-input"
              data-testid="bucket-limit-input"
              type="number"
              step="0.01"
              min="0"
              value={bucketLimit}
              onChange={(e) => setBucketLimit(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              {t.projects.bucketColorLabel}
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setBucketColor(hex)}
                  className={cn(
                    'w-7 h-7 rounded-lg transition-transform',
                    bucketColor === hex &&
                      'ring-2 ring-offset-2 ring-slate-900 dark:ring-white scale-110'
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              Icon
            </label>
            <div className="grid grid-cols-8 gap-1.5">
              {AVAILABLE_BUCKET_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setBucketIcon(ic)}
                  className={cn(
                    'p-2 rounded-lg border flex items-center justify-center',
                    bucketIcon === ic
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                  )}
                >
                  <BucketIcon name={ic} className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {bucketError && (
            <p className="text-xs text-rose-500 font-medium">{bucketError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setBucketModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              data-testid="bucket-submit-btn"
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              {t.common.save}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function WorksheetView() {
  return <EntityWorkspace mode="month" />;
}

export function ProjectsView() {
  return <EntityWorkspace mode="project" />;
}
