import { v4 as uuidv4 } from 'uuid';
import type {
  FinancialAccount,
  RecurringItem,
  PlannedItem,
  TaxedIncome,
  Debt,
  InvestmentAccount,
  InvestmentContribution,
  Receivable,
  ReceivableRepayment,
  DebtReferenceRate,
  DebtExtraPayment,
  SalaryBenefit,
  Currency,
} from '@/types';

const now = new Date().toISOString();

export function createMockAccount(overrides?: Partial<FinancialAccount>): FinancialAccount {
  return {
    id: uuidv4(),
    userId: 'test-user',
    name: 'Test Account',
    currency: 'EUR' as Currency,
    startingBalance: 5000,
    startingDate: '2026-01',
    planningHorizonMonths: 12,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockRecurringItem(overrides?: Partial<RecurringItem>): RecurringItem {
  return {
    id: uuidv4(),
    accountId: 'test-account',
    type: 'income',
    name: 'Test Income',
    amount: 3000,
    category: 'Salary',
    frequency: 'monthly',
    startDate: '2026-01',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockPlannedItem(overrides?: Partial<PlannedItem>): PlannedItem {
  return {
    id: uuidv4(),
    accountId: 'test-account',
    type: 'expense',
    kind: 'one-off',
    name: 'Test Planned',
    amount: 500,
    category: 'Shopping',
    scheduledDate: '2026-03',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockTaxedIncome(overrides?: Partial<TaxedIncome>): TaxedIncome {
  return {
    id: uuidv4(),
    accountId: 'test-account',
    name: 'Test Bonus',
    grossAmount: 5000,
    useSalaryTaxSettings: false,
    customTaxRate: 30,
    customContributionsRate: 8,
    netAmount: 3100,
    taxAmount: 1500,
    contributionsAmount: 400,
    kind: 'one-off',
    scheduledDate: '2026-06',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockDebt(overrides?: Partial<Debt>): Debt {
  return {
    id: uuidv4(),
    userId: 'test-user',
    name: 'Test Debt',
    currency: 'EUR' as Currency,
    debtType: 'amortized',
    initialPrincipal: 100000,
    startDate: '2025-01',
    interestModelType: 'fixed',
    fixedInterestRate: 3.5,
    monthlyPayment: 500,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockInvestment(overrides?: Partial<InvestmentAccount>): InvestmentAccount {
  return {
    id: uuidv4(),
    userId: 'test-user',
    name: 'Test Investment',
    currency: 'EUR' as Currency,
    startingValuation: 10000,
    valuationDate: '2026-01',
    annualGrowthRate: 7,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockContribution(overrides?: Partial<InvestmentContribution>): InvestmentContribution {
  return {
    id: uuidv4(),
    investmentAccountId: 'test-investment',
    type: 'contribution',
    kind: 'recurring',
    amount: 200,
    frequency: 'monthly',
    startDate: '2026-01',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockReceivable(overrides?: Partial<Receivable>): Receivable {
  return {
    id: uuidv4(),
    userId: 'test-user',
    name: 'Test Receivable',
    currency: 'EUR' as Currency,
    initialPrincipal: 5000,
    currentBalance: 5000,
    hasInterest: false,
    startDate: '2026-01',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockRepayment(overrides?: Partial<ReceivableRepayment>): ReceivableRepayment {
  return {
    id: uuidv4(),
    receivableId: 'test-receivable',
    date: '2026-02',
    amount: 500,
    createdAt: now,
    ...overrides,
  };
}

export function createMockReferenceRate(overrides?: Partial<DebtReferenceRate>): DebtReferenceRate {
  return {
    id: uuidv4(),
    debtId: 'test-debt',
    yearMonth: '2026-01',
    rate: 3.0,
    createdAt: now,
    ...overrides,
  };
}

export function createMockExtraPayment(overrides?: Partial<DebtExtraPayment>): DebtExtraPayment {
  return {
    id: uuidv4(),
    debtId: 'test-debt',
    date: '2026-06',
    amount: 5000,
    createdAt: now,
    ...overrides,
  };
}

export function createMockSalaryBenefit(overrides?: Partial<SalaryBenefit>): SalaryBenefit {
  return {
    id: uuidv4(),
    name: 'Lunch Benefit',
    amount: 150,
    isTaxable: true,
    ...overrides,
  };
}
