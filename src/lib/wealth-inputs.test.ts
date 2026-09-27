import { describe, it, expect, vi, beforeEach } from 'vitest';

// The gatherer's collaborators are all mocked: the cached readers need the
// Next runtime, and the reused read actions need a session.
vi.mock('@/lib/db/cached', () => ({
  cachedGetAccounts: vi.fn(),
  cachedGetWealthData: vi.fn(),
  cachedGetLatestSnapshotsByEntity: vi.fn(),
  cachedGetMortgagesForUser: vi.fn(),
  cachedGetMortgageProjectionData: vi.fn(),
}));
vi.mock('@/lib/account-projection', () => ({ computeAccountProjection: vi.fn() }));
vi.mock('@/lib/actions/bank', () => ({ getCardLiabilities: vi.fn() }));
vi.mock('@/lib/actions/split-groups', () => ({ getMySplitNetBalance: vi.fn() }));

import {
  cachedGetAccounts,
  cachedGetWealthData,
  cachedGetLatestSnapshotsByEntity,
  cachedGetMortgagesForUser,
  cachedGetMortgageProjectionData,
} from '@/lib/db/cached';
import { computeAccountProjection } from '@/lib/account-projection';
import { getCardLiabilities } from '@/lib/actions/bank';
import { getMySplitNetBalance } from '@/lib/actions/split-groups';
import { gatherWealthInputs, WealthInputError } from './wealth-inputs';
import {
  createMockAccount,
  createMockDebt,
  createMockExtraPayment,
  createMockInvestment,
  createMockContribution,
  createMockReferenceRate,
  createMockSharedMortgage,
} from '@/test/mocks';

const userId = 'alex';

function projectionFor(id: string, withRetrospective: boolean) {
  return {
    monthly: [{ yearMonth: '2026-09', accountId: id }],
    retrospective: withRetrospective ? [{ yearMonth: '2026-08' }] : [],
    categories: [],
    salaryConfigs: [],
    taxedIncomes: [],
    account: createMockAccount({ id }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cachedGetAccounts).mockResolvedValue([
    createMockAccount({ id: 'main' }),
    createMockAccount({ id: 'old', isArchived: true }),
    createMockAccount({ id: 'savings' }),
  ]);
  vi.mocked(cachedGetWealthData).mockResolvedValue({
    investments: [
      { ...createMockInvestment({ id: 'inv' }), contributions: [createMockContribution({ id: 'c1' })] },
      { ...createMockInvestment({ id: 'inv-archived', isArchived: true }), contributions: [] },
    ],
    debts: [{ ...createMockDebt({ id: 'debt' }), referenceRates: [createMockReferenceRate({ id: 'r1' })], extraPayments: [createMockExtraPayment({ id: 'e1' })] }],
    receivables: [],
  });
  vi.mocked(cachedGetLatestSnapshotsByEntity).mockResolvedValue({});
  vi.mocked(cachedGetMortgagesForUser).mockResolvedValue([]);
  vi.mocked(computeAccountProjection).mockImplementation(async (_u, id, opts) =>
    projectionFor(id, !!opts?.withRetrospective) as never
  );
  vi.mocked(getCardLiabilities).mockResolvedValue({ success: true, data: [{ linkId: 'card', name: 'Card', outstanding: 120 }] });
  vi.mocked(getMySplitNetBalance).mockResolvedValue({ success: true, data: { netCents: -500 } });
});

describe('gatherWealthInputs', () => {
  it('returns active entities with child rows keyed by parent id (embedded arrays stripped)', async () => {
    const inputs = await gatherWealthInputs(userId);
    expect(inputs.accounts.map((a) => a.id)).toEqual(['main', 'savings']);
    expect(inputs.investments.map((i) => i.id)).toEqual(['inv']);
    expect(inputs.investments[0]).not.toHaveProperty('contributions');
    expect(inputs.debts[0]).not.toHaveProperty('referenceRates');
    expect(inputs.debts[0]).not.toHaveProperty('extraPayments');
    expect(inputs.contributions.inv.map((c) => c.id)).toEqual(['c1']);
    expect(inputs.referenceRates.debt.map((r) => r.id)).toEqual(['r1']);
    expect(inputs.extraPayments.debt.map((e) => e.id)).toEqual(['e1']);
    expect(inputs.cardLiabilities).toHaveLength(1);
    expect(inputs.splitNetCents).toBe(-500);
    expect(Object.keys(inputs.cashProjections).sort()).toEqual(['main', 'savings']);
  });

  it('reconstructs the retrospective only for the primary account when asked', async () => {
    const inputs = await gatherWealthInputs(userId, { retrospectiveForPrimary: true });
    expect(inputs.cashProjections.main.retrospective).toHaveLength(1);
    expect(inputs.cashProjections.savings.retrospective).toHaveLength(0);
    const plain = await gatherWealthInputs(userId);
    expect(plain.cashProjections.main.retrospective).toHaveLength(0);
  });

  it('projects extra (archived) accounts without adding them to the totals, and skips unknown ids', async () => {
    const inputs = await gatherWealthInputs(userId, { extraProjectionAccountIds: ['old', 'deleted-account'] });
    expect(inputs.accounts.map((a) => a.id)).not.toContain('old');
    expect(Object.keys(inputs.cashProjections).sort()).toEqual(['main', 'old', 'savings']);
    expect(computeAccountProjection).toHaveBeenCalledTimes(3);
  });

  it('skips a mortgage that vanished or no longer lists the user', async () => {
    const mine = createMockSharedMortgage({ id: 'mine', name: 'Home' });
    const stale = createMockSharedMortgage({ id: 'stale', name: 'Old flat' });
    vi.mocked(cachedGetMortgagesForUser).mockResolvedValue([mine, stale, createMockSharedMortgage({ id: 'gone' })]);
    vi.mocked(cachedGetMortgageProjectionData).mockImplementation(async (id) => {
      if (id === 'gone') return null;
      const mortgage = id === 'stale' ? { ...stale, members: stale.members.filter((m) => m.userId !== userId) } : mine;
      return { mortgage, rates: [], costs: [], extraPayments: [], snapshots: [], actuals: [] };
    });
    const inputs = await gatherWealthInputs(userId);
    expect(inputs.mortgages.map((m) => m.name)).toEqual(['Home']);
  });

  it.each([
    ['credit cards', () => vi.mocked(getCardLiabilities).mockResolvedValue({ success: false, error: 'boom' })],
    ['split balances', () => vi.mocked(getMySplitNetBalance).mockRejectedValue(new Error('disk'))],
    ['investments, receivables and debts', () => vi.mocked(cachedGetWealthData).mockRejectedValue(new Error('decrypt'))],
    ['latest balances', () => vi.mocked(cachedGetLatestSnapshotsByEntity).mockRejectedValue(new Error('decrypt'))],
    ['cash projections', () => vi.mocked(computeAccountProjection).mockResolvedValue(null)],
  ])('fails as a whole, naming the part, when %s cannot be read (never substitutes [] / 0)', async (part, arrange) => {
    arrange();
    const promise = gatherWealthInputs(userId);
    await expect(promise).rejects.toBeInstanceOf(WealthInputError);
    await expect(promise).rejects.toMatchObject({ part });
  });
});
