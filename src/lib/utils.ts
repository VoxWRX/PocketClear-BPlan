/**
 * @file utils.ts
 * @description Pure utility functions for currency formatting, ISO-8601 date validation,
 * recurring due-date stepping, spending health evaluation, and project/month kind inference.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  CurrencyCode,
  DateFormatOption,
  DecimalSeparator,
  HealthStatus,
  ProjectKind,
  RecurringInterval,
} from '@/types/finance';

/**
 * Merges conditional Tailwind CSS class names without style conflicts.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Rounds a floating-point monetary amount to 2 decimal places (cents) and normalizes `-0` to `0`.
 */
export function roundCents(val: number): number {
  const rounded = Math.round((val + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export const CURRENCY_META: Record<
  string,
  { symbol: string; code: CurrencyCode | string; position: 'prefix' | 'suffix' }
> = {
  USD: { symbol: '$', code: 'USD', position: 'prefix' },
  EUR: { symbol: '€', code: 'EUR', position: 'prefix' },
  GBP: { symbol: '£', code: 'GBP', position: 'prefix' },
  MAD: { symbol: 'MAD', code: 'MAD', position: 'suffix' },
};

/**
 * Formats a numeric amount with currency symbol/code, thousands grouping, and decimal separator.
 */
export function formatMoney(
  amount: number,
  currency: string = 'USD',
  decimalSeparator: DecimalSeparator = '.',
  showSign: boolean = false
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const isNegative = safeAmount < 0;
  const abs = Math.abs(safeAmount);
  const fixed = abs.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const thousandsSep = decimalSeparator === ',' ? ' ' : ',';
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
  const formattedNumber = `${groupedInt}${decimalSeparator}${decPart}`;

  const meta = CURRENCY_META[currency] || {
    symbol: currency,
    code: currency,
    position: 'prefix',
  };

  const withCurrency =
    meta.position === 'prefix'
      ? `${meta.symbol}${formattedNumber}`
      : `${formattedNumber} ${meta.symbol}`;

  if (isNegative) {
    return `-${withCurrency}`;
  }
  if (showSign && safeAmount > 0) {
    return `+${withCurrency}`;
  }
  return withCurrency;
}

/**
 * Converts an ISO-8601 date (`YYYY-MM-DD`) into the user's preferred display format.
 */
export function formatDisplayDate(
  isoDate: string,
  format: DateFormatOption = 'YYYY-MM-DD'
): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  if (format === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  if (format === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  return `${y}-${m}-${d}`;
}

/**
 * Returns today's local date formatted as `YYYY-MM-DD`.
 */
export function getTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns yesterday's local date formatted as `YYYY-MM-DD`.
 */
export function getYesterdayIso(now: Date = new Date()): string {
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return getTodayIso(yest);
}

/**
 * Returns the exact number of calendar days in a 1-indexed month (accounting for leap years).
 */
export function daysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

/**
 * Strictly validates that a string is a real calendar date in `YYYY-MM-DD` format.
 */
export function isValidIsoDate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  const maxDay = daysInMonth(year, month);
  return day >= 1 && day <= maxDay;
}

/**
 * Computes the next scheduled due date and days remaining for a recurring transaction,
 * clamping month-end and leap-year dates safely.
 */
export function computeNextDueDate(
  lastDateStr: string,
  interval: RecurringInterval = 'monthly',
  referenceDateStr: string = getTodayIso()
): { nextDueDate: string; daysUntilDue: number } {
  const [ry, rm, rd] = referenceDateStr.split('-').map(Number);
  const refTime = Date.UTC(ry, rm - 1, rd);

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(lastDateStr);
  if (!match) {
    return { nextDueDate: referenceDateStr, daysUntilDue: 0 };
  }
  let y = Number(match[1]);
  let m = Number(match[2]);
  let d = Number(match[3]);
  const origDay = d;

  // Always advance at least one interval after last recorded payment date
  const advanceOnce = () => {
    if (interval === 'weekly') {
      const dt = new Date(Date.UTC(y, m - 1, d + 7));
      y = dt.getUTCFullYear();
      m = dt.getUTCMonth() + 1;
      d = dt.getUTCDate();
    } else if (interval === 'yearly') {
      y += 1;
      const maxD = daysInMonth(y, m);
      d = Math.min(origDay, maxD);
    } else {
      // monthly
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      const maxD = daysInMonth(y, m);
      d = Math.min(origDay, maxD);
    }
  };

  advanceOnce();
  let guard = 0;
  while (Date.UTC(y, m - 1, d) < refTime - 7 * 86400000 && guard < 240) {
    advanceOnce();
    guard++;
  }

  const nextTime = Date.UTC(y, m - 1, d);
  const diffDays = Math.round((nextTime - refTime) / 86400000);
  const nextDueDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { nextDueDate, daysUntilDue: diffDays };
}

export interface HealthEvaluation {
  health_status: HealthStatus;
  left_to_spend_this_month: number;
  daily_allowance: number;
  days_remaining_in_month: number;
}

/**
 * Evaluates monthly spending pacing (`safe`, `heads_up`, or `attention`),
 * remaining monthly cushion, and safe daily allowance.
 */
export function evaluateSpendingHealth(params: {
  totalBalance: number;
  moneyInThisMonth: number;
  moneyOutThisMonth: number;
  referenceDateStr?: string;
}): HealthEvaluation {
  const refStr = params.referenceDateStr || getTodayIso();
  const [y, m, d] = refStr.slice(0, 10).split('-').map(Number);
  const totalDays = daysInMonth(y || 2026, m || 1);
  const currentDay = Math.max(1, Math.min(totalDays, d || 1));
  const daysRemaining = Math.max(1, totalDays - currentDay + 1);

  const { totalBalance, moneyInThisMonth, moneyOutThisMonth } = params;

  const rawLeftToSpend = moneyInThisMonth - moneyOutThisMonth;
  const leftToSpend = Object.is(rawLeftToSpend, -0) ? 0 : rawLeftToSpend;

  const spendablePool =
    moneyInThisMonth > 0
      ? Math.min(moneyInThisMonth - moneyOutThisMonth, totalBalance)
      : totalBalance;

  const dailyAllowance =
    spendablePool > 0
      ? Math.round((spendablePool / daysRemaining) * 100) / 100
      : 0;

  let healthStatus: HealthStatus = 'safe';

  if (
    totalBalance < 0 ||
    (moneyInThisMonth > 0 && moneyOutThisMonth > moneyInThisMonth) ||
    (moneyInThisMonth === 0 && totalBalance <= 0 && moneyOutThisMonth > 0)
  ) {
    healthStatus = 'attention';
  } else {
    const baselinePool =
      moneyInThisMonth > 0
        ? moneyInThisMonth
        : totalBalance + moneyOutThisMonth;
    const expectedRatio = currentDay / totalDays;
    const actualRatio = baselinePool > 0 ? moneyOutThisMonth / baselinePool : 0;

    if (actualRatio > expectedRatio + 0.12 || actualRatio > 0.85) {
      healthStatus = 'heads_up';
    } else {
      healthStatus = 'safe';
    }
  }

  return {
    health_status: healthStatus,
    left_to_spend_this_month: Math.round(leftToSpend * 100) / 100,
    daily_allowance: dailyAllowance,
    days_remaining_in_month: daysRemaining,
  };
}

/**
 * Simulates the impact of a prospective purchase on monthly spending health and daily allowance.
 */
export function simulatePurchaseImpact(params: {
  purchaseAmount: number;
  totalBalance: number;
  moneyInThisMonth: number;
  moneyOutThisMonth: number;
  referenceDateStr?: string;
}): {
  status: HealthStatus;
  newDailyAllowance: number;
} {
  const amt = Number.isFinite(params.purchaseAmount) && params.purchaseAmount > 0
    ? params.purchaseAmount
    : 0;

  const currentEval = evaluateSpendingHealth({
    totalBalance: params.totalBalance,
    moneyInThisMonth: params.moneyInThisMonth,
    moneyOutThisMonth: params.moneyOutThisMonth,
    referenceDateStr: params.referenceDateStr,
  });

  const afterEval = evaluateSpendingHealth({
    totalBalance: params.totalBalance - amt,
    moneyInThisMonth: params.moneyInThisMonth,
    moneyOutThisMonth: params.moneyOutThisMonth + amt,
    referenceDateStr: params.referenceDateStr,
  });

  if (
    afterEval.health_status === 'attention' ||
    amt > Math.max(params.totalBalance, currentEval.left_to_spend_this_month)
  ) {
    return { status: 'attention', newDailyAllowance: afterEval.daily_allowance };
  }

  if (
    afterEval.health_status === 'heads_up' ||
    (currentEval.daily_allowance > 0 && amt > currentEval.daily_allowance * 2)
  ) {
    return { status: 'heads_up', newDailyAllowance: afterEval.daily_allowance };
  }

  return { status: 'safe', newDailyAllowance: afterEval.daily_allowance };
}

const MONTH_NAMES_PATTERN =
  'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر';

const EXPLICIT_MONTH_PREFIX_RE = /^(?:mois|month|شهر)(?:$|\s|[-_./:#\d])/i;
const ISO_OR_NUMERIC_MONTH_RE =
  /^(?:\d{4}[-/](?:0?[1-9]|1[0-2])|(?:0?[1-9]|1[0-2])[-/]\d{4})(?:$|\b)/;
const STANDALONE_OR_DATED_MONTH_RE = new RegExp(
  `^(?:${MONTH_NAMES_PATTERN})(?:$|[\\s,._/-]+(?:\\d{1,4}|${MONTH_NAMES_PATTERN})$)`,
  'i'
);

/**
 * Infers whether a record in the `projects` table represents a monthly worksheet entry (`'month'`)
 * or a long-term goal/project (`'project'`), honoring an explicit `kind` when provided.
 */
export function inferProjectKind(
  name: string,
  explicitKind?: string | null
): ProjectKind {
  if (explicitKind === 'month' || explicitKind === 'project') {
    return explicitKind;
  }
  const normalized = (name || '').trim().toLowerCase();
  if (!normalized) return 'project';
  if (
    EXPLICIT_MONTH_PREFIX_RE.test(normalized) ||
    ISO_OR_NUMERIC_MONTH_RE.test(normalized) ||
    STANDALONE_OR_DATED_MONTH_RE.test(normalized)
  ) {
    return 'month';
  }
  return 'project';
}

/**
 * Extracts a 4-digit calendar year from a worksheet month's name, its transaction dates,
 * or its creation timestamp.
 */
export function extractYearFromMonthOrDate(
  name: string,
  createdAt?: string,
  txDates?: string[]
): string {
  const yearInName = /\b(20\d{2}|19\d{2})\b/.exec(name || '');
  if (yearInName) {
    return yearInName[1];
  }
  if (txDates && txDates.length > 0) {
    const firstTxYear = /^(\d{4})/.exec(txDates[0]);
    if (firstTxYear) return firstTxYear[1];
  }
  if (createdAt) {
    const createdYear = /^(\d{4})/.exec(createdAt.trim());
    if (createdYear) return createdYear[1];
  }
  return getTodayIso().slice(0, 4);
}

