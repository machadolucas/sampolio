import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplitExpense, SplitExpenseItem, SplitGroup, SplitGroupSummary } from '@/types';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock('@/lib/split-notify', () => ({ notifySplitActivity: vi.fn() }));

const ALEX = 'alex-id';
const SAM = 'sam-id';

const state = vi.hoisted(() => ({
  group: null as unknown as SplitGroup,
  summary: null as unknown as SplitGroupSummary,
  rows: [] as SplitExpense[],
  users: new Map<string, { id: string; email: string; name: string; isActive: boolean }>(),
}));

function freshGroup(): SplitGroup {
  return {
    id: 'g1',
    name: 'Household',
    currency: 'EUR',
    members: [
      { userId: ALEX, email: 'alex@example.com', name: 'Alex', role: 'owner' },
      { userId: SAM, email: 'sam@example.com', name: 'Sam', role: 'member' },
    ],
    recurrenceRules: [],
    isArchived: false,
    createdBy: ALEX,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: ALEX,
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

vi.mock('@/lib/db/cached', () => ({
  // The cached copy is a snapshot: mutations of state.group are NOT visible
  // through it until "invalidation" — exactly what the stale-read bugs need.
  cachedGetSplitGroupById: vi.fn(async () => clone(state.group)),
  cachedGetSplitGroupSummary: vi.fn(async () => clone(state.summary)),
}));
vi.mock('@/lib/db/users', () => ({
  findUserByEmail: vi.fn(async (email: string) => state.users.get(email) ?? null),
}));
vi.mock('@/lib/db/split-groups', () => ({
  getSplitGroupById: vi.fn(async () => clone(state.group)),
  getSplitGroupSummary: vi.fn(async () => clone(state.summary)),
  addSplitGroupMember: vi.fn(async (_g: string, member: SplitGroup['members'][number]) => {
    state.group.members.push(member);
    return clone(state.group);
  }),
  removeSplitGroupMember: vi.fn(async (_g: string, userId: string) => {
    state.group.members = state.group.members.filter((m) => m.userId !== userId);
    return clone(state.group);
  }),
  updateSplitGroupMemberRole: vi.fn(async () => clone(state.group)),
  updateRecurrenceRule: vi.fn(async (_g: string, ruleId: string, updates: Record<string, unknown>) => {
    state.group.recurrenceRules = state.group.recurrenceRules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r));
    return clone(state.group);
  }),
  upsertExpenseByOccurrence: vi.fn(async (_g: string, expense: SplitExpense) => {
    // Simulate disk latency so two queued catch-ups genuinely overlap if unlocked.
    await new Promise((r) => setTimeout(r, 1));
    const idx = state.rows.findIndex((r) => r.occurrenceKey === expense.occurrenceKey);
    if (idx >= 0) {
      state.rows[idx] = expense;
      return { expense, created: false };
    }
    state.rows.push(expense);
    return { expense, created: true };
  }),
  locateExpense: vi.fn(async (_g: string, id: string) => {
    const index = state.rows.findIndex((r) => r.id === id);
    return index >= 0 ? { ym: state.rows[index].date.slice(0, 7), rows: state.rows, index } : null;
  }),
  replaceLocatedExpense: vi.fn(async (_g: string, loc: { index: number }, next: SplitExpense) => {
    state.rows[loc.index] = next;
    return next;
  }),
  deleteLocatedExpense: vi.fn(async (_g: string, loc: { index: number }) => state.rows.splice(loc.index, 1)[0]),
  addExpense: vi.fn(async (_g: string, row: SplitExpense) => {
    state.rows.push(row);
    return row;
  }),
}));

import { auth } from '@/lib/auth';
import { updateTag } from 'next/cache';
import { notifySplitActivity } from '@/lib/split-notify';
import { locateExpense } from '@/lib/db/split-groups';
import {
  addSplitGroupMember,
  catchUpGroupRecurrences,
  createSplitExpense,
  deleteSplitExpense,
  leaveSplitGroup,
  removeSplitGroupMember,
  updateSplitExpense,
} from './split-groups';

const signIn = (userId: string) => vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
const tags = () => vi.mocked(updateTag).mock.calls.map(([t]) => t);

function expenseRow(overrides: Partial<SplitExpenseItem> = {}): SplitExpenseItem {
  return {
    kind: 'expense',
    id: 'e1',
    groupId: 'g1',
    date: '2026-03-10',
    currency: 'EUR',
    netByUserId: { [ALEX]: 500, [SAM]: -500 },
    source: 'manual',
    createdByUserId: ALEX,
    createdAt: '2026-03-10T10:00:00.000Z',
    updatedAt: '2026-03-10T10:00:00.000Z',
    title: 'Groceries',
    category: 'Groceries',
    amountCents: 1000,
    paidBy: [{ userId: ALEX, amountCents: 1000 }],
    owed: [
      { userId: ALEX, amountCents: 500 },
      { userId: SAM, amountCents: 500 },
    ],
    splitMode: 'equal',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.group = freshGroup();
  state.summary = { groupId: 'g1', netByUserId: {}, expenseCount: 0, paymentCount: 0, monthsWithData: [], updatedAt: '' };
  state.rows = [];
  state.users = new Map([
    ['taylor@example.com', { id: 'taylor-id', email: 'taylor@example.com', name: 'Taylor', isActive: true }],
    ['inactive@example.com', { id: 'inactive-id', email: 'inactive@example.com', name: 'Old', isActive: false }],
  ]);
  signIn(ALEX);
});

describe('member removal and leaving (CXA-08, SEC-03)', () => {
  it('refuses to remove the last owner, even themselves', async () => {
    const res = await removeSplitGroupMember('g1', ALEX);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/owner/i);
    expect(state.group.members).toHaveLength(2);
  });

  it('removes a settled non-owner', async () => {
    const res = await removeSplitGroupMember('g1', SAM);
    expect(res.success).toBe(true);
    expect(state.group.members.map((m) => m.userId)).toEqual([ALEX]);
    expect(tags()).toContain(`user:${SAM}:split-groups`);
  });

  it('re-reads the balance inside the lock rather than trusting a cached summary', async () => {
    state.summary.netByUserId = { [SAM]: -500, [ALEX]: 500 };
    const res = await removeSplitGroupMember('g1', SAM);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/€0/);
  });

  it('lets a settled member leave on their own', async () => {
    signIn(SAM);
    const res = await leaveSplitGroup('g1');
    expect(res.success).toBe(true);
    expect(state.group.members.map((m) => m.userId)).toEqual([ALEX]);
    expect(tags()).toContain(`user:${SAM}:split-groups`);
  });

  it('blocks leaving with a non-zero balance', async () => {
    signIn(SAM);
    state.summary.netByUserId = { [SAM]: -500, [ALEX]: 500 };
    const res = await leaveSplitGroup('g1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Settle up/);
    expect(state.group.members).toHaveLength(2);
  });

  it('blocks the last owner from leaving with a clear message', async () => {
    const res = await leaveSplitGroup('g1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/only owner/);
  });

  it('rejects non-members', async () => {
    signIn('stranger');
    expect((await leaveSplitGroup('g1')).success).toBe(false);
  });
});

describe('adding members by email (SEC-03)', () => {
  it('returns one generic error for unknown and inactive accounts', async () => {
    const unknown = await addSplitGroupMember('g1', { email: 'nobody@example.com' });
    const inactive = await addSplitGroupMember('g1', { email: 'inactive@example.com' });
    expect(unknown.success).toBe(false);
    expect(unknown.error).toBe(inactive.error);
    expect(unknown.error).not.toContain('nobody@example.com');
  });

  it('adds an active account', async () => {
    const res = await addSplitGroupMember('g1', { email: 'taylor@example.com' });
    expect(res.success).toBe(true);
    expect(state.group.members.map((m) => m.userId)).toContain('taylor-id');
  });
});

describe('split validation (CXA-04)', () => {
  it('rejects a weighted split without a config before persisting', async () => {
    const res = await createSplitExpense('g1', {
      title: 'Rent',
      category: 'Rent',
      amountCents: 10000,
      date: '2026-03-01',
      split: { paidByUserId: ALEX, splitMode: 'shares' },
    });
    expect(res.success).toBe(false);
    expect(state.rows).toHaveLength(0);
  });
});

describe('recurrence catch-up (BUG-14)', () => {
  it('generates and notifies once when two catch-ups race', async () => {
    state.group.recurrenceRules = [
      {
        id: 'rule-1',
        title: 'Streaming',
        category: 'TV/Phone/Internet',
        amountCents: 1500,
        currency: 'EUR',
        split: { paidByUserId: ALEX, splitMode: 'equal' },
        interval: 'monthly',
        anchorDate: '2026-01-15',
        endDate: '2026-03-15',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const [first, second] = await Promise.all([catchUpGroupRecurrences('g1'), catchUpGroupRecurrences('g1')]);
    expect(first.data?.generated).toBe(3);
    expect(second.data?.generated).toBe(0);
    expect(state.rows).toHaveLength(3);
    expect(vi.mocked(notifySplitActivity)).toHaveBeenCalledTimes(3);
    expect(state.group.recurrenceRules[0].lastGeneratedThrough).toBe('2026-03-15');
    expect(tags()).toEqual(expect.arrayContaining(['split-group:g1:expenses:2026-01', 'split-group:g1:expenses:2026-03']));
  });
});

describe('expense edit/delete (PERF-03/04)', () => {
  it('passes the month hint through and invalidates both the old and new month', async () => {
    state.rows = [expenseRow()];
    const res = await updateSplitExpense(
      'g1',
      'e1',
      { title: 'Groceries', category: 'Groceries', amountCents: 1200, date: '2026-04-02', split: { paidByUserId: ALEX, splitMode: 'equal' } },
      '2026-03',
    );
    expect(res.success).toBe(true);
    expect(vi.mocked(locateExpense)).toHaveBeenCalledWith('g1', 'e1', '2026-03');
    expect(tags()).toEqual(expect.arrayContaining(['split-group:g1:expenses:2026-03', 'split-group:g1:expenses:2026-04']));
    expect(tags()).not.toContain('split-group:g1:expense-chunks');
  });

  it('ignores a malformed month hint', async () => {
    state.rows = [expenseRow()];
    await deleteSplitExpense('g1', 'e1', '../../x');
    expect(vi.mocked(locateExpense)).toHaveBeenCalledWith('g1', 'e1', undefined);
  });

  it('deletes with one locate and notifies from the removed row', async () => {
    state.rows = [expenseRow()];
    const res = await deleteSplitExpense('g1', 'e1', '2026-03');
    expect(res.success).toBe(true);
    expect(state.rows).toHaveLength(0);
    expect(vi.mocked(locateExpense)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifySplitActivity)).toHaveBeenCalledWith(expect.objectContaining({ event: 'expense.deleted' }));
    expect(tags()).toContain('split-group:g1:expenses:2026-03');
    expect((await deleteSplitExpense('g1', 'e1')).success).toBe(false);
  });
});
