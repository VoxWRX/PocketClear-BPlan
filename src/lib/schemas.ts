/**
 * @file schemas.ts
 * @description Strict Zod v4 runtime validation schemas for all IPC command payloads,
 * CSV import rows, application settings, and database backup snapshots.
 */
import { z } from 'zod';
import { isValidIsoDate } from '@/lib/utils';
import type {
  NewAccount,
  UpdateAccount,
  NewCategory,
  UpdateCategory,
  NewProject,
  UpdateProject,
  NewTransaction,
  UpdateTransaction,
  Transaction,
  TransactionFilter,
  OnboardingPayload,
  AppSettings,
  RecurringInterval,
} from '@/types/finance';

export const languageCodeSchema = z.enum(['en', 'fr', 'ar'], {
  message: "Language must be 'en', 'fr', or 'ar'.",
});

export const currencyCodeSchema = z
  .string({ message: 'Currency cannot be empty.' })
  .trim()
  .min(1, { message: 'Currency cannot be empty.' });

export const transactionTypeSchema = z.enum(['income', 'expense'], {
  message: "Transaction type must be 'income' or 'expense'.",
});

export const categoryTypeSchema = z.enum(['income', 'expense'], {
  message: "Category type must be 'income' or 'expense'.",
});

export const projectStatusSchema = z.enum(['active', 'completed', 'paused'], {
  message: "Project status must be 'active', 'completed', or 'paused'.",
});

export const projectKindSchema = z.enum(['month', 'project'], {
  message: "Project kind must be 'month' or 'project'.",
});

export const recurringIntervalSchema = z.enum(['weekly', 'monthly', 'yearly'], {
  message: "Recurring interval must be 'weekly', 'monthly', or 'yearly'.",
});

export const healthStatusSchema = z.enum(['safe', 'heads_up', 'attention']);

export const themeModeSchema = z.enum(['light', 'dark', 'system'], {
  message: "Theme must be 'light', 'dark', or 'system'.",
});

export const accentPaletteSchema = z.enum(['emerald', 'blue'], {
  message: "Accent palette must be 'emerald' or 'blue'.",
});

export const decimalSeparatorSchema = z.enum(['.', ','], {
  message: "Decimal separator must be '.' or ','.",
});

export const dateFormatOptionSchema = z.enum(
  ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
  {
    message: "Date format must be 'YYYY-MM-DD', 'DD/MM/YYYY', or 'MM/DD/YYYY'.",
  }
);

export const isoDateSchema = z
  .string({ message: 'Invalid transaction date (use YYYY-MM-DD).' })
  .trim()
  .refine((val) => isValidIsoDate(val), {
    message: 'Invalid transaction date (use YYYY-MM-DD).',
  });

export const pinSchema = z
  .string({ message: 'PIN or password must be at least 4 characters.' })
  .trim()
  .min(4, { message: 'PIN or password must be at least 4 characters.' });

export const newAccountSchema: z.ZodType<NewAccount> = z.object({
  name: z
    .string({ message: 'Account name is required.' })
    .trim()
    .min(1, { message: 'Account name is required.' }),
  starting_balance: z
    .number({ message: 'Starting balance must be a valid number.' })
    .refine((val) => Number.isFinite(val), {
      message: 'Starting balance must be a valid number.',
    }),
  currency: z
    .string()
    .trim()
    .default('USD')
    .transform((val) => val || 'USD'),
});

export const updateAccountSchema: z.ZodType<UpdateAccount> = z.object({
  id: z.string().trim().min(1, { message: 'Account ID is required.' }),
  name: z
    .string({ message: 'Account name cannot be empty.' })
    .trim()
    .min(1, { message: 'Account name cannot be empty.' })
    .optional(),
  currency: currencyCodeSchema.optional(),
});

const optionalMonthlyBudgetSchema = z
  .number({ message: 'Monthly budget must be zero or positive.' })
  .refine((val) => Number.isFinite(val) && val >= 0, {
    message: 'Monthly budget must be zero or positive.',
  })
  .nullable()
  .optional();

export const newCategorySchema: z.ZodType<NewCategory> = z.object({
  name: z
    .string({ message: 'Category name is required.' })
    .trim()
    .min(1, { message: 'Category name is required.' }),
  type: categoryTypeSchema,
  icon: z
    .string()
    .trim()
    .default('circle')
    .transform((val) => val || 'circle'),
  color: z
    .string()
    .trim()
    .optional()
    .transform((val) => val || '#10b981'),
  monthly_budget: optionalMonthlyBudgetSchema,
});

export const updateCategorySchema: z.ZodType<UpdateCategory> = z.object({
  id: z.string().trim().min(1, { message: 'Category ID is required.' }),
  name: z
    .string({ message: 'Category name cannot be empty.' })
    .trim()
    .min(1, { message: 'Category name cannot be empty.' })
    .optional(),
  icon: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val === undefined ? undefined : val || 'circle')),
  color: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val === undefined ? undefined : val || '#10b981')),
  monthly_budget: optionalMonthlyBudgetSchema,
});

export const newProjectSchema: z.ZodType<NewProject> = z.object({
  name: z
    .string({ message: 'Project name is required.' })
    .trim()
    .min(1, { message: 'Project name is required.' }),
  target_budget: z
    .number({ message: 'Target budget must be zero or positive.' })
    .refine((val) => Number.isFinite(val) && val >= 0, {
      message: 'Target budget must be zero or positive.',
    }),
  status: projectStatusSchema.optional().default('active'),
  kind: projectKindSchema
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
});

export const updateProjectSchema: z.ZodType<UpdateProject> = z.object({
  id: z.string().trim().min(1, { message: 'Project ID is required.' }),
  name: z
    .string({ message: 'Project name cannot be empty.' })
    .trim()
    .min(1, { message: 'Project name cannot be empty.' })
    .optional(),
  target_budget: z
    .number({ message: 'Target budget must be zero or positive.' })
    .refine((val) => Number.isFinite(val) && val >= 0, {
      message: 'Target budget must be zero or positive.',
    })
    .optional(),
  status: projectStatusSchema.optional(),
  kind: projectKindSchema
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
});

export const newTransactionSchema: z.ZodType<NewTransaction> = z.object({
  account_id: z.string().trim().min(1, { message: 'Account ID is required.' }),
  category_id: z.string().trim().min(1, { message: 'Category ID is required.' }),
  project_id: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  amount: z
    .number({ message: 'Transaction amount must be a positive number.' })
    .refine((val) => Number.isFinite(val) && val > 0, {
      message: 'Transaction amount must be a positive number.',
    }),
  type: transactionTypeSchema,
  payee: z
    .string({ message: 'Payee name is required.' })
    .trim()
    .min(1, { message: 'Payee name is required.' }),
  date: isoDateSchema,
  is_recurring: z.boolean().optional(),
  recurring_interval: recurringIntervalSchema.nullable().optional(),
  notes: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
});

export const updateTransactionSchema: z.ZodType<UpdateTransaction> = z.object({
  id: z.string().trim().min(1, { message: 'Transaction ID is required.' }),
  account_id: z.string().trim().min(1).optional(),
  category_id: z.string().trim().min(1).optional(),
  project_id: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val) =>
      val === undefined ? undefined : val && val.length > 0 ? val : null
    ),
  clear_project_id: z.boolean().optional(),
  amount: z
    .number({ message: 'Transaction amount must be positive.' })
    .refine((val) => Number.isFinite(val) && val > 0, {
      message: 'Transaction amount must be positive.',
    })
    .optional(),
  type: transactionTypeSchema.optional(),
  payee: z
    .string({ message: 'Payee cannot be empty.' })
    .trim()
    .min(1, { message: 'Payee cannot be empty.' })
    .optional(),
  date: isoDateSchema.optional(),
  is_recurring: z.boolean().optional(),
  recurring_interval: recurringIntervalSchema.nullable().optional(),
  notes: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val) =>
      val === undefined ? undefined : val && val.length > 0 ? val : null
    ),
});

export interface DuplicateTransactionInput {
  id: string;
  newDate?: string | null;
  markRecurring?: boolean;
  recurringInterval?: RecurringInterval | null;
}

export const duplicateTransactionSchema: z.ZodType<DuplicateTransactionInput> =
  z.object({
    id: z.string().trim().min(1, { message: 'Transaction ID is required.' }),
    newDate: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined))
      .refine((val) => val === undefined || isValidIsoDate(val), {
        message: 'Invalid transaction date (use YYYY-MM-DD).',
      }),
    markRecurring: z.boolean().optional(),
    recurringInterval: recurringIntervalSchema.nullable().optional(),
  });

const optionalFilterIsoDateSchema = z
  .string()
  .trim()
  .optional()
  .transform((val) => (val && val.length > 0 ? val : undefined))
  .refine((val) => val === undefined || isValidIsoDate(val), {
    message: 'Invalid filter date (use YYYY-MM-DD).',
  });

export const transactionFilterSchema: z.ZodType<TransactionFilter> = z.object({
  search: z.string().optional(),
  type: transactionTypeSchema.optional(),
  category_id: z.string().optional(),
  project_id: z.string().optional(),
  only_recurring: z.boolean().optional(),
  only_projects: z.boolean().optional(),
  date_from: optionalFilterIsoDateSchema,
  date_to: optionalFilterIsoDateSchema,
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
});

export const onboardingPayloadSchema: z.ZodType<OnboardingPayload> = z.object({
  account_name: z
    .string()
    .trim()
    .transform((val) => val || 'Main Pocket'),
  starting_balance: z
    .number({ message: 'Starting balance must be a valid number.' })
    .refine((val) => Number.isFinite(val), {
      message: 'Starting balance must be a valid number.',
    }),
  currency: z
    .string()
    .trim()
    .default('USD')
    .transform((val) => val || 'USD'),
  language: languageCodeSchema.optional(),
  categories: z.array(newCategorySchema),
});

export const csvRowInputSchema = z.object({
  date: z
    .string({ message: 'Invalid date (use YYYY-MM-DD)' })
    .trim()
    .refine((val) => isValidIsoDate(val), {
      message: 'Invalid date (use YYYY-MM-DD)',
    }),
  payee: z
    .string({ message: 'Missing payee' })
    .trim()
    .min(1, { message: 'Missing payee' }),
  amount: z
    .number({ message: 'Amount must be greater than 0' })
    .refine((val) => Number.isFinite(val) && val > 0, {
      message: 'Amount must be greater than 0',
    }),
  type: transactionTypeSchema,
  category: z
    .string()
    .trim()
    .default('General')
    .transform((val) => val || 'General'),
  project: z.string().trim().optional(),
  is_recurring: z.boolean().optional(),
  recurring_interval: recurringIntervalSchema.nullable().optional(),
  notes: z.string().trim().optional(),
});

export const appSettingsSchema: z.ZodType<AppSettings> = z.object({
  currency: currencyCodeSchema,
  language: languageCodeSchema,
  theme: themeModeSchema,
  accent: accentPaletteSchema,
  decimal_separator: decimalSeparatorSchema,
  date_format: dateFormatOptionSchema,
  auto_lock_minutes: z.number().int().positive(),
});

export const settingUpdateSchema = z
  .object({
    key: z
      .string({ message: 'Setting key is required.' })
      .trim()
      .min(1, { message: 'Setting key is required.' }),
    value: z.string({ message: 'Setting value must be a string.' }),
  })
  .superRefine(({ key, value }, ctx) => {
    if (key === 'pin_hash') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use verifyOrSetPin to manage PIN hash.',
      });
      return;
    }
    const knownValidators: Record<string, z.ZodTypeAny> = {
      currency: currencyCodeSchema,
      language: languageCodeSchema,
      theme: themeModeSchema,
      accent: accentPaletteSchema,
      decimal_separator: decimalSeparatorSchema,
      date_format: dateFormatOptionSchema,
      auto_lock_minutes: z
        .string()
        .trim()
        .refine(
          (v) => {
            const n = Number(v);
            return Number.isInteger(n) && n > 0;
          },
          { message: 'Auto-lock minutes must be a positive integer.' }
        ),
    };
    const validator = knownValidators[key];
    if (validator) {
      const res = validator.safeParse(value);
      if (!res.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            res.error.issues[0]?.message ||
            `Invalid value for setting '${key}'.`,
        });
      }
    }
  });

export function resolveAppSettings(
  rawSettings: Record<string, string>,
  accountCurrency?: string,
  authAutoLockMinutes?: number
): AppSettings {
  const candidate = {
    currency: currencyCodeSchema
      .catch('USD')
      .parse(accountCurrency || rawSettings.currency || 'USD'),
    language: languageCodeSchema.catch('en').parse(rawSettings.language),
    theme: themeModeSchema.catch('system').parse(rawSettings.theme),
    accent: accentPaletteSchema.catch('emerald').parse(rawSettings.accent),
    decimal_separator: decimalSeparatorSchema
      .catch('.')
      .parse(rawSettings.decimal_separator),
    date_format: dateFormatOptionSchema
      .catch('YYYY-MM-DD')
      .parse(rawSettings.date_format),
    auto_lock_minutes: z.coerce
      .number()
      .int()
      .positive()
      .catch(15)
      .parse(rawSettings.auto_lock_minutes ?? authAutoLockMinutes ?? 15),
  };
  return parseWithSchema(appSettingsSchema, candidate);
}

export const backupAccountRowSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  starting_balance: z
    .number()
    .refine((val) => Number.isFinite(val), {
      message: 'Account starting balance must be a finite number.',
    })
    .default(0),
  current_balance: z.number().refine((val) => Number.isFinite(val), {
    message: 'Account current balance must be a finite number.',
  }),
  currency: currencyCodeSchema.default('USD'),
  created_at: z.string().default(() => new Date().toISOString()),
});

export const backupCategoryRowSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: categoryTypeSchema,
  icon: z
    .string()
    .trim()
    .default('circle')
    .transform((val) => val || 'circle'),
  color: z
    .string()
    .trim()
    .default('#10b981')
    .transform((val) => val || '#10b981'),
  monthly_budget: optionalMonthlyBudgetSchema.default(null),
});

export const backupProjectRowSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  target_budget: z
    .number()
    .refine((val) => Number.isFinite(val) && val >= 0, {
      message: 'Project target budget must be zero or positive.',
    })
    .default(0),
  status: projectStatusSchema.default('active'),
  kind: projectKindSchema
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
  created_at: z.string().default(() => new Date().toISOString()),
});

export const backupTransactionRowSchema: z.ZodType<Transaction> = z.object({
  id: z.string().trim().min(1, { message: 'Transaction ID is required.' }),
  account_id: z
    .string()
    .trim()
    .min(1, { message: 'Transaction account_id is required.' }),
  category_id: z
    .string()
    .trim()
    .min(1, { message: 'Transaction category_id is required.' }),
  category_name: z.string().optional(),
  category_icon: z.string().optional(),
  category_color: z.string().optional(),
  project_id: z.string().nullable().optional().default(null),
  project_name: z.string().nullable().optional(),
  amount: z
    .number({ message: 'Transaction amount must be a positive number.' })
    .refine((val) => Number.isFinite(val) && val > 0, {
      message: 'Transaction amount must be a positive number.',
    }),
  type: transactionTypeSchema,
  payee: z
    .string({ message: 'Transaction payee is required.' })
    .trim()
    .min(1, { message: 'Transaction payee is required.' }),
  date: isoDateSchema,
  is_recurring: z.boolean().optional().default(false),
  recurring_interval: recurringIntervalSchema.nullable().optional().default(null),
  notes: z.string().nullable().optional().default(null),
  created_at: z.string().default(() => new Date().toISOString()),
});

export const backupStoreSchema = z.object({
  accounts: z.array(backupAccountRowSchema, {
    message: 'Backup is missing required tables.',
  }),
  categories: z.array(backupCategoryRowSchema, {
    message: 'Backup is missing required tables.',
  }),
  projects: z.array(backupProjectRowSchema).optional().default([]),
  transactions: z.array(backupTransactionRowSchema, {
    message: 'Backup is missing required tables.',
  }),
  app_settings: z.record(z.string(), z.string()).optional().default({}),
});

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new Error(firstIssue?.message || 'Validation failed.');
  }
  return result.data;
}
