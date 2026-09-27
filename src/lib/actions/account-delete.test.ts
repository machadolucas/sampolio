import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedMortgage, SplitGroup, SplitGroupSummary } from '@/types';

// deleteMyAccount must decide on what is on disk, not on cached copies: a
// stale cached group list must never let it delete a group other members
// share, or leave a multi-member group without an owner.

const ALEX = 'alex-id';
const SAM = 'sam-id';

const state = vi.hoisted(() => ({
  disk: new Map<string, SplitGroup>(),
  cached: new Map<string, SplitGroup>(),
  summaries: new Map<string, SplitGroupSummary>(),
  mortgages: new Map<string, SharedMortgage>(),
  deletedGroups: [] as string[],
  removedMembers: [] as Array<[string, string]>,
  hardDeleted: [] as string[],
  bankTeardowns: 0,
}));

vi.mock('next/cache', () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: ALEX, email: 'alex@example.com', name: 'Alex', role: 'user' } })),
  getSessionAgeMs: vi.fn(async () => 60_000),
}));
vi.mock('@/lib/auth/server', () => ({ getAuth: vi.fn() }));
vi.mock('@/lib/db/passkeys', () => ({ getUserPasskeys: vi.fn(() => []) }));
vi.mock('@/lib/bank/teardown', () => ({
  teardownBankConnection: vi.fn(async () => {
    state.bankTeardowns++;
  }),
}));
vi.mock('@/lib/db/users', () => ({
  setUserAvatar: vi.fn(),
  hardDeleteUser: vi.fn(async (id: string) => {
    state.hardDeleted.push(id);
  }),
  getLockoutRetryAfterSeconds: vi.fn(),
  isAccountLocked: vi.fn(),
  recordFailedLogin: vi.fn(),
  recordSuccessfulLogin: vi.fn(),
  getAllUsers: vi.fn(async () => [{ id: ALEX, role: 'user', isActive: true }, { id: SAM, role: 'user', isActive: true }]),
}));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const summaryFor = (id: string): SplitGroupSummary =>
  state.summaries.get(id) ?? { groupId: id, netByUserId: {}, expenseCount: 0, paymentCount: 0, monthsWithData: [], updatedAt: '' };
vi.mock('@/lib/db/cached', () => ({
  cachedGetAccounts: vi.fn(async () => []),
  cachedGetGoals: vi.fn(async () => []),
  cachedGetBudgets: vi.fn(async () => []),
  cachedGetTrips: vi.fn(async () => []),
  cachedGetBankConnections: vi.fn(async () => [{ id: 'conn-1' }]),
  // The cached view is a stale snapshot, deliberately different from disk.
  cachedGetSplitGroupsForUser: vi.fn(async () => [...state.cached.values()].map(clone)),
  cachedGetSplitGroupSummary: vi.fn(async (id: string) => clone(summaryFor(id))),
  cachedGetMortgagesForUser: vi.fn(async () => []),
  cachedGetAllUsers: vi.fn(async () => [{ id: ALEX, role: 'user', isActive: true }]),
}));
vi.mock('@/lib/db/split-groups', () => ({
  getSplitGroupsForUser: vi.fn(async (uid: string) =>
    [...state.disk.values()].filter((g) => g.members.some((m) => m.userId === uid)).map(clone)),
  getSplitGroupById: vi.fn(async (id: string) => (state.disk.has(id) ? clone(state.disk.get(id)!) : null)),
  getSplitGroupSummary: vi.fn(async (id: string) => clone(summaryFor(id))),
  deleteSplitGroup: vi.fn(async (id: string) => {
    state.deletedGroups.push(id);
    state.disk.delete(id);
    return true;
  }),
  removeSplitGroupMember: vi.fn(async (id: string, uid: string) => {
    state.removedMembers.push([id, uid]);
    const g = state.disk.get(id)!;
    g.members = g.members.filter((m) => m.userId !== uid);
    return clone(g);
  }),
}));
vi.mock('@/lib/db/shared-mortgages', () => ({
  getMortgagesForUser: vi.fn(async (uid: string) =>
    [...state.mortgages.values()].filter((m) => m.members.some((x) => x.userId === uid)).map(clone)),
  getMortgageById: vi.fn(async (id: string) => (state.mortgages.has(id) ? clone(state.mortgages.get(id)!) : null)),
  deleteMortgage: vi.fn(async () => true),
  removeMortgageMember: vi.fn(async () => null),
}));

import { deleteMyAccount } from './account';

function group(id: string, members: Array<[string, 'owner' | 'member']>): SplitGroup {
  return {
    id,
    name: `Group ${id}`,
    currency: 'EUR',
    members: members.map(([userId, role]) => ({ userId, email: `${userId}@example.com`, name: userId, role })),
    recurrenceRules: [],
    isArchived: false,
    createdBy: ALEX,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: ALEX,
  } as SplitGroup;
}

const confirm = { confirmationText: 'alex@example.com' };

beforeEach(() => {
  state.disk.clear();
  state.cached.clear();
  state.summaries.clear();
  state.mortgages.clear();
  state.deletedGroups = [];
  state.removedMembers = [];
  state.hardDeleted = [];
  state.bankTeardowns = 0;
});

describe('deleteMyAccount shared-group guards', () => {
  it('refuses when on disk Alex is the sole owner of a multi-member group, even if the cache says solo', async () => {
    // Cache: Alex alone (would be "delete the group"). Disk: Sam joined as a member.
    state.cached.set('g1', group('g1', [[ALEX, 'owner']]));
    state.disk.set('g1', group('g1', [[ALEX, 'owner'], [SAM, 'member']]));

    const res = await deleteMyAccount(confirm);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Make another member an owner of "Group g1"/);
    expect(state.deletedGroups).toEqual([]);
    expect(state.removedMembers).toEqual([]);
    expect(state.bankTeardowns).toBe(0);
    expect(state.hardDeleted).toEqual([]);
  });

  it('refuses while Alex still has an unsettled balance on disk', async () => {
    state.disk.set('g1', group('g1', [[ALEX, 'member'], [SAM, 'owner']]));
    state.summaries.set('g1', { ...summaryFor('g1'), netByUserId: { [ALEX]: -500, [SAM]: 500 } });
    const res = await deleteMyAccount(confirm);
    expect(res).toEqual({ success: false, error: 'Settle up to €0 in "Group g1" first' });
    expect(state.hardDeleted).toEqual([]);
  });

  it('leaves a group with another owner, deletes a solo group, then tears down and deletes the user', async () => {
    state.disk.set('shared', group('shared', [[ALEX, 'owner'], [SAM, 'owner']]));
    state.disk.set('solo', group('solo', [[ALEX, 'owner']]));

    expect(await deleteMyAccount(confirm)).toEqual({ success: true });
    expect(state.removedMembers).toEqual([['shared', ALEX]]);
    expect(state.deletedGroups).toEqual(['solo']);
    expect(state.bankTeardowns).toBe(1);
    expect(state.hardDeleted).toEqual([ALEX]);
  });

  it('refuses when Alex is the sole owner of a shared mortgage with other members', async () => {
    state.mortgages.set('m1', {
      id: 'm1',
      name: 'Home loan',
      members: [
        { userId: ALEX, role: 'owner' },
        { userId: SAM, role: 'member' },
      ],
    } as unknown as SharedMortgage);
    const res = await deleteMyAccount(confirm);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Make another member an owner of "Home loan"/);
    expect(state.hardDeleted).toEqual([]);
  });
});
