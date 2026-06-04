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
  BalanceSnapshot,
  Currency,
  SharedMortgage,
  MortgageLoan,
  MortgageMember,
  MortgageRateEntry,
  MortgageCostEntry,
  MortgageExtraPayment,
  MortgageBalanceSnapshot,
  MortgageActualEntry,
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

export function createMockSnapshot(overrides?: Partial<BalanceSnapshot>): BalanceSnapshot {
  return {
    id: uuidv4(),
    userId: 'test-user',
    entityType: 'cash-account',
    entityId: 'test-account',
    yearMonth: '2026-03',
    expectedBalance: 5000,
    actualBalance: 6000,
    variance: 1000,
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

// ============================================================
// SHARED MORTGAGE MOCKS
// ============================================================

export function createMockMortgageLoan(overrides?: Partial<MortgageLoan>): MortgageLoan {
  return {
    id: uuidv4(),
    label: 'Regular loan',
    kind: 'regular',
    initialPrincipal: 153000,
    startDate: '2023-02',
    originalTermMonths: 300,
    paymentMode: 'annuity-fixed-term',
    margin: 0.4,
    dayCount: 'actual/360',
    ...overrides,
  };
}

export function createMockMortgageMember(overrides?: Partial<MortgageMember>): MortgageMember {
  return {
    userId: 'test-user',
    email: 'lucas@demola.net',
    name: 'Lucas',
    role: 'owner',
    initialPayment: 31000,
    loanSharePercent: 0.454,
    ownershipTargetPercent: 0.5,
    ...overrides,
  };
}

/**
 * The real family mortgage from the spreadsheet: €328k home, €35k down
 * (€31k / €4k), an ASP loan (€140k) + a regular loan (€153k), 50/50 target.
 */
export function createMockSharedMortgage(overrides?: Partial<SharedMortgage>): SharedMortgage {
  return {
    id: 'test-mortgage',
    name: 'Home',
    currency: 'EUR' as Currency,
    housePrice: 328000,
    rateResetMonth: 12,
    rateResetDay: 14,
    loans: [
      createMockMortgageLoan({
        id: 'loan-asp',
        label: 'ASP loan',
        kind: 'asp',
        initialPrincipal: 140000,
      }),
      createMockMortgageLoan({
        id: 'loan-regular',
        label: 'Regular loan',
        kind: 'regular',
        initialPrincipal: 153000,
      }),
    ],
    members: [
      createMockMortgageMember({ userId: 'lucas', name: 'Lucas', initialPayment: 31000, loanSharePercent: 0.454 }),
      createMockMortgageMember({ userId: 'marja', name: 'Marja', email: 'marja@example.com', role: 'member', initialPayment: 4000, loanSharePercent: 0.546 }),
    ],
    isArchived: false,
    createdBy: 'lucas',
    createdAt: now,
    updatedAt: now,
    updatedBy: 'lucas',
    ...overrides,
  };
}

export function createMockMortgageRate(overrides?: Partial<MortgageRateEntry>): MortgageRateEntry {
  return {
    id: uuidv4(),
    mortgageId: 'test-mortgage',
    effectiveDate: '2022-12',
    euriborRate: 2.963, // + 0.4 margin = 3.363% total
    createdAt: now,
    ...overrides,
  };
}

export function createMockMortgageCost(overrides?: Partial<MortgageCostEntry>): MortgageCostEntry {
  return {
    id: uuidv4(),
    mortgageId: 'test-mortgage',
    type: 'invoicing-fee',
    effectiveDate: '2023-02',
    amount: 5.4,
    createdAt: now,
    ...overrides,
  };
}

export function createMockMortgageExtraPayment(
  overrides?: Partial<MortgageExtraPayment>
): MortgageExtraPayment {
  return {
    id: uuidv4(),
    mortgageId: 'test-mortgage',
    loanId: 'loan-regular',
    date: '2026-01',
    amount: 5000,
    mode: 'shorten-term',
    createdAt: now,
    ...overrides,
  };
}

export function createMockMortgageSnapshot(
  overrides?: Partial<MortgageBalanceSnapshot>
): MortgageBalanceSnapshot {
  return {
    id: uuidv4(),
    mortgageId: 'test-mortgage',
    loanId: 'loan-regular',
    yearMonth: '2025-06',
    actualBalance: 145000,
    createdAt: now,
    ...overrides,
  };
}

export function createMockMortgageActual(
  overrides?: Partial<MortgageActualEntry>
): MortgageActualEntry {
  return {
    id: uuidv4(),
    mortgageId: 'test-mortgage',
    loanId: 'loan-asp',
    yearMonth: '2023-02',
    remaining: 140000,
    repayment: 612.54,
    interest: 609.84,
    insurance: 0,
    createdAt: now,
    ...overrides,
  };
}
