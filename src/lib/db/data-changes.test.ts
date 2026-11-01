import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  users: new Map<string, { isActive: number; deletedAt: number | null }>(),
  groups: [] as string[],
  mortgages: [] as string[],
}));

vi.mock('./sqlite/client', () => ({
  getSqlite: () => ({
    prepare: () => ({ get: (id: string) => state.users.get(id) }),
  }),
}));
vi.mock('./sqlite/docs', () => ({
  listRows: (table: { kind: string }) => {
    const ids = table.kind === 'group' ? state.groups : state.mortgages;
    return ids.map((id) => ({ keys: { groupId: id, mortgageId: id } }));
  },
}));
vi.mock('./sqlite/schema', () => ({
  splitGroupMemberIndex: { kind: 'group' },
  mortgageMemberIndex: { kind: 'mortgage' },
}));

import { getDataChangeScopes } from './data-changes';

describe('data-change user scopes', () => {
  beforeEach(() => {
    state.users = new Map([['alex', { isActive: 1, deletedAt: null }]]);
    state.groups = ['household'];
    state.mortgages = ['home-loan'];
  });

  it('includes current memberships and drops revoked shared scopes on the next read', () => {
    expect(getDataChangeScopes('alex')).toEqual(new Set([
      'all-data', 'users', 'app-settings', 'user:alex',
      'split-group:household', 'mortgage:home-loan',
    ]));

    state.groups = [];
    const afterRemoval = getDataChangeScopes('alex');
    expect(afterRemoval.has('split-group:household')).toBe(false);
    expect(afterRemoval.has('mortgage:home-loan')).toBe(true);
  });

  it('returns no scopes for inactive or deleted users', () => {
    state.users.set('alex', { isActive: 0, deletedAt: null });
    expect(getDataChangeScopes('alex').size).toBe(0);
    state.users.set('alex', { isActive: 1, deletedAt: 123 });
    expect(getDataChangeScopes('alex').size).toBe(0);
  });
});
