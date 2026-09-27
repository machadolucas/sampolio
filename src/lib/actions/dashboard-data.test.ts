import { describe, it, expect, vi, beforeEach } from 'vitest';
import { format } from 'date-fns';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db/cached', () => ({
  cachedGetAccounts: vi.fn(),
  cachedGetGoals: vi.fn(),
  cachedGetLatestCompletedSession: vi.fn(),
  cachedGetUserPreferences: vi.fn(),
}));
vi.mock('@/lib/account-projection', () => ({ computeAccountProjection: vi.fn() }));
vi.mock('@/lib/wealth-inputs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wealth-inputs')>('@/lib/wealth-inputs');
  return { WealthInputError: actual.WealthInputError, gatherWealthInputs: vi.fn() };
});
vi.mock('@/lib/actions/budgets', () => ({ getBudgets: vi.fn() }));
vi.mock('@/lib/actions/bank', () => ({
  getBankConnectionsNeedingAttention: vi.fn(),
  getHomeBankGlance: vi.fn(),
}));
vi.mock('@/lib/actions/split-groups', () => ({
  getMySplitGroups: vi.fn(),
  getSplitActivity: vi.fn(),
  getSplitGroupView: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { cachedGetAccounts, cachedGetGoals, cachedGetLatestCompletedSession, cachedGetUserPreferences } from '@/lib/db/cached';
import { computeAccountProjection } from '@/lib/account-projection';
import { gatherWealthInputs, WealthInputError } from '@/lib/wealth-inputs';
import { getBudgets } from '@/lib/actions/budgets';
import { getBankConnectionsNeedingAttention, getHomeBankGlance } from '@/lib/actions/bank';
import { getMySplitGroups, getSplitActivity, getSplitGroupView } from '@/lib/actions/split-groups';
import { getGoalsPageData, getHomeData, getOverviewData } from './dashboard-data';
import { createMockAccount } from '@/test/mocks';
import type { WealthInputs } from '@/lib/wealth-assembly';

const wealth = { accounts: [], cashProjections: {} } as unknown as WealthInputs;

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(auth).mockResolvedValue({ user: { id: 'alex', email: 'alex@example.com', name: 'Alex', role: 'user' } } as any);
  vi.mocked(gatherWealthInputs).mockResolvedValue(wealth);
  vi.mocked(cachedGetLatestCompletedSession).mockResolvedValue(null);
  vi.mocked(cachedGetUserPreferences).mockResolvedValue({ checkInRemindersEnabled: false } as never);
  vi.mocked(getBudgets).mockResolvedValue({ success: true, data: [] });
  vi.mocked(getBankConnectionsNeedingAttention).mockResolvedValue({ success: true, data: [] });
  vi.mocked(getHomeBankGlance).mockResolvedValue({ success: true, data: [] });
  vi.mocked(getMySplitGroups).mockResolvedValue({ success: true, data: [] });
  vi.mocked(getSplitActivity).mockResolvedValue({ success: true, data: [] });
});

describe('getOverviewData', () => {
  it('requires a session and rejects arguments', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null);
    expect(await getOverviewData()).toEqual({ success: false, error: 'Unauthorized' });
    expect(await getOverviewData('smuggled')).toEqual({ success: false, error: 'Invalid request' });
    expect(gatherWealthInputs).not.toHaveBeenCalled();
  });

  it('gathers wealth inputs (with the primary retrospective) plus reminder inputs', async () => {
    vi.mocked(cachedGetLatestCompletedSession).mockResolvedValue({ yearMonth: '2026-08' } as never);
    const res = await getOverviewData();
    expect(res.success).toBe(true);
    expect(gatherWealthInputs).toHaveBeenCalledWith('alex', { retrospectiveForPrimary: true });
    expect(res.data).toMatchObject({ wealth, lastReconciledMonth: '2026-08', checkInRemindersEnabled: false, budgets: [], bankAttention: [] });
  });

  it('fails as a whole, naming the part, when a required wealth read fails', async () => {
    vi.mocked(gatherWealthInputs).mockRejectedValue(new WealthInputError('investments, receivables and debts'));
    const res = await getOverviewData();
    expect(res.success).toBe(false);
    expect(res.error).toContain('investments, receivables and debts');
    expect(res.data).toBeUndefined();
  });

  it('falls back quietly when only a reminder input fails', async () => {
    vi.mocked(getBudgets).mockRejectedValue(new Error('disk'));
    vi.mocked(cachedGetUserPreferences).mockRejectedValue(new Error('disk'));
    vi.mocked(getBankConnectionsNeedingAttention).mockResolvedValue({ success: false, error: 'x' });
    const res = await getOverviewData();
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ budgets: [], checkInRemindersEnabled: true, bankAttention: [] });
  });
});

describe('getGoalsPageData', () => {
  it('skips the wealth gather when every active goal is manual', async () => {
    vi.mocked(cachedGetGoals).mockResolvedValue([{ id: 'g', trackingMethod: 'manual', isArchived: false }] as never);
    vi.mocked(cachedGetAccounts).mockResolvedValue([]);
    const res = await getGoalsPageData();
    expect(res.data?.wealth).toBeNull();
    expect(gatherWealthInputs).not.toHaveBeenCalled();
  });

  it('gathers once, adding goal-linked accounts to the projected set', async () => {
    vi.mocked(cachedGetGoals).mockResolvedValue([
      { id: 'g1', trackingMethod: 'account-balance', linkedAccountId: 'old', isArchived: false },
      { id: 'g2', trackingMethod: 'account-balance', linkedAccountId: 'old', isArchived: false },
      { id: 'g3', trackingMethod: 'account-balance', linkedAccountId: 'ignored', isArchived: true },
    ] as never);
    vi.mocked(cachedGetAccounts).mockResolvedValue([]);
    const res = await getGoalsPageData();
    expect(res.data?.wealth).toBe(wealth);
    expect(gatherWealthInputs).toHaveBeenCalledTimes(1);
    expect(gatherWealthInputs).toHaveBeenCalledWith('alex', { extraProjectionAccountIds: ['old'] });
  });
});

describe('getHomeData', () => {
  it('projects the primary account only up to the current month, without a retrospective', async () => {
    const ym = format(new Date(), 'yyyy-MM');
    vi.mocked(cachedGetAccounts).mockResolvedValue([
      createMockAccount({ id: 'archived', isArchived: true }),
      createMockAccount({ id: 'main', startingDate: '2020-01' }),
    ]);
    vi.mocked(computeAccountProjection).mockResolvedValue({
      monthly: [{ yearMonth: ym, startingBalance: 10, totalIncome: 5, totalExpenses: 3, endingBalance: 12, netChange: 2 }],
    } as never);
    const res = await getHomeData();
    expect(computeAccountProjection).toHaveBeenCalledWith('alex', 'main', { filters: { endDate: expect.any(String) } });
    const opts = vi.mocked(computeAccountProjection).mock.calls[0][2];
    expect(opts).not.toHaveProperty('withRetrospective');
    expect(opts?.filters).not.toHaveProperty('startDate');
    expect(res.data?.glance).toMatchObject({ yearMonth: ym, endingBalance: 12, netChange: 2, currency: 'EUR' });
  });

  it('builds split lines from the group views and keeps other parts when one fails', async () => {
    vi.mocked(cachedGetAccounts).mockRejectedValue(new Error('disk'));
    vi.mocked(getMySplitGroups).mockResolvedValue({ success: true, data: [{ id: 'grp', currency: 'EUR', members: [] }] as never });
    vi.mocked(getSplitGroupView).mockResolvedValue({ success: true, data: { balances: [{ userId: 'alex', name: 'Alex', netCents: 700 }] } as never });
    const res = await getHomeData();
    expect(res.success).toBe(true);
    expect(res.data?.glance).toBeNull();
    expect(res.data?.splitGroups).toEqual([{ group: { id: 'grp', currency: 'EUR', members: [] }, balances: [{ userId: 'alex', name: 'Alex', netCents: 700 }] }]);
  });
});
