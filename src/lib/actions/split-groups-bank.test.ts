import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankTransaction, SplitExpense, SplitGroup } from '@/types';
import type { CreateSplitExpenseFormData } from '@/lib/schemas/split.schema';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock('@/lib/split-notify', () => ({ notifySplitActivity: vi.fn() }));

const state = vi.hoisted(() => ({
  group: {
    id: 'g1', name: 'Household', currency: 'EUR', members: [{ userId: 'u1', name: 'Alex', role: 'owner' }], isArchived: false,
  } as unknown as SplitGroup,
  rows: [] as SplitExpense[],
  transactions: [] as BankTransaction[],
}));

vi.mock('@/lib/db/cached', () => ({
  cachedGetSplitGroupById: vi.fn(async () => state.group),
  cachedGetBankConnections: vi.fn(async () => [{ id: 'c1', userId: 'u1', aspspName: 'Test Bank', linkedAccounts: [{ id: 'l1', currency: 'EUR' }] }]),
}));
vi.mock('@/lib/db/bank-transactions', () => ({ getBankTransactions: vi.fn(async () => state.transactions) }));
vi.mock('@/lib/db/split-groups', () => ({
  getAllExpenses: vi.fn(async () => state.rows),
  addExpense: vi.fn(async (_groupId: string, row: SplitExpense) => { state.rows.push(row); return row; }),
  getExpenseById: vi.fn(async (_groupId: string, id: string) => state.rows.find((row) => row.id === id) ?? null),
  updateExpense: vi.fn(async (_groupId: string, id: string, row: SplitExpense) => {
    const index = state.rows.findIndex((item) => item.id === id);
    if (index < 0) return null;
    state.rows[index] = row;
    return row;
  }),
}));

import { auth } from '@/lib/auth';
import { confirmSplitBankLink, createSplitExpense } from './split-groups';

function debit(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: 'tx-booked', linkedAccountId: 'l1', dedupKey: 'synthetic-test', bookingDate: '2026-05-08', transactionDate: '2026-05-08',
    amount: -10, currency: 'EUR', status: 'booked', counterpartyName: 'Corner Cafe', firstSeenAt: '2026-05-08T00:00:00.000Z', lastSeenAt: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

type CreateOverrides = Omit<Partial<CreateSplitExpenseFormData>, 'bankLink'> & {
  bankLink?: Partial<NonNullable<CreateSplitExpenseFormData['bankLink']>>;
};

function createData(overrides: CreateOverrides = {}): CreateSplitExpenseFormData {
  const { bankLink: overrideBankLink, ...rest } = overrides;
  const bankLink = {
    txId: 'tx-booked', linkedAccountId: 'l1', bookingDate: '2026-05-08', amount: -10, currency: 'EUR' as const, counterpartyName: 'Forged',
    ...overrideBankLink,
  };
  return {
    title: 'Corner Cafe', category: 'Food', amountCents: 1000, date: '2026-05-08',
    split: { paidByUserId: 'u1', splitMode: 'equal' },
    ...rest,
    bankLink,
  };
}

function bankLinkData(): NonNullable<CreateSplitExpenseFormData['bankLink']> {
  const link = createData().bankLink;
  if (!link) throw new Error('test link missing');
  return link;
}

describe('bank-backed split actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows.length = 0;
    state.transactions = [debit()];
    vi.mocked(auth).mockResolvedValue({ user: { id: 'u1' } } as never);
  });

  it('rejects unauthenticated bank-backed creation', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await createSplitExpense('g1', createData())).error).toBe('Unauthorized');
  });

  it('uses server transaction metadata, ignoring forged client metadata', async () => {
    const saved = await createSplitExpense('g1', createData());
    expect(saved.success).toBe(true);
    expect(saved.data?.kind === 'expense' && saved.data.bankLink?.counterpartyName).toBe('Corner Cafe');
    expect(saved.data?.kind === 'expense' && saved.data.bankLink?.currency).toBe('EUR');
  });

  it('returns duplicate details, then allows only acknowledged duplicates', async () => {
    await createSplitExpense('g1', createData());
    const blocked = await createSplitExpense('g1', createData());
    expect(blocked.duplicate?.[0].expenseId).toBeTruthy();
    const allowed = await createSplitExpense('g1', createData({ acknowledgedDuplicateExpenseIds: [blocked.duplicate![0].expenseId] }));
    expect(allowed.success).toBe(true);
  });

  it('serializes concurrent duplicate checks through the group mutex', async () => {
    const results = await Promise.all([createSplitExpense('g1', createData()), createSplitExpense('g1', createData())]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
  });

  it('confirms a booked replacement once and is idempotent', async () => {
    state.transactions = [debit({ id: 'tx-pending', status: 'pending' }), debit()];
    const created = await createSplitExpense('g1', createData({ bankLink: { txId: 'tx-pending' } }));
    expect(created.data?.kind).toBe('expense');
    const expenseId = created.data?.id;
    expect(expenseId).toBeTruthy();
    const input = { expenseId: expenseId!, ...bankLinkData() };
    const confirmed = await confirmSplitBankLink('g1', input);
    expect(confirmed.data?.kind === 'expense' && confirmed.data.bankLink?.txId).toBe('tx-booked');
    expect((await confirmSplitBankLink('g1', input)).success).toBe(true);
  });

  it('can confirm an unlinked pending heuristic while rejecting credits', async () => {
    state.transactions = [debit({ id: 'tx-pending', status: 'pending' })];
    const created = await createSplitExpense('g1', createData({ bankLink: { txId: 'tx-pending' } }));
    expect(created.data?.kind).toBe('expense');
    if (created.data?.kind === 'expense') delete created.data.bankLink;
    const pending = await confirmSplitBankLink('g1', { expenseId: created.data!.id, ...bankLinkData(), txId: 'tx-pending' });
    expect(pending.success).toBe(true);
    state.transactions = [debit({ amount: 10 })];
    const credit = await confirmSplitBankLink('g1', { expenseId: created.data!.id, ...bankLinkData() });
    expect(credit.success).toBe(false);
  });
});
