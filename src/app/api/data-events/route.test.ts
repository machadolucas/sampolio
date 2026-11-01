import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  scopes: new Set<string>(),
  revision: 'revision-1',
  listeners: new Set<() => void>(),
  unsubscribeCount: 0,
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db/data-changes', () => ({ getDataChangeScopes: vi.fn(() => state.scopes) }));
vi.mock('@/lib/data-changes', () => ({
  readDataChangeState: vi.fn(() => ({ revision: state.revision, pending: new Map() })),
  subscribeServerDataChanges: vi.fn((listener: () => void) => {
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
      state.unsubscribeCount += 1;
    };
  }),
}));

import { auth } from '@/lib/auth';
import { GET } from './route';

const emitChange = () => {
  state.revision = `revision-${Number(state.revision.split('-')[1]) + 1}`;
  for (const listener of [...state.listeners]) listener();
};

describe('data-events SSE route', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    state.scopes = new Set(['all-data', 'user:alex', 'split-group:shared-home']);
    state.revision = 'revision-1';
    state.listeners.clear();
    state.unsubscribeCount = 0;
    vi.mocked(auth).mockResolvedValue({ user: { id: 'alex' } } as never);
  });

  it('requires authentication and returns a private no-store event stream', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(new Request('http://localhost/api/data-events'))).status).toBe(401);

    vi.mocked(auth).mockResolvedValue({ user: { id: 'alex' } } as never);
    const abort = new AbortController();
    const response = await GET(new Request('http://localhost/api/data-events', { signal: abort.signal }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, no-transform');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/^event: changed\ndata: \{"revision":"revision-1"\}\n\n$/);
    abort.abort();
  });

  it('sends heartbeat comments and renews the authenticated stream after 55 seconds', async () => {
    vi.useFakeTimers();
    const response = await GET(new Request('http://localhost/api/data-events'));
    const reader = response.body!.getReader();
    await reader.read(); // initial revision

    for (let elapsed = 15_000; elapsed <= 45_000; elapsed += 15_000) {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(': keepalive\n\n');
    }

    await vi.advanceTimersByTimeAsync(10_000);
    expect((await reader.read()).done).toBe(true);
    expect(state.unsubscribeCount).toBe(1);
    vi.useRealTimers();
  });

  it('publishes opaque revision events and unsubscribes when the request is cancelled', async () => {
    const response = await GET(new Request('http://localhost/api/data-events'));
    const reader = response.body!.getReader();
    await reader.read();
    emitChange();
    const changed = new TextDecoder().decode((await reader.read()).value);
    expect(changed).toContain('event: changed');
    expect(changed).toContain('revision-2');

    await expect(reader.cancel()).resolves.toBeUndefined();
    expect(state.listeners.size).toBe(0);
    expect(state.unsubscribeCount).toBe(1);
    emitChange(); // a closed client is no longer subscribed
    expect(state.listeners.size).toBe(0);
  });

  it('closes and drops a stream when its shared-group membership is revoked', async () => {
    const response = await GET(new Request('http://localhost/api/data-events'));
    const reader = response.body!.getReader();
    await reader.read();
    state.scopes = new Set();
    emitChange();

    expect((await reader.read()).done).toBe(true);
    expect(state.unsubscribeCount).toBe(1);
    expect(state.listeners.size).toBe(0);
  });
});
