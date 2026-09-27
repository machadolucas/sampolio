import { z } from 'zod';
import { idSchema, yearMonthSchema } from './id.schema';
import type {
  FinancialAccount,
  RecurringItem,
  PlannedItem,
  SalaryConfig,
  TaxedIncome,
  InvestmentAccount,
  InvestmentContribution,
  Debt,
  DebtReferenceRate,
  DebtExtraPayment,
  Receivable,
  ReceivableRepayment,
  Goal,
  Budget,
  BalanceSnapshot,
  ReconciliationAdjustment,
  ReconciliationSession,
  UserPreferences,
} from '@/types';

// Envelope for the Settings → Data & Export JSON backup. Per-entity validation
// is deliberately minimal: loose objects let unknown/new fields survive an
// export → import round-trip across app versions. Two things ARE enforced,
// because the payload is otherwise attacker-controlled:
// - every id is a safe path segment (`idSchema`): ids become file/dir names;
// - the fields the projection loops iterate over (months, frequencies,
//   intervals, horizons) are well-formed, so a stored row can't stall
//   `calculateProjection` (see `getPlannedRepeatingOccurrences`).
// Any mismatch rejects the whole payload — nothing is written.
const entityRow = z.looseObject({ id: idSchema });

// Row caps: the 20 MB server-action body limit is global, and each row becomes
// one encrypted file. Generous for a household (years of data), small enough
// to bound the disk/CPU one request can consume.
export const MAX_IMPORT_ROWS_PER_ARRAY = 20_000;
export const MAX_IMPORT_ROWS_TOTAL = 50_000;
const rows = <T extends z.ZodType>(row: T) => z.array(row).max(MAX_IMPORT_ROWS_PER_ARRAY);

// Optional month fields have been stored absent, as '' (cleared form field) or
// as null; all three mean "not set".
const optionalMonth = z.union([yearMonthSchema, z.literal(''), z.null()]).optional();
const frequencySchema = z.enum(['monthly', 'quarterly', 'yearly', 'custom']);
const intervalMonthsSchema = z.number().int().positive().max(1200).nullish();

const recurringRow = entityRow.extend({
  frequency: frequencySchema,
  customIntervalMonths: intervalMonthsSchema,
  startDate: yearMonthSchema,
  endDate: optionalMonth,
});

const plannedRow = entityRow.extend({
  kind: z.enum(['one-off', 'repeating']),
  frequency: frequencySchema.nullish(),
  customIntervalMonths: intervalMonthsSchema,
  scheduledDate: optionalMonth,
  firstOccurrence: optionalMonth,
  endDate: optionalMonth,
});

const accountRow = entityRow.extend({
  startingDate: yearMonthSchema,
  planningHorizonMonths: z.number().int().min(1).max(600),
  customEndDate: optionalMonth,
  recurringItems: rows(recurringRow),
  plannedItems: rows(plannedRow),
  salaryConfigs: rows(entityRow),
  taxedIncomes: rows(entityRow),
});

const investmentRow = entityRow.extend({ contributions: rows(entityRow) });
const debtRow = entityRow.extend({ referenceRates: rows(entityRow), extraPayments: rows(entityRow) });
const receivableRow = entityRow.extend({ repayments: rows(entityRow) });

export const EXPORT_FORMAT = 'sampolio-export';
export const EXPORT_VERSION = 1;

export const dataExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().positive(),
  exportedAt: z.string(),
  appVersion: z.string().optional(),
  userId: z.string(),
  entities: z.object({
    accounts: rows(accountRow),
    investments: rows(investmentRow),
    debts: rows(debtRow),
    receivables: rows(receivableRow),
    goals: rows(entityRow),
    budgets: rows(entityRow),
    reconciliation: z.object({
      snapshots: rows(entityRow),
      adjustments: rows(entityRow),
      sessions: rows(entityRow),
    }),
    preferences: z.looseObject({}).nullable(),
  }).refine((e) => countImportRows(e) <= MAX_IMPORT_ROWS_TOTAL, {
    message: `Backup has too many rows (max ${MAX_IMPORT_ROWS_TOTAL.toLocaleString('fi-FI')})`,
  }),
  notIncluded: z.array(z.string()),
});

type RowList = readonly unknown[];
function countImportRows(e: {
  accounts: Array<{ recurringItems: RowList; plannedItems: RowList; salaryConfigs: RowList; taxedIncomes: RowList }>;
  investments: Array<{ contributions: RowList }>;
  debts: Array<{ referenceRates: RowList; extraPayments: RowList }>;
  receivables: Array<{ repayments: RowList }>;
  goals: RowList;
  budgets: RowList;
  reconciliation: { snapshots: RowList; adjustments: RowList; sessions: RowList };
}): number {
  let n = e.goals.length + e.budgets.length
    + e.reconciliation.snapshots.length + e.reconciliation.adjustments.length + e.reconciliation.sessions.length;
  for (const a of e.accounts) {
    n += 1 + a.recurringItems.length + a.plannedItems.length + a.salaryConfigs.length + a.taxedIncomes.length;
  }
  for (const i of e.investments) n += 1 + i.contributions.length;
  for (const d of e.debts) n += 1 + d.referenceRates.length + d.extraPayments.length;
  for (const r of e.receivables) n += 1 + r.repayments.length;
  return n;
}

// The concrete payload type, in app types. The Zod schema above validates the
// same shape structurally (with loose objects so unknown fields survive) —
// import code safeParses with the schema, then treats the result as DataExport.
export interface DataExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  appVersion?: string;
  userId: string;
  entities: {
    accounts: Array<FinancialAccount & {
      recurringItems: RecurringItem[];
      plannedItems: PlannedItem[];
      salaryConfigs: SalaryConfig[];
      taxedIncomes: TaxedIncome[];
    }>;
    investments: Array<InvestmentAccount & { contributions: InvestmentContribution[] }>;
    debts: Array<Debt & { referenceRates: DebtReferenceRate[]; extraPayments: DebtExtraPayment[] }>;
    receivables: Array<Receivable & { repayments: ReceivableRepayment[] }>;
    goals: Goal[];
    budgets: Budget[];
    reconciliation: {
      snapshots: BalanceSnapshot[];
      adjustments: ReconciliationAdjustment[];
      sessions: ReconciliationSession[];
    };
    preferences: UserPreferences | null;
  };
  notIncluded: string[];
}

export const importOptionsSchema = z.object({
  mode: z.enum(['merge', 'replace']),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;
