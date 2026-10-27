import { v4 as uuidv4 } from 'uuid';
import type {
  InvestmentAccount,
  InvestmentContribution,
  CreateInvestmentAccountRequest,
  UpdateInvestmentAccountRequest,
  CreateInvestmentContributionRequest,
  UpdateInvestmentContributionRequest,
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { investment as investmentTable, investmentContribution } from './sqlite/schema';

const investmentKey = (userId: string, investmentId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  id: assertSafeId(investmentId),
});
const contributionScope = (userId: string, investmentId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  investmentId: assertSafeId(investmentId, 'investmentId'),
});
const contributionKey = (userId: string, investmentId: string, contributionId: string) => ({
  ...contributionScope(userId, investmentId),
  id: assertSafeId(contributionId),
});

// ============================================================
// INVESTMENT ACCOUNTS CRUD
// ============================================================

export async function getInvestmentAccounts(userId: string): Promise<InvestmentAccount[]> {
  const investments = listDocs<InvestmentAccount>(investmentTable, { userId: assertSafeId(userId, 'userId') });

  return investments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getInvestmentAccountById(
  userId: string,
  investmentId: string
): Promise<InvestmentAccount | null> {
  return getDoc<InvestmentAccount>(investmentTable, investmentKey(userId, investmentId));
}

export async function createInvestmentAccount(
  userId: string,
  data: CreateInvestmentAccountRequest
): Promise<InvestmentAccount> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const investment: InvestmentAccount = {
    id,
    userId,
    name: data.name,
    description: data.description,
    currency: data.currency,
    startingValuation: data.startingValuation,
    valuationDate: data.valuationDate,
    annualGrowthRate: data.annualGrowthRate,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(investmentTable, investmentKey(userId, id), investment);

  return investment;
}

export async function updateInvestmentAccount(
  userId: string,
  investmentId: string,
  updates: UpdateInvestmentAccountRequest
): Promise<InvestmentAccount | null> {
  return inTx(() => {
    const investment = getDoc<InvestmentAccount>(investmentTable, investmentKey(userId, investmentId));
    if (!investment) {
      return null;
    }

    const updatedInvestment: InvestmentAccount = {
      ...investment,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    putDoc(investmentTable, investmentKey(userId, investmentId), updatedInvestment);
    return updatedInvestment;
  });
}

export async function deleteInvestmentAccount(userId: string, investmentId: string): Promise<boolean> {
  inTx(() => {
    // Delete all contributions first
    deleteRows(investmentContribution, contributionScope(userId, investmentId));
    deleteRows(investmentTable, investmentKey(userId, investmentId));
  });
  return true;
}

// ============================================================
// CONTRIBUTIONS CRUD
// ============================================================

export async function getContributions(
  userId: string,
  investmentId: string
): Promise<InvestmentContribution[]> {
  const contributions = listDocs<InvestmentContribution>(
    investmentContribution,
    contributionScope(userId, investmentId)
  );

  return contributions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getContributionById(
  userId: string,
  investmentId: string,
  contributionId: string
): Promise<InvestmentContribution | null> {
  return getDoc<InvestmentContribution>(investmentContribution, contributionKey(userId, investmentId, contributionId));
}

export async function createContribution(
  userId: string,
  investmentId: string,
  data: CreateInvestmentContributionRequest
): Promise<InvestmentContribution> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const contribution: InvestmentContribution = {
    id,
    investmentAccountId: investmentId,
    type: data.type,
    kind: data.kind,
    amount: data.amount,
    scheduledDate: data.scheduledDate,
    frequency: data.frequency,
    customIntervalMonths: data.customIntervalMonths,
    startDate: data.startDate,
    endDate: data.endDate,
    isActive: data.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(investmentContribution, contributionKey(userId, investmentId, id), contribution);

  return contribution;
}

export async function updateContribution(
  userId: string,
  investmentId: string,
  contributionId: string,
  updates: UpdateInvestmentContributionRequest
): Promise<InvestmentContribution | null> {
  return inTx(() => {
    const key = contributionKey(userId, investmentId, contributionId);
    const contribution = getDoc<InvestmentContribution>(investmentContribution, key);
    if (!contribution) {
      return null;
    }

    const updatedContribution: InvestmentContribution = {
      ...contribution,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    putDoc(investmentContribution, key, updatedContribution);
    return updatedContribution;
  });
}

export async function deleteContribution(
  userId: string,
  investmentId: string,
  contributionId: string
): Promise<boolean> {
  deleteRows(investmentContribution, contributionKey(userId, investmentId, contributionId));
  return true;
}
