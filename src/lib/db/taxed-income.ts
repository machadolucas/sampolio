import { v4 as uuidv4 } from 'uuid';
import type {
  TaxedIncome,
  CreateTaxedIncomeRequest,
  UpdateTaxedIncomeRequest,
  SalaryConfig,
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { taxedIncome } from './sqlite/schema';
import { readSalaryConfigs } from './salary-configs';
import { calculateTaxedIncomeNet } from '@/lib/taxed-income-utils';

const scope = (userId: string, accountId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  accountId: assertSafeId(accountId, 'accountId'),
});
const key = (userId: string, accountId: string, incomeId: string) => ({
  ...scope(userId, accountId),
  id: assertSafeId(incomeId),
});

function readTaxedIncomes(userId: string, accountId: string): TaxedIncome[] {
  const incomes = listDocs<TaxedIncome>(taxedIncome, scope(userId, accountId));
  return incomes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Get default tax settings from salary configs
function getDefaultTaxSettings(
  userId: string,
  accountId: string
): { taxRate: number; contributionsRate: number; otherDeductions: number } | null {
  const salaryConfigs = readSalaryConfigs(userId, accountId);
  const activeConfig = salaryConfigs.find((c: SalaryConfig) => c.isActive);

  if (activeConfig) {
    return {
      taxRate: activeConfig.taxRate,
      contributionsRate: activeConfig.contributionsRate,
      otherDeductions: activeConfig.otherDeductions,
    };
  }
  return null;
}

// ============================================================
// TAXED INCOME CRUD
// ============================================================

export async function getTaxedIncomes(userId: string, accountId: string): Promise<TaxedIncome[]> {
  return readTaxedIncomes(userId, accountId);
}

export async function getTaxedIncomeById(
  userId: string,
  accountId: string,
  incomeId: string
): Promise<TaxedIncome | null> {
  return getDoc<TaxedIncome>(taxedIncome, key(userId, accountId, incomeId));
}

export async function createTaxedIncome(
  userId: string,
  accountId: string,
  data: CreateTaxedIncomeRequest
): Promise<TaxedIncome> {
  const id = uuidv4();
  const now = new Date().toISOString();

  // Determine tax settings
  let taxRate = data.customTaxRate ?? 0;
  let contributionsRate = data.customContributionsRate ?? 0;
  let otherDeductions = data.customOtherDeductions ?? 0;

  if (data.useSalaryTaxSettings) {
    const defaultSettings = getDefaultTaxSettings(userId, accountId);
    if (defaultSettings) {
      taxRate = defaultSettings.taxRate;
      contributionsRate = defaultSettings.contributionsRate;
      otherDeductions = defaultSettings.otherDeductions;
    }
  }

  const { netAmount, taxAmount, contributionsAmount } = calculateTaxedIncomeNet(
    data.grossAmount,
    taxRate,
    contributionsRate,
    otherDeductions
  );

  const income: TaxedIncome = {
    id,
    accountId,
    name: data.name,
    grossAmount: data.grossAmount,
    useSalaryTaxSettings: data.useSalaryTaxSettings ?? false,
    customTaxRate: data.customTaxRate,
    customContributionsRate: data.customContributionsRate,
    customOtherDeductions: data.customOtherDeductions,
    netAmount,
    taxAmount,
    contributionsAmount,
    kind: data.kind,
    scheduledDate: data.scheduledDate,
    frequency: data.frequency,
    customIntervalMonths: data.customIntervalMonths,
    startDate: data.startDate,
    endDate: data.endDate,
    skippedOccurrences: data.skippedOccurrences,
    isActive: data.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(taxedIncome, key(userId, accountId, id), income);

  return income;
}

export async function updateTaxedIncome(
  userId: string,
  accountId: string,
  incomeId: string,
  updates: UpdateTaxedIncomeRequest
): Promise<TaxedIncome | null> {
  return inTx(() => {
    const income = getDoc<TaxedIncome>(taxedIncome, key(userId, accountId, incomeId));
    if (!income) {
      return null;
    }

    // Recalculate net amount if gross or tax settings changed. A key present
    // with `undefined` is a clear (the merge below drops it), so it must not fall
    // back to the stored value; only an absent key keeps it.
    const pick = (key: 'customTaxRate' | 'customContributionsRate' | 'customOtherDeductions'): number =>
      (Object.prototype.hasOwnProperty.call(updates, key) ? updates[key] : income[key]) ?? 0;
    let taxRate = pick('customTaxRate');
    let contributionsRate = pick('customContributionsRate');
    let otherDeductions = pick('customOtherDeductions');
    const grossAmount = updates.grossAmount ?? income.grossAmount;
    const useSalaryTaxSettings = updates.useSalaryTaxSettings ?? income.useSalaryTaxSettings;

    if (useSalaryTaxSettings) {
      const defaultSettings = getDefaultTaxSettings(userId, accountId);
      if (defaultSettings) {
        taxRate = defaultSettings.taxRate;
        contributionsRate = defaultSettings.contributionsRate;
        otherDeductions = defaultSettings.otherDeductions;
      }
    }

    const { netAmount, taxAmount, contributionsAmount } = calculateTaxedIncomeNet(
      grossAmount,
      taxRate,
      contributionsRate,
      otherDeductions
    );

    const updatedIncome: TaxedIncome = {
      ...income,
      ...updates,
      netAmount,
      taxAmount,
      contributionsAmount,
      updatedAt: new Date().toISOString(),
    };

    putDoc(taxedIncome, key(userId, accountId, incomeId), updatedIncome);

    return updatedIncome;
  });
}

export async function deleteTaxedIncome(
  userId: string,
  accountId: string,
  incomeId: string
): Promise<boolean> {
  deleteRows(taxedIncome, key(userId, accountId, incomeId));
  return true;
}

/**
 * Recompute the frozen net/tax/contributions of every taxed income on the
 * account that follows the salary's tax settings (`useSalaryTaxSettings`), so a
 * change to the account's active salary config cascades. No active salary
 * config → nothing to derive from, returns 0 (never rewrites). Persists only
 * the rows whose numbers actually changed; returns the changed count.
 */
export async function recomputeSalaryLinkedTaxedIncomes(
  userId: string,
  accountId: string
): Promise<number> {
  return inTx(() => {
    const defaultSettings = getDefaultTaxSettings(userId, accountId);
    if (!defaultSettings) return 0;

    const incomes = readTaxedIncomes(userId, accountId);
    let changed = 0;
    for (const income of incomes) {
      if (!income.useSalaryTaxSettings) continue;

      const { netAmount, taxAmount, contributionsAmount } = calculateTaxedIncomeNet(
        income.grossAmount,
        defaultSettings.taxRate,
        defaultSettings.contributionsRate,
        defaultSettings.otherDeductions
      );

      if (
        netAmount === income.netAmount &&
        taxAmount === income.taxAmount &&
        contributionsAmount === income.contributionsAmount
      ) {
        continue;
      }

      const updated: TaxedIncome = {
        ...income,
        netAmount,
        taxAmount,
        contributionsAmount,
        updatedAt: new Date().toISOString(),
      };
      putDoc(taxedIncome, key(userId, accountId, income.id), updated);
      changed++;
    }
    return changed;
  });
}
