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

export type DisplayMode = 'simple' | 'advanced';

export interface UserPreferences {
  hasCompletedOnboarding: boolean;
  displayMode?: DisplayMode; // default 'advanced'
  defaultShareRatio?: number; // 0-1, default 0.5
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
  isShared?: boolean;
  shareRatio?: number; // 0-1, default 0.5
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
  // Shared expense
  isShared?: boolean;
  shareRatio?: number; // 0-1, default 0.5
  // Reimbursement tracking (one-off items only)
  isReimbursable?: boolean;
  reimbursementStatus?: 'pending' | 'received';
  expectedReimbursementMonth?: YearMonth;
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
  source: 'recurring' | 'planned-one-off' | 'planned-repeating' | 'salary' | 'taxed-income';
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
  isShared?: boolean;
  shareRatio?: number;
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
  isShared?: boolean;
  shareRatio?: number;
  isReimbursable?: boolean;
  expectedReimbursementMonth?: YearMonth;
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
  currentBalance?: number;
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
  currentValuation?: number;
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
  remainingInstallments?: number;
}

// ============================================================
// SHARED MORTGAGE
// A dedicated, multi-user-shared home loan. Unlike Debt (single owner,
// naïve monthly interest), this models a Finnish-style mortgage: one or
// more sub-loans (e.g. an interest-subsidized ASP loan + a regular loan),
// a yearly Euribor reset, actual/360 interest, time-effective fees, and a
// 50/50 ownership-balancing story between the members.
// Storage is shared (data/shared/mortgages); access is controlled by the
// `members` list, not a single `userId`.
// ============================================================

export type MortgageLoanKind = 'asp' | 'regular';
/** annuity-fixed-term: recompute the level payment at each rate reset to keep maturity fixed (Finnish tasaerä). */
export type MortgagePaymentMode = 'annuity-fixed-term' | 'fixed-payment';
export type MortgageDayCount = 'actual/360' | '30E/360';
export type MortgageMemberRole = 'owner' | 'member';
export type MortgageExtraPaymentMode = 'shorten-term' | 'lower-payment';
/** loan-insurance is per-loan (needs loanId); invoicing-fee and service-fee are mortgage-level. */
export type MortgageCostType = 'loan-insurance' | 'invoicing-fee' | 'service-fee';

/** Government ASP interest-subsidy parameters (Finnish first-home scheme). */
export interface MortgageAspSubsidyConfig {
  enabled: boolean;
  thresholdRate: number; // annual % above which the subsidy applies, e.g. 3.8
  subsidyShare: number; // fraction of the excess interest the state pays, e.g. 0.7
  eligibilityYears: number; // window from the loan start, e.g. 10
}

/** One sub-loan inside a shared mortgage (e.g. ASP vs regular). */
export interface MortgageLoan {
  id: string;
  label: string; // "ASP loan", "Regular loan"
  kind: MortgageLoanKind;
  initialPrincipal: number; // genesis principal, e.g. 140000 / 153000
  startDate: YearMonth; // first amortization month
  originalTermMonths: number; // used to recompute the annuity at each reset
  paymentMode: MortgagePaymentMode;
  margin: number; // pp added on top of Euribor, e.g. 0.4
  dayCount: MortgageDayCount;
  paymentDayOfMonth?: number; // day the bank debits (e.g. 14); drives exact actual/360 spans
  currentMonthlyPayment?: number; // last known principal+interest payment; seeds/overrides month 1
  aspSubsidy?: MortgageAspSubsidyConfig; // meaningful only when kind === 'asp'
}

/** A member of the shared mortgage and their ownership-balancing config. */
export interface MortgageMember {
  userId: string;
  email: string; // denormalized for display; resolved when added
  name: string; // denormalized for display
  role: MortgageMemberRole;
  initialPayment: number; // down payment this member contributed, e.g. 31000 / 4000
  loanSharePercent: number; // 0..1 share of the ongoing loan, e.g. 0.454 / 0.546
  ownershipTargetPercent: number; // 0..1 target share of the home; members' targets sum to 1
}

/** Annual Euribor reset entry. Applies to the whole mortgage (every loan adds its own margin). */
export interface MortgageRateEntry {
  id: string;
  mortgageId: string;
  effectiveDate: YearMonth; // when this rate takes effect
  euriborRate: number; // Euribor 12m, EXCLUDING margin
  note?: string;
  createdAt: string;
}

/** Time-effective fee/insurance value, so a later change keeps the full history. */
export interface MortgageCostEntry {
  id: string;
  mortgageId: string;
  type: MortgageCostType;
  loanId?: string; // required for 'loan-insurance'
  effectiveDate: YearMonth;
  amount: number; // monthly amount (positive)
  note?: string;
  createdAt: string;
}

/** Manual early / extra payment against a specific sub-loan. */
export interface MortgageExtraPayment {
  id: string;
  mortgageId: string;
  loanId: string;
  date: YearMonth;
  amount: number;
  mode: MortgageExtraPaymentMode; // shorten-term (finish earlier) or lower-payment (smaller installments)
  note?: string;
  createdAt: string;
}

/** Drift re-anchor: an observed actual balance for one loan at a month. */
export interface MortgageBalanceSnapshot {
  id: string;
  mortgageId: string;
  loanId: string;
  yearMonth: YearMonth;
  actualBalance: number; // POSITIVE remaining principal
  note?: string;
  createdAt: string;
}

/**
 * A recorded ACTUAL monthly figure for one loan, imported from the bank's
 * statements (or the user's spreadsheet). When present for a loan-month, the
 * engine uses these verbatim instead of computing them — making the historical
 * ledger an exact match. Projection resumes from the latest actual balance.
 * All amounts are POSITIVE magnitudes.
 */
export interface MortgageActualEntry {
  id: string;
  mortgageId: string;
  loanId: string;
  yearMonth: YearMonth;
  remaining: number; // remaining balance at end of the month
  repayment: number; // the bank's total charge for the loan this month (incl insurance + invoicing share)
  interest: number; // interest paid this month
  insurance: number; // insurance paid this month
  createdAt: string;
}

export interface SharedMortgage {
  id: string;
  name: string;
  currency: Currency;
  housePrice: number;
  rateResetMonth: number; // 1-12, e.g. 12 (December)
  rateResetDay: number; // 1-31, e.g. 14
  loans: MortgageLoan[];
  members: MortgageMember[];
  isArchived: boolean;
  createdBy: string; // userId of creator (becomes an 'owner')
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

// ---------- Request types ----------
export interface CreateMortgageLoanInput {
  label: string;
  kind: MortgageLoanKind;
  initialPrincipal: number;
  startDate: YearMonth;
  originalTermMonths: number;
  paymentMode?: MortgagePaymentMode;
  margin: number;
  dayCount?: MortgageDayCount;
  paymentDayOfMonth?: number;
  currentMonthlyPayment?: number;
  aspSubsidy?: MortgageAspSubsidyConfig;
}

export interface CreateMortgageMemberInput {
  email: string;
  role?: MortgageMemberRole;
  initialPayment: number;
  loanSharePercent: number;
  ownershipTargetPercent: number;
}

export interface CreateMortgageRateInput {
  effectiveDate: YearMonth;
  euriborRate: number;
  note?: string;
}

export interface CreateMortgageCostInput {
  type: MortgageCostType;
  loanId?: string;
  effectiveDate: YearMonth;
  amount: number;
  note?: string;
}

export interface CreateMortgageRequest {
  name: string;
  currency: Currency;
  housePrice: number;
  rateResetMonth?: number;
  rateResetDay?: number;
  loans: CreateMortgageLoanInput[];
  creatorInitialPayment: number;
  creatorLoanSharePercent: number;
  creatorOwnershipTargetPercent: number;
  members?: CreateMortgageMemberInput[];
  // genesis schedules (optional) so the back-history amortizes correctly
  rates?: CreateMortgageRateInput[];
  costs?: CreateMortgageCostInput[];
}

export interface UpdateMortgageRequest {
  name?: string;
  housePrice?: number;
  rateResetMonth?: number;
  rateResetDay?: number;
  isArchived?: boolean;
}

export type UpdateMortgageLoanRequest = Partial<CreateMortgageLoanInput>;

export interface AddMortgageMemberRequest {
  email: string;
  initialPayment: number;
  loanSharePercent: number;
  ownershipTargetPercent: number;
  role?: MortgageMemberRole;
}

export interface UpdateMortgageMemberRequest {
  role?: MortgageMemberRole;
  initialPayment?: number;
  loanSharePercent?: number;
  ownershipTargetPercent?: number;
}

export interface SetMortgageRateRequest {
  effectiveDate: YearMonth;
  euriborRate: number;
  note?: string;
}

export interface SetMortgageCostRequest {
  type: MortgageCostType;
  loanId?: string;
  effectiveDate: YearMonth;
  amount: number;
  note?: string;
}

export interface CreateMortgageExtraPaymentRequest {
  loanId: string;
  date: YearMonth;
  amount: number;
  mode: MortgageExtraPaymentMode;
  note?: string;
}

export interface CreateMortgageBalanceSnapshotRequest {
  loanId: string;
  yearMonth: YearMonth;
  actualBalance: number;
  note?: string;
}

export interface MortgageActualInput {
  loanId: string;
  yearMonth: YearMonth;
  remaining: number;
  repayment: number;
  interest: number;
  insurance: number;
}

export interface ImportMortgageActualsRequest {
  entries: MortgageActualInput[];
  /** When true, replace all existing actuals; otherwise upsert by loan+month. */
  replaceAll?: boolean;
}

// ---------- Projection output types ----------
export interface MortgageLoanProjectionMonth {
  loanId: string;
  startingPrincipal: number;
  effectiveAnnualRate: number; // Euribor + margin, %
  periodDays: number;
  scheduledPayment: number; // principal + interest portion for the month
  interestAccrued: number;
  subsidy: number; // ASP subsidy applied this month (reduces interest paid)
  interestPaid: number; // interestAccrued - subsidy
  principalPaid: number;
  extraPayment: number;
  insurance: number; // monthly insurance for this loan
  invoicingFeeShare: number; // this loan's share of the invoicing fee
  monthlyCharge: number; // total bank charge for the loan = P+I + invoicing share + insurance + extra
  endingPrincipal: number;
  isActual: boolean; // true when this row came from a recorded actual
}

export interface MortgageMemberPosition {
  userId: string;
  stake: number; // initialPayment + loanShare*initialLoanTotal (≈ half the house)
  liability: number; // loanShare*remainingTotal
  equity: number; // stake - liability (== initialPayment + loanShare*principalPaid)
  ownershipPercent: number; // equity / housePrice (→ target at payoff)
  leftToOwnTarget: number; // member.ownershipTargetPercent*housePrice - equity
  monthlyDeposit: number; // loanShare*totalRepayment + serviceFee — amount to transfer to the loan account
}

export interface MortgageProjectionMonth {
  yearMonth: YearMonth;
  year: number;
  month: number;
  periodDays: number;
  isHistorical: boolean; // yearMonth <= current month
  loans: MortgageLoanProjectionMonth[]; // per-loan detail (the expandable columns)
  isAllActual: boolean; // every loan row this month is a recorded actual
  // Summary/total columns (sums of the per-loan values)
  totalRemaining: number;
  totalRepayment: number; // Σ principal+interest (the amortizing installment)
  totalCharge: number; // Σ monthlyCharge (full bank charge incl insurance + invoicing) = spreadsheet "total repayment"
  totalInterest: number;
  totalSubsidy: number;
  totalInsurance: number;
  invoicingFee: number; // mortgage-level
  serviceFee: number; // mortgage-level
  principalPaidTotal: number; // initialLoanTotal - totalRemaining
  // Running cumulative totals to date (for the ledger footer)
  cumPrincipalPaid: number;
  cumInterestPaid: number;
  cumInsurancePaid: number;
  cumFeesPaid: number;
  // Per-member ownership/equity positions
  members: MortgageMemberPosition[];
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
// GOALS
// ============================================================

export interface Goal {
  id: string;
  userId: string;
  name: string;
  description?: string;
  targetAmount: number;
  currency: Currency;
  targetDate?: string; // YYYY-MM
  trackingMethod: 'account-balance' | 'net-worth' | 'manual';
  linkedAccountId?: string;
  currentManualAmount?: number;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalRequest {
  name: string;
  description?: string;
  targetAmount: number;
  currency: Currency;
  targetDate?: string;
  trackingMethod: 'account-balance' | 'net-worth' | 'manual';
  linkedAccountId?: string;
  currentManualAmount?: number;
}

export interface UpdateGoalRequest extends Partial<CreateGoalRequest> {
  isArchived?: boolean;
}

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
  // Shared mortgage — the logged-in member's slice (optional / back-compatible).
  // equity is folded into netWorth; stake (home asset) and liability (loan share)
  // are exposed separately so the wealth chart can show them as distinct bands.
  mortgageEquityTotal?: number;
  mortgageLiabilityTotal?: number;
  mortgageStakeTotal?: number;
  mortgagesBreakdown?: { mortgageId: string; name: string; stake: number; liability: number; equity: number }[];
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

export type NavigationPage = 'overview' | 'cashflow' | 'mortgage' | 'playground' | 'settings';

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
