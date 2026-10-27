import { v4 as uuidv4 } from 'uuid';
import type {
  SalaryConfig,
  CreateSalaryConfigRequest,
  UpdateSalaryConfigRequest
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { salaryConfig } from './sqlite/schema';
import { insertRecurringItem, patchRecurringItem, removeRecurringItem } from './recurring-items';
import { calculateNetSalary } from '../salary-utils';

export { calculateNetSalary };

const scope = (userId: string, accountId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  accountId: assertSafeId(accountId, 'accountId'),
});
const key = (userId: string, accountId: string, configId: string) => ({
  ...scope(userId, accountId),
  id: assertSafeId(configId),
});

/** Name-sorted configs (sync; taxed-income reads its defaults through it). */
export function readSalaryConfigs(userId: string, accountId: string): SalaryConfig[] {
  const configs = listDocs<SalaryConfig>(salaryConfig, scope(userId, accountId));
  return configs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSalaryConfigs(userId: string, accountId: string): Promise<SalaryConfig[]> {
  return readSalaryConfigs(userId, accountId);
}

export async function getActiveSalaryConfigs(userId: string, accountId: string): Promise<SalaryConfig[]> {
  const configs = await getSalaryConfigs(userId, accountId);
  return configs.filter(config => config.isActive);
}

export async function getSalaryConfigById(
  userId: string,
  accountId: string,
  configId: string
): Promise<SalaryConfig | null> {
  return getDoc<SalaryConfig>(salaryConfig, key(userId, accountId, configId));
}

export async function createSalaryConfig(
  userId: string,
  data: CreateSalaryConfigRequest
): Promise<SalaryConfig> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const netSalary = calculateNetSalary(
    data.grossSalary,
    data.taxRate,
    data.contributionsRate,
    data.otherDeductions || 0,
    data.benefits || []
  );

  return inTx(() => {
    let linkedRecurringItemId: string | undefined;

    // Create linked recurring income item if requested
    if (data.isLinkedToRecurring) {
      const recurringItem = insertRecurringItem(userId, {
        accountId: data.accountId,
        type: 'income',
        name: `Salary: ${data.name}`,
        amount: netSalary,
        category: 'Salary',
        frequency: 'monthly',
        startDate: data.startDate,
        endDate: data.endDate,
        isActive: data.isActive ?? true,
      });
      linkedRecurringItemId = recurringItem.id;
    }

    const config: SalaryConfig = {
      id,
      accountId: data.accountId,
      name: data.name,
      grossSalary: data.grossSalary,
      benefits: data.benefits || [],
      taxRate: data.taxRate,
      contributionsRate: data.contributionsRate,
      otherDeductions: data.otherDeductions || 0,
      netSalary,
      isLinkedToRecurring: data.isLinkedToRecurring ?? false,
      linkedRecurringItemId,
      startDate: data.startDate,
      endDate: data.endDate,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    putDoc(salaryConfig, key(userId, data.accountId, id), config);

    return config;
  });
}

export async function updateSalaryConfig(
  userId: string,
  accountId: string,
  configId: string,
  updates: UpdateSalaryConfigRequest
): Promise<SalaryConfig | null> {
  return inTx(() => {
    const config = getDoc<SalaryConfig>(salaryConfig, key(userId, accountId, configId));
    if (!config) {
      return null;
    }

    // Recalculate net salary if any salary parameters changed
    const grossSalary = updates.grossSalary ?? config.grossSalary;
    const taxRate = updates.taxRate ?? config.taxRate;
    const contributionsRate = updates.contributionsRate ?? config.contributionsRate;
    const otherDeductions = updates.otherDeductions ?? config.otherDeductions;
    const benefits = updates.benefits ?? config.benefits ?? [];

    const netSalary = calculateNetSalary(grossSalary, taxRate, contributionsRate, otherDeductions, benefits);

    const updatedConfig: SalaryConfig = {
      ...config,
      ...updates,
      netSalary,
      updatedAt: new Date().toISOString(),
    };

    // Update linked recurring item if it exists
    if (config.linkedRecurringItemId && config.isLinkedToRecurring) {
      patchRecurringItem(userId, accountId, config.linkedRecurringItemId, {
        name: `Salary: ${updatedConfig.name}`,
        amount: netSalary,
        startDate: updatedConfig.startDate,
        endDate: updatedConfig.endDate,
        isActive: updatedConfig.isActive,
      });
    }

    putDoc(salaryConfig, key(userId, accountId, configId), updatedConfig);

    return updatedConfig;
  });
}

export async function toggleSalaryConfigActive(
  userId: string,
  accountId: string,
  configId: string
): Promise<SalaryConfig | null> {
  const config = await getSalaryConfigById(userId, accountId, configId);
  if (!config) {
    return null;
  }

  return updateSalaryConfig(userId, accountId, configId, { isActive: !config.isActive });
}

export async function deleteSalaryConfig(
  userId: string,
  accountId: string,
  configId: string
): Promise<boolean> {
  return inTx(() => {
    const config = getDoc<SalaryConfig>(salaryConfig, key(userId, accountId, configId));

    // Delete linked recurring item if it exists
    if (config?.linkedRecurringItemId) {
      removeRecurringItem(userId, accountId, config.linkedRecurringItemId);
    }

    deleteRows(salaryConfig, key(userId, accountId, configId));
    return true;
  });
}
