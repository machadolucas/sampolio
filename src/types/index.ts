// Core type definitions for Sampolio - Personal Finance Planning Tool

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
  createdAt: string;
  updatedAt: string;
}

export interface SalaryConfig {
  id: string;
  accountId: string;
  name: string;
  grossSalary: number;
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

export interface UpdateRecurringItemRequest extends Partial<CreateRecurringItemRequest> {}

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
}

export interface UpdatePlannedItemRequest extends Partial<CreatePlannedItemRequest> {}

export interface CreateSalaryConfigRequest {
  accountId: string;
  name: string;
  grossSalary: number;
  taxRate: number;
  contributionsRate: number;
  otherDeductions?: number;
  startDate: YearMonth;
  endDate?: YearMonth;
  isActive?: boolean;
  isLinkedToRecurring?: boolean;
}

export interface UpdateSalaryConfigRequest extends Partial<CreateSalaryConfigRequest> {}

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
