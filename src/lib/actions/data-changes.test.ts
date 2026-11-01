import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetDataChangesForTests,
  publishDataChanges,
  readDataChangeState,
} from '@/lib/data-changes';

const state = vi.hoisted(() => ({
  scopes: new Set<string>(),
  afterCallbacks: [] as Array<() => void | Promise<void>>,
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db/data-changes', () => ({ getDataChangeScopes: vi.fn(() => state.scopes) }));
vi.mock('next/cache', () => ({ updateTag: vi.fn() }));
vi.mock('next/server', () => ({
  after: vi.fn((callback: () => void | Promise<void>) => state.afterCallbacks.push(callback)),
}));

import { auth } from '@/lib/auth';
import { updateTag } from 'next/cache';
import { after } from 'next/server';
import { synchronizeDataChanges } from './data-changes';

describe('synchronizeDataChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.afterCallbacks = [];
    state.scopes = new Set(['user:alex', 'split-group:shared-home']);
    __resetDataChangesForTests();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'alex' } } as never);
  });

  it('flushes only pending tags in authorized private and shared scopes, then acknowledges after the response', async () => {
    publishDataChanges(['user:alex:accounts', 'user:sam:accounts', 'split-group:shared-home:summary']);

    const result = await synchronizeDataChanges();
    expect(result.success).toBe(true);
    expect(vi.mocked(updateTag).mock.calls.map(([tag]) => tag).sort()).toEqual([
      'split-group:shared-home:summary',
      'user:alex:accounts',
    ]);
    expect(after).toHaveBeenCalledTimes(1);
    expect(state.afterCallbacks).toHaveLength(1);
    expect([...readDataChangeState(state.scopes).pending.keys()].sort()).toEqual([
      'split-group:shared-home:summary',
      'user:alex:accounts',
    ]);

    await state.afterCallbacks[0]();
    expect(readDataChangeState(state.scopes).pending.size).toBe(0);
    expect(updateTag).toHaveBeenCalledTimes(2);
  });

  it('does not let an older deferred acknowledgment clear a repeated pending change', async () => {
    publishDataChanges(['user:alex:accounts']);
    await synchronizeDataChanges();
    const oldAcknowledgment = state.afterCallbacks[0];

    publishDataChanges(['user:alex:accounts']);
    await oldAcknowledgment();
    expect(readDataChangeState(state.scopes).pending.has('user:alex:accounts')).toBe(true);

    await synchronizeDataChanges();
    await state.afterCallbacks[1]();
    expect(readDataChangeState(state.scopes).pending.size).toBe(0);
  });

  it('rejects unauthenticated, empty-scope, and caller-supplied arguments', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await synchronizeDataChanges()).error).toBe('Unauthorized');

    vi.mocked(auth).mockResolvedValue({ user: { id: 'alex' } } as never);
    state.scopes = new Set();
    expect((await synchronizeDataChanges()).error).toBe('Unauthorized');
    state.scopes = new Set(['user:alex']);
    expect((await synchronizeDataChanges('user:sam:accounts')).error).toBe('Invalid arguments');
    expect(updateTag).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
