/**
 * @file csv.ts
 * @description RFC-4180 compliant CSV parser, preview validator, and serializer for
 * importing and exporting PocketClear transactions offline.
 */
import { CsvPreviewRow, RecurringInterval, Transaction, TransactionType } from '@/types/finance';
import { getTodayIso } from '@/lib/utils';
import { csvRowInputSchema } from '@/lib/schemas';

function parseCsvAmount(rawCell: string): { value: number; hasExplicitPlus: boolean } {
  const cleaned = rawCell.trim();
  const hasExplicitPlus = cleaned.startsWith('+');
  let numStr = cleaned.replace(/[^0-9.,-]/g, '');
  if (!numStr) return { value: Number.NaN, hasExplicitPlus };

  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastDot > lastComma) {
      // Format like 1,250.50 -> comma is thousands separator
      numStr = numStr.replace(/,/g, '');
    } else {
      // Format like 1.250,50 -> dot is thousands separator, comma is decimal
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma >= 0) {
    const commaCount = (numStr.match(/,/g) || []).length;
    const afterComma = numStr.slice(lastComma + 1);
    if (commaCount === 1 && afterComma.length <= 2) {
      // Format like 18,50 -> comma is decimal separator
      numStr = numStr.replace(',', '.');
    } else {
      // Format like 1,000 or 1,000,000 -> comma is thousands separator
      numStr = numStr.replace(/,/g, '');
    }
  }

  return { value: parseFloat(numStr), hasExplicitPlus };
}

function escapeCsvCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  cells.push(current.trim());
  return cells;
}

export function serializeTransactionsToCsv(transactions: Transaction[]): string {
  const headers = [
    'Date',
    'Payee',
    'Amount',
    'Type',
    'Category',
    'Project',
    'Recurring',
    'Interval',
    'Notes',
  ];

  const rows = transactions.map((t) =>
    [
      t.date,
      t.payee,
      t.amount.toFixed(2),
      t.type,
      t.category_name || 'Uncategorized',
      t.project_name || '',
      t.is_recurring ? '1' : '0',
      t.recurring_interval || '',
      t.notes || '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

export function parseAndPreviewCsv(rawCsv: string): CsvPreviewRow[] {
  const lines = rawCsv
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const firstCells = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader =
    firstCells.includes('date') ||
    firstCells.includes('payee') ||
    firstCells.includes('amount');

  const colMap = {
    date: firstCells.indexOf('date') >= 0 ? firstCells.indexOf('date') : 0,
    payee: firstCells.indexOf('payee') >= 0 ? firstCells.indexOf('payee') : 1,
    amount: firstCells.indexOf('amount') >= 0 ? firstCells.indexOf('amount') : 2,
    type: firstCells.indexOf('type') >= 0 ? firstCells.indexOf('type') : 3,
    category:
      firstCells.indexOf('category') >= 0
        ? firstCells.indexOf('category')
        : firstCells.indexOf('bucket') >= 0
        ? firstCells.indexOf('bucket')
        : 4,
    project: firstCells.indexOf('project') >= 0 ? firstCells.indexOf('project') : 5,
    recurring: firstCells.indexOf('recurring') >= 0 ? firstCells.indexOf('recurring') : 6,
    interval: firstCells.indexOf('interval') >= 0 ? firstCells.indexOf('interval') : 7,
    notes: firstCells.indexOf('notes') >= 0 ? firstCells.indexOf('notes') : 8,
  };

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const preview: CsvPreviewRow[] = [];

  for (const line of dataLines) {
    const cells = parseCsvLine(line);
    const rawDate = (cells[colMap.date] || getTodayIso()).trim();
    const payee = (cells[colMap.payee] || '').trim();
    const { value: parsedNum, hasExplicitPlus } = parseCsvAmount(cells[colMap.amount] || '');
    const rawType = (cells[colMap.type] || '').toLowerCase().trim();
    const category = (cells[colMap.category] || 'General').trim() || 'General';
    const project = (cells[colMap.project] || '').trim() || undefined;
    const rawRec = (cells[colMap.recurring] || '').toLowerCase().trim();
    const rawInterval = (cells[colMap.interval] || '').toLowerCase().trim();
    const notes = (cells[colMap.notes] || '').trim() || undefined;

    let normalizedType: string = rawType;
    if (
      rawType === 'income' ||
      rawType === 'money in' ||
      rawType === 'in' ||
      rawType === 'credit' ||
      (rawType === '' && parsedNum > 0 && hasExplicitPlus)
    ) {
      normalizedType = 'income';
    } else if (
      rawType === 'expense' ||
      rawType === 'money out' ||
      rawType === 'out' ||
      rawType === 'debit' ||
      rawType === ''
    ) {
      normalizedType = 'expense';
    }

    const amount = Math.round(Math.abs(parsedNum) * 100) / 100;
    const isRecurring = rawRec === '1' || rawRec === 'true' || rawRec === 'yes';
    const interval: RecurringInterval | null = isRecurring
      ? rawInterval === 'weekly' || rawInterval === 'yearly'
        ? (rawInterval as RecurringInterval)
        : 'monthly'
      : null;

    const candidate = {
      date: rawDate,
      payee,
      amount: Number.isFinite(amount) ? amount : 0,
      type: normalizedType,
      category,
      project,
      is_recurring: isRecurring,
      recurring_interval: interval,
      notes,
    };

    const validation = csvRowInputSchema.safeParse(candidate);
    const error = validation.success
      ? undefined
      : validation.error.issues[0]?.message;

    preview.push({
      ...candidate,
      type: validation.success
        ? validation.data.type
        : normalizedType === 'income'
        ? 'income'
        : ('expense' as TransactionType),
      valid: validation.success,
      error,
    });
  }

  return preview;
}
