// Core type definitions for Sampolio - Personal Finance Planning Tool

import type React from 'react';

export type Currency = 'EUR' | 'USD' | 'BRL' | 'GBP' | 'JPY' | 'CHF' | 'CAD' | 'AUD';

export type Frequency = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export type ItemType = 'income' | 'expense';

export type ItemKind = 'recurring' | 'one-off' | 'repeating';

// Year-month format: "YYYY-MM"
export type YearMonth = string;

// User roles
export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Application settings (stored in app-settings.enc)
export interface AppSettings {
  selfSignupEnabled: boolean;
  updatedAt: string;
  updatedBy: string; // userId of admin who last updated
}

// User preferences (stored per user in preferences.enc)
export interface TaxDefaults {
  taxRate: number; // percentage, e.g. 25 for 25%
  contributionsRate: number; // percentage, e.g. 8.19
  otherDeductions: number; // fixed amount
}

export interface UserPreferences {
  hasCompletedOnboarding: boolean;
  customCategories?: string[]; // user-defined categories (merged with built-in ones)
  removedDefaultCategories?: string[]; // built-in categories the user has removed
  taxDefaults?: TaxDefaults;
  updatedAt: string;
}

export interface FinancialAccount {
  id: string;
  userId: string;
  name: string;
  currency: Currency;
  startingBalance: number;
  startingDate: YearMonth; // e.g., "2026-01"
  planningHorizonMonths: number; // e.g., 12, 36, 120 for 1, 3, 10 years
  customEndDate?: YearMonth; // optional specific end date
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringItem {
  id: string;
  accountId: string;
  type: ItemType;
  name: string;
  amount: number;
  category?: string;
  frequency: Frequency;
  customIntervalMonths?: number; // used when frequency is 'custom'
  startDate: YearMonth;
  endDate?: YearMonth;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlannedItem {
  id: string;
  accountId: string;
  type: ItemType;
  kind: 'one-off' | 'repeating';
  name: string;
  amount: number;
  category?: string;
  // For one-off items
  scheduledDate?: YearMonth;
  // For repeating items
  frequency?: Frequency;
  customIntervalMonths?: number;
  firstOccurrence?: YearMonth;
  endDate?: YearMonth;
  // For recurring item occurrence overrides
  linkedRecurringItemId?: string; // the recurring item this overrides
  isRecurringOverride?: boolean;  // true if this is an occurrence override
  skipOccurrence?: boolean;       // true to skip the occurrence (no income/expense)
  createdAt: string;
  updatedAt: string;
}

export interface SalaryBenefit {
  id: string;
  name: string;
  amount: number; // monthly amount
  isTaxable: boolean; // whether it's added to gross before tax calculation
}

export interface SalaryConfig {
  id: string;
  accountId: string;
  name: string;
  grossSalary: number;
  benefits: SalaryBenefit[];
  taxRate: number; // percentage, e.g., 25 for 25%
  contributionsRate: number; // percentage for retirement, insurance, etc.
  otherDeductions: number; // fixed amount
  netSalary: number; // computed
  isLinkedToRecurring: boolean;
  linkedRecurringItemId?: string;
  startDate: YearMonth;
  endDate?: YearMonth;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Projection types
export interface MonthlyProjection {
  yearMonth: YearMonth;
  year: number;
  month: number;
  startingBalance: number;
  totalIncome: number;
  totalExpenses: number;
  netChange: number; // totalIncome - totalExpenses
  endingBalance: number;
  incomeBreakdown: ProjectionLineItem[];
  expenseBreakdown: ProjectionLineItem[];
}

export interface ProjectionLineItem {
  itemId: string;
  name: string;
  amount: number;
  category?: string;
  source: 'recurring' | 'planned-one-off' | 'planned-repeating' | 'salary';
  isOverridden?: boolean; // true when a recurring item has an occurrence override for this month
}

export interface YearlyRollup {
  year: number;
  totalIncome: number;
  totalExpenses: number;
  netChange: number;
  startingBalance: number;
  endingBalance: number;
  months: MonthlyProjection[];
}

export interface ProjectionFilters {
  startDate?: YearMonth;
  endDate?: YearMonth;
  categories?: string[];
  itemTypes?: ItemType[];
  itemKinds?: ItemKind[];
}

// API request/response types
export interface CreateAccountRequest {
  name: string;
  currency: Currency;
  startingBalance: number;
  startingDate: YearMonth;
  planningHorizonMonths: number;
  customEndDate?: YearMonth;
}

export interface UpdateAccountRequest extends Partial<CreateAccountRequest> {
  isArchived?: boolean;
}

export interface CreateRecurringItemRequest {
  accountId: string;
  type: ItemType;
  name: string;
  amount: number;
  category?: string;
  frequency: Frequency;
  customIntervalMonths?: number;
  startDate: YearMonth;
  endDate?: YearMonth;
  isActive?: boolean;
}

export interface UpdateRecurringItemRequest extends Partial<CreateRecurringItemRequest> { }

export interface CreatePlannedItemRequest {
  accountId: string;
  type: ItemType;
  kind: 'one-off' | 'repeating';
  name: string;
  amount: number;
  category?: string;
  scheduledDate?: YearMonth;
  frequency?: Frequency;
  customIntervalMonths?: number;
  firstOccurrence?: YearMonth;
  endDate?: YearMonth;
  // For recurring item occurrence overrides
  linkedRecurringItemId?: string;
  isRecurringOverride?: boolean;
  skipOccurrence?: boolean;
}

export interface UpdatePlannedItemRequest extends Partial<CreatePlannedItemRequest> { }

export interface CreateSalaryConfigRequest {
  accountId: string;
  name: string;
  grossSalary: number;
  benefits?: SalaryBenefit[];
  taxRate: number;
  contributionsRate: number;
  otherDeductions?: number;
  startDate: YearMonth;
  endDate?: YearMonth;
  isActive?: boolean;
  isLinkedToRecurring?: boolean;
}

export interface UpdateSalaryConfigRequest extends Partial<CreateSalaryConfigRequest> { }

// Auth types
export interface SignUpRequest {
  email: string;
  password: string;
  name: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

// Admin types
export interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UpdateAppSettingsRequest {
  selfSignupEnabled?: boolean;
}

// Public user info (without password hash)
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Utility types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// WEALTH MANAGEMENT TYPES
// ============================================================

// Interest model types for debts
export type InterestModelType = 'none' | 'fixed' | 'variable';

export type DebtType = 'amortized' | 'fixed-installment';

// ============================================================
// RECEIVABLES (Loans to others, e.g., "Wife owes me")
// ============================================================

export interface Receivable {
  id: string;
  userId: string;
  name: string;
  description?: string;
  currency: Currency;
  initialPrincipal: number;
  currentBalance: number; // Calculated: initialPrincipal - sum(repayments)
  note?: string;
  // Optional interest model
  hasInterest: boolean;
  annualInterestRate?: number; // percentage, e.g., 5 for 5%
  // Optional soft forecast for projection
  expectedMonthlyRepayment?: number; // For projection purposes only
  startDate: YearMonth;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReceivableRepayment {
  id: string;
  receivableId: string;
  date: YearMonth;
  amount: number;
  description?: string;
  note?: string;
  // Optional: link repayment to a cash account (money comes in)
  linkedAccountId?: string;
  createdAt: string;
}

export interface CreateReceivableRequest {
  name: string;
  description?: string;
  currency: Currency;
  initialPrincipal: number;
  note?: string;
  hasInterest?: boolean;
  annualInterestRate?: number;
  expectedMonthlyRepayment?: number;
  startDate: YearMonth;
}

export interface UpdateReceivableRequest extends Partial<CreateReceivableRequest> {
  isArchived?: boolean;
}

export interface CreateRepaymentRequest {
  date: YearMonth;
  amount: number;
  note?: string;
  linkedAccountId?: string;
}

// ============================================================
// INVESTMENT ACCOUNTS
// ============================================================

export interface InvestmentAccount {
  id: string;
  userId: string;
  name: string;
  description?: string;
  currency: Currency;
  startingValuation: number;
  currentValuation?: number; // Current calculated valuation
  valuationDate: YearMonth; // As-of date for the starting valuation
  // Growth model
  annualGrowthRate: number; // percentage, e.g., 7 for 7% annual return
  // Derived monthly rate = (1 + annualRate/100)^(1/12) - 1
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentContribution {
  id: string;
  investmentAccountId: string;
  type: 'contribution' | 'withdrawal';
  kind: 'one-off' | 'recurring';
  amount: number;
  description?: string;
  // For one-off
  scheduledDate?: YearMonth;
  // For recurring
  frequency?: Frequency;
  customIntervalMonths?: number;
  startDate?: YearMonth;
  endDate?: YearMonth;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvestmentAccountRequest {
  name: string;
  description?: string;
  currency: Currency;
  startingValuation: number;
  valuationDate: YearMonth;
  annualGrowthRate: number;
}

export interface UpdateInvestmentAccountRequest extends Partial<CreateInvestmentAccountRequest> {
  isArchived?: boolean;
}

export interface CreateInvestmentContributionRequest {
  type: 'contribution' | 'withdrawal';
  kind: 'one-off' | 'recurring';
  amount: number;
  description?: string;
  scheduledDate?: YearMonth;
  frequency?: Frequency;
  customIntervalMonths?: number;
  startDate?: YearMonth;
  endDate?: YearMonth;
  isActive?: boolean;
}

export interface UpdateInvestmentContributionRequest extends Partial<CreateInvestmentContributionRequest> { }

// ============================================================
// DEBTS / LIABILITIES
// ============================================================

export interface Debt {
  id: string;
  userId: string;
  name: string;
  description?: string;
  currency: Currency;
  debtType: DebtType;
  initialPrincipal: number;
  currentPrincipal: number; // Calculated from payments
  startDate: YearMonth;

  // For amortized loans (mortgage-like)
  interestModelType: InterestModelType;
  fixedInterestRate?: number; // Annual rate for fixed interest
  referenceRateMargin?: number; // Margin above reference rate (e.g., 1.5%)
  rateResetFrequency?: 'monthly' | 'quarterly' | 'yearly'; // How often rate resets
  monthlyPayment?: number; // Fixed monthly payment amount

  // For fixed-installment (no interest, like renovations financing)
  installmentAmount?: number;
  totalInstallments?: number;
  remainingInstallments?: number;

  // Link to cash account that pays this debt
  linkedAccountId?: string;

  isArchived: boolean;
  endDate?: YearMonth; // When debt will be fully paid
  createdAt: string;
  updatedAt: string;
}

export interface DebtReferenceRate {
  id: string;
  debtId: string;
  yearMonth: YearMonth;
  rate: number; // The reference rate for this period (e.g., Euribor)
  createdAt: string;
}

export interface DebtExtraPayment {
  id: string;
  debtId: string;
  date: YearMonth;
  amount: number;
  description?: string;
  note?: string;
  createdAt: string;
}

export interface CreateDebtRequest {
  name: string;
  description?: string;
  currency: Currency;
  debtType: DebtType;
  initialPrincipal: number;
  startDate: YearMonth;
  // For amortized
  interestModelType?: InterestModelType;
  fixedInterestRate?: number;
  referenceRateMargin?: number;
  rateResetFrequency?: 'monthly' | 'quarterly' | 'yearly';
  monthlyPayment?: number;
  // For fixed-installment
  installmentAmount?: number;
  totalInstallments?: number;
  // Link to cash account
  linkedAccountId?: string;
}

export interface UpdateDebtRequest extends Partial<CreateDebtRequest> {
  isArchived?: boolean;
}

// ============================================================
// TAXED INCOME (Bonuses, Holiday Pay, etc.)
// ============================================================

export interface TaxedIncome {
  id: string;
  accountId: string; // Links to a cash account
  name: string;
  grossAmount: number;
  // Tax handling
  useSalaryTaxSettings: boolean; // If true, use the linked account's salary tax rate
  customTaxRate?: number; // percentage, used if useSalaryTaxSettings is false
  customContributionsRate?: number;
  customOtherDeductions?: number;
  // Calculated
  netAmount: number;
  taxAmount: number;
  contributionsAmount: number;
  // Schedule
  kind: 'one-off' | 'recurring';
  scheduledDate?: YearMonth; // For one-off
  frequency?: Frequency; // For recurring
  customIntervalMonths?: number;
  startDate?: YearMonth;
  endDate?: YearMonth;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaxedIncomeRequest {
  accountId: string;
  name: string;
  grossAmount: number;
  useSalaryTaxSettings?: boolean;
  customTaxRate?: number;
  customContributionsRate?: number;
  customOtherDeductions?: number;
  kind: 'one-off' | 'recurring';
  scheduledDate?: YearMonth;
  frequency?: Frequency;
  customIntervalMonths?: number;
  startDate?: YearMonth;
  endDate?: YearMonth;
  isActive?: boolean;
}

export interface UpdateTaxedIncomeRequest extends Partial<CreateTaxedIncomeRequest> { }

// ============================================================
// WEALTH PROJECTION TYPES
// ============================================================

export interface WealthProjectionMonth {
  yearMonth: YearMonth;
  year: number;
  month: number;
  // Cash accounts (from existing projection)
  cashAccountsTotal: number;
  cashAccountsBreakdown: { accountId: string; name: string; balance: number }[];
  // Investments
  investmentsTotal: number;
  investmentsBreakdown: { accountId: string; name: string; valuation: number }[];
  // Receivables
  receivablesTotal: number;
  receivablesBreakdown: { receivableId: string; name: string; balance: number }[];
  // Debts (negative values)
  debtsTotal: number;
  debtsBreakdown: { debtId: string; name: string; principal: number; interestPaid?: number }[];
  // Net worth
  netWorth: number;
}

export interface DebtAmortizationRow {
  yearMonth: YearMonth;
  startingPrincipal: number;
  interestPaid: number;
  principalPaid: number;
  totalPayment: number;
  endingPrincipal: number;
  interestRate: number; // The rate used for this period
}

export interface InvestmentProjectionRow {
  yearMonth: YearMonth;
  startingValuation: number;
  growth: number;
  contributions: number;
  withdrawals: number;
  endingValuation: number;
}

export interface ReceivableProjectionRow {
  yearMonth: YearMonth;
  startingBalance: number;
  repayments: number;
  interestAccrued: number;
  endingBalance: number;
}

// ============================================================
// RECONCILIATION & BALANCE SNAPSHOTS
// ============================================================

export type EntityType = 'cash-account' | 'investment' | 'receivable' | 'debt';

export type AdjustmentCategory =
  | 'untracked-income'
  | 'untracked-expense'
  | 'valuation-change'
  | 'interest-adjustment'
  | 'data-correction'
  | 'other';

export interface BalanceSnapshot {
  id: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  yearMonth: YearMonth;
  expectedBalance: number; // What the system projected
  actualBalance: number; // What user reported
  variance: number; // actualBalance - expectedBalance
  createdAt: string;
}

export interface ReconciliationAdjustment {
  id: string;
  snapshotId: string;
  category: AdjustmentCategory;
  amount: number;
  description?: string;
  createdAt: string;
}

export interface ReconciliationSession {
  id: string;
  userId: string;
  yearMonth: YearMonth;
  status: 'in-progress' | 'completed';
  startedAt: string;
  completedAt?: string;
  snapshots: BalanceSnapshot[];
  adjustments: ReconciliationAdjustment[];
}

export interface CreateBalanceSnapshotRequest {
  entityType: EntityType;
  entityId: string;
  yearMonth: YearMonth;
  actualBalance: number;
}

export interface CreateAdjustmentRequest {
  snapshotId: string;
  category: AdjustmentCategory;
  amount: number;
  description?: string;
}

export interface ReconciliationSummary {
  yearMonth: YearMonth;
  totalVariance: number;
  adjustmentsByCategory: Record<AdjustmentCategory, number>;
  entitiesReconciled: number;
  lastReconciledAt?: string;
}

// ============================================================
// CASHFLOW VISUALIZATION TYPES
// ============================================================

export interface CashflowItem {
  id: string;
  name: string;
  amount: number;
  category?: string;
  type: 'income' | 'expense' | 'transfer' | 'adjustment';
  source: 'recurring' | 'planned' | 'salary' | 'taxed-income' | 'adjustment' | 'debt-payment';
  isRecurring: boolean;
  linkedEntityId?: string; // For drill-down
  linkedEntityType?: string;
}

export interface MonthFlowData {
  yearMonth: YearMonth;
  accountId: string;
  startingBalance: number;
  endingBalance: number;
  inflows: CashflowItem[];
  outflows: CashflowItem[];
  totalInflows: number;
  totalOutflows: number;
  netChange: number;
  isReconciled: boolean;
  reconciledBalance?: number;
}

// ============================================================
// NAVIGATION & UI STATE TYPES
// ============================================================

export type NavigationPage = 'overview' | 'cashflow' | 'balance-sheet' | 'settings';

export type TimeHorizon = '6m' | '1y' | '3y' | '5y' | 'custom';

export interface ChartInteraction {
  type: 'month-click' | 'entity-click' | 'segment-click';
  yearMonth?: YearMonth;
  entityId?: string;
  entityType?: EntityType;
}

export interface DrawerState {
  isOpen: boolean;
  mode: 'view' | 'edit' | 'create';
  entityType?: string;
  entityId?: string;
  yearMonth?: YearMonth;
}

// ============================================================
// COMMAND PALETTE TYPES
// ============================================================

export type CommandType = 'navigate' | 'add' | 'reconcile' | 'search' | 'action';

export interface Command {
  id: string;
  label: string;
  description?: string;
  type: CommandType;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  keywords?: string[];
}
