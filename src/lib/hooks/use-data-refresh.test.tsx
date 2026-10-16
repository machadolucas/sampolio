// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  FOCUS_REFRESH_THROTTLE_MS,
  __resetDataRefreshForTests,
  notifyDataChanged,
  subscribeDataChanges,
  useDataRefresh,
} from './use-data-refresh';

function Subscriber({ onRefresh, focus }: { onRefresh: (reason: string) => void; focus?: boolean }) {
  useDataRefresh(onRefresh, focus === undefined ? undefined : { focus });
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('use-data-refresh', () => {
  beforeEach(() => __resetDataRefreshForTests());
  afterEach(() => {
    __resetDataRefreshForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('notifies every mounted subscriber once per burst', async () => {
    const a = vi.fn();
    const b = vi.fn();
    render(<><Subscriber onRefresh={a} /><Subscriber onRefresh={b} /></>);
    notifyDataChanged();
    notifyDataChanged();
    await flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith('mutation');
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unmount', async () => {
    const fn = vi.fn();
    const { unmount } = render(<Subscriber onRefresh={fn} />);
    unmount();
    notifyDataChanged();
    await flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('replays a change missed while hidden (Activity) when shown again', async () => {
    const { Activity } = await import('react');
    const fn = vi.fn();
    const view = (mode: 'visible' | 'hidden') => <Activity mode={mode}><Subscriber onRefresh={fn} /></Activity>;
    const { rerender } = render(view('visible'));
    await flush();
    expect(fn).not.toHaveBeenCalled(); // mounting alone never refetches
    rerender(view('hidden'));
    notifyDataChanged();
    await flush();
    expect(fn).not.toHaveBeenCalled();
    rerender(view('visible'));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('mutation');
    // Nothing new since: hiding and showing again doesn't refetch.
    rerender(view('hidden'));
    rerender(view('visible'));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('always calls the latest refetch closure', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Subscriber onRefresh={first} />);
    rerender(<Subscriber onRefresh={second} />);
    notifyDataChanged();
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('refetches on focus, throttled, and respects focus: false', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const onFocus = vi.fn();
    const noFocus = vi.fn();
    render(<><Subscriber onRefresh={onFocus} /><Subscriber onRefresh={noFocus} focus={false} /></>);
    // Right after mounting the data is fresh: the first focus is throttled.
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(onFocus).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + FOCUS_REFRESH_THROTTLE_MS + 1);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith('focus');
    expect(noFocus).not.toHaveBeenCalled();
  });

  it('relays to other tabs and refreshes on their messages', async () => {
    const instances: FakeChannel[] = [];
    class FakeChannel {
      listeners: ((e: MessageEvent) => void)[] = [];
      posted: unknown[] = [];
      constructor(public name: string) { instances.push(this); }
      addEventListener(_: string, l: (e: MessageEvent) => void) { this.listeners.push(l); }
      postMessage(m: unknown) { this.posted.push(m); }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const fn = vi.fn();
    render(<Subscriber onRefresh={fn} />);
    notifyDataChanged();
    await flush();
    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe('sampolio-data');
    expect(instances[0].posted).toHaveLength(1);

    fn.mockClear();
    instances[0].listeners.forEach((l) => l(new MessageEvent('message', { data: { type: 'changed' } })));
    await flush();
    expect(fn).toHaveBeenCalledWith('remote');
  });

  it('degrades gracefully when BroadcastChannel throws', async () => {
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('blocked'); } });
    const fn = vi.fn();
    const unsubscribe = subscribeDataChanges(fn);
    expect(() => notifyDataChanged()).not.toThrow();
    await flush();
    expect(fn).toHaveBeenCalledWith('mutation');
    unsubscribe();
  });

  it('keeps notifying other listeners when one throws or rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    render(<><Subscriber onRefresh={() => Promise.reject(new Error('x'))} /><Subscriber onRefresh={ok} /></>);
    const unsubscribe = subscribeDataChanges(() => { throw new Error('boom'); });
    notifyDataChanged();
    await flush();
    await flush();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    unsubscribe();
    error.mockRestore();
  });
});
