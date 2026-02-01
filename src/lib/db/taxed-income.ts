import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  TaxedIncome,
  CreateTaxedIncomeRequest,
  UpdateTaxedIncomeRequest,
  SalaryConfig,
} from '@/types';
import {
  getUserDir,
  ensureDir,
  readEncryptedFile,
  writeEncryptedFile,
  listFiles,
  deleteFile,
} from './encryption';
import { getSalaryConfigs } from './salary-configs';

function getTaxedIncomeDir(userId: string, accountId: string): string {
  return path.join(getUserDir(userId), 'accounts', accountId, 'taxed-income');
}

function getTaxedIncomeFile(userId: string, accountId: string, incomeId: string): string {
  return path.join(getTaxedIncomeDir(userId, accountId), `${incomeId}.enc`);
}

// Calculate net amount from gross
function calculateNetAmount(
  grossAmount: number,
  taxRate: number,
  contributionsRate: number,
  otherDeductions: number
): { netAmount: number; taxAmount: number; contributionsAmount: number } {
  const taxAmount = grossAmount * (taxRate / 100);
  const contributionsAmount = grossAmount * (contributionsRate / 100);
  const netAmount = grossAmount - taxAmount - contributionsAmount - otherDeductions;
  return { netAmount, taxAmount, contributionsAmount };
}

// Get default tax settings from salary configs
async function getDefaultTaxSettings(
  userId: string,
  accountId: string
): Promise<{ taxRate: number; contributionsRate: number; otherDeductions: number } | null> {
  const salaryConfigs = await getSalaryConfigs(userId, accountId);
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
  const incomeDir = getTaxedIncomeDir(userId, accountId);
  try {
    await ensureDir(incomeDir);
  } catch {
    return [];
  }

  const files = await listFiles(incomeDir);
  const incomes: TaxedIncome[] = [];

  for (const file of files) {
    if (file.endsWith('.enc')) {
      const income = await readEncryptedFile<TaxedIncome>(path.join(incomeDir, file));
      if (income) {
        incomes.push(income);
      }
    }
  }

  return incomes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getTaxedIncomeById(
  userId: string,
  accountId: string,
  incomeId: string
): Promise<TaxedIncome | null> {
  const incomeFile = getTaxedIncomeFile(userId, accountId, incomeId);
  return readEncryptedFile<TaxedIncome>(incomeFile);
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
    const defaultSettings = await getDefaultTaxSettings(userId, accountId);
    if (defaultSettings) {
      taxRate = defaultSettings.taxRate;
      contributionsRate = defaultSettings.contributionsRate;
      otherDeductions = defaultSettings.otherDeductions;
    }
  }

  const { netAmount, taxAmount, contributionsAmount } = calculateNetAmount(
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
    isActive: data.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  const incomeDir = getTaxedIncomeDir(userId, accountId);
  await ensureDir(incomeDir);

  const incomeFile = getTaxedIncomeFile(userId, accountId, id);
  await writeEncryptedFile(incomeFile, income);

  return income;
}

export async function updateTaxedIncome(
  userId: string,
  accountId: string,
  incomeId: string,
  updates: UpdateTaxedIncomeRequest
): Promise<TaxedIncome | null> {
  const income = await getTaxedIncomeById(userId, accountId, incomeId);
  if (!income) {
    return null;
  }

  // Recalculate net amount if gross or tax settings changed
  let taxRate = updates.customTaxRate ?? income.customTaxRate ?? 0;
  let contributionsRate = updates.customContributionsRate ?? income.customContributionsRate ?? 0;
  let otherDeductions = updates.customOtherDeductions ?? income.customOtherDeductions ?? 0;
  const grossAmount = updates.grossAmount ?? income.grossAmount;
  const useSalaryTaxSettings = updates.useSalaryTaxSettings ?? income.useSalaryTaxSettings;

  if (useSalaryTaxSettings) {
    const defaultSettings = await getDefaultTaxSettings(userId, accountId);
    if (defaultSettings) {
      taxRate = defaultSettings.taxRate;
      contributionsRate = defaultSettings.contributionsRate;
      otherDeductions = defaultSettings.otherDeductions;
    }
  }

  const { netAmount, taxAmount, contributionsAmount } = calculateNetAmount(
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

  const incomeFile = getTaxedIncomeFile(userId, accountId, incomeId);
  await writeEncryptedFile(incomeFile, updatedIncome);

  return updatedIncome;
}

export async function deleteTaxedIncome(
  userId: string,
  accountId: string,
  incomeId: string
): Promise<boolean> {
  const incomeFile = getTaxedIncomeFile(userId, accountId, incomeId);
  await deleteFile(incomeFile);
  return true;
}
