// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ synchronize: vi.fn(), remote: vi.fn() }));
vi.mock('@/lib/actions/data-changes', () => ({ synchronizeDataChanges: mocks.synchronize }));
vi.mock('./use-data-refresh', () => ({ notifyRemoteDataChanged: mocks.remote }));
import { useLiveData } from './use-live-data';

class FakeSource extends EventTarget {
  static instances: FakeSource[] = [];
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { super(); FakeSource.instances.push(this); }
  close() { this.closed = true; }
  change(revision: string) {
    this.dispatchEvent(new MessageEvent('changed', { data: JSON.stringify({ revision }) }));
  }
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe('live data', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    FakeSource.instances = [];
    vi.stubGlobal('EventSource', FakeSource);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    mocks.synchronize.mockResolvedValue({ success: true, data: { revision: 'a' } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('flushes server cache before announcing changes, ignoring repeated revisions', async () => {
    const { unmount } = renderHook(() => useLiveData('alex'));
    const source = FakeSource.instances[0];
    expect(source.url).toBe('/api/data-events');
    source.change('a');
    await flush();
    expect(mocks.synchronize).toHaveBeenCalledTimes(1);
    expect(mocks.remote).toHaveBeenCalledTimes(1);
    source.change('a');
    await flush();
    expect(mocks.synchronize).toHaveBeenCalledTimes(1);
    unmount();
    expect(source.closed).toBe(true);
  });

  it('queues an event that arrives during synchronization', async () => {
    let resolve!: (value: unknown) => void;
    mocks.synchronize.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    renderHook(() => useLiveData('alex'));
    const source = FakeSource.instances[0];
    source.change('a');
    source.change('b');
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.synchronize).toHaveBeenCalledTimes(1);
    mocks.synchronize.mockResolvedValue({ success: true, data: { revision: 'b' } });
    resolve({ success: true, data: { revision: 'a' } });
    await flush();
    expect(mocks.synchronize).toHaveBeenCalledTimes(2);
    expect(mocks.remote).toHaveBeenCalledTimes(2);
  });

  it('closes while hidden, reconnects on return and discards an old response', async () => {
    let resolve!: (value: unknown) => void;
    mocks.synchronize.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    renderHook(() => useLiveData('alex'));
    FakeSource.instances[0].change('a');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(FakeSource.instances[0].closed).toBe(true);
    resolve({ success: true, data: { revision: 'a' } });
    await flush();
    expect(mocks.remote).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    FakeSource.instances[1].change('a');
    await flush();
    expect(mocks.remote).toHaveBeenCalledTimes(1);
  });

  it('stops retries when the session is rejected', async () => {
    vi.useFakeTimers();
    mocks.synchronize.mockResolvedValue({ success: false, error: 'Unauthorized' });
    renderHook(() => useLiveData('alex'));
    FakeSource.instances[0].onerror?.();
    await flush();
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSource.instances).toHaveLength(1);
    expect(mocks.remote).not.toHaveBeenCalled();
  });
});
