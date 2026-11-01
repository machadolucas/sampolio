import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetDataChangesForTests,
  acknowledgeDataChanges,
  dataChangeScope,
  publishDataChanges,
  readDataChangeState,
} from './data-changes';

describe('data-change journal', () => {
  beforeEach(() => __resetDataChangesForTests());

  it('normalizes private and shared tags to scopes and isolates private revisions', () => {
    expect(dataChangeScope('user:alex:accounts')).toBe('user:alex');
    expect(dataChangeScope('split-group:home:expenses:2026-11')).toBe('split-group:home');
    expect(dataChangeScope('mortgage:loan:summary')).toBe('mortgage:loan');
    expect(dataChangeScope('anything:alex')).toBeNull();

    const alexScopes = new Set(['user:alex', 'split-group:home']);
    const samScopes = new Set(['user:sam', 'split-group:home']);
    const alexBefore = readDataChangeState(alexScopes).revision;
    const samBefore = readDataChangeState(samScopes).revision;
    publishDataChanges(['user:alex:accounts']);
    const alexAfter = readDataChangeState(alexScopes).revision;
    const samAfterPrivateChange = readDataChangeState(samScopes).revision;
    expect(alexAfter).not.toBe(alexBefore);
    expect(samAfterPrivateChange).toBe(samBefore);

    publishDataChanges(['split-group:home:summary']);
    expect(readDataChangeState(alexScopes).revision).not.toBe(alexAfter);
    expect(readDataChangeState(samScopes).revision).not.toBe(samAfterPrivateChange);
  });

  it('returns only relevant pending tags and acknowledges only the captured revision', () => {
    const scopes = new Set(['user:alex', 'split-group:home']);
    publishDataChanges(['user:alex:accounts', 'user:sam:accounts', 'split-group:home:summary']);
    const snapshot = readDataChangeState(scopes);
    expect([...snapshot.pending.keys()].sort()).toEqual([
      'split-group:home:summary',
      'user:alex:accounts',
    ]);

    publishDataChanges(['user:alex:accounts']);
    acknowledgeDataChanges(snapshot.pending);
    expect([...readDataChangeState(scopes).pending.keys()]).toEqual(['user:alex:accounts']);

    const latest = readDataChangeState(scopes);
    acknowledgeDataChanges(latest.pending);
    expect(readDataChangeState(scopes).pending.size).toBe(0);
  });

  it('coalesces notifications and synchronization itself never republishes', async () => {
    const listener = vi.fn();
    const { subscribeServerDataChanges } = await import('./data-changes');
    const unsubscribe = subscribeServerDataChanges(listener);
    publishDataChanges(['user:alex:accounts']);
    publishDataChanges(['user:alex:accounts']);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);

    const pending = readDataChangeState(new Set(['user:alex'])).pending;
    acknowledgeDataChanges(pending);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
