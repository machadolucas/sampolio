'use client';

import { useEffect } from 'react';
import { synchronizeDataChanges } from '@/lib/actions/data-changes';
import { notifyRemoteDataChanged } from './use-data-refresh';

/** One notification stream per visible app window; never polls domain data. */
export function useLiveData(userId: string | undefined): void {
  useEffect(() => {
    if (!userId || typeof EventSource === 'undefined') return;
    let disposed = false;
    let unauthorized = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;
    let revision: string | undefined;
    let generation = 0;
    let syncing = false;
    let queued = false;
    let forceRefresh = false;
    const visible = () => document.visibilityState !== 'hidden';
    const disconnect = () => {
      generation++;
      clearTimeout(retry);
      source?.close();
      source = null;
    };
    const scheduleRetry = () => {
      if (disposed || unauthorized || !visible()) return;
      clearTimeout(retry);
      retry = setTimeout(connect, retryDelay);
      retryDelay = Math.min(30_000, retryDelay * 2);
    };
    const synchronize = async () => {
      if (syncing) { queued = true; return; }
      syncing = true;
      try {
        do {
          queued = false;
          const current = generation;
          const force = forceRefresh;
          forceRefresh = false;
          try {
            const result = await synchronizeDataChanges();
            if (disposed || !visible() || current !== generation) continue;
            if (!result.success || !result.data) {
              if (result.error === 'Unauthorized') unauthorized = true;
              disconnect();
              scheduleRetry();
              return;
            }
            if (force || result.data.revision !== revision) {
              revision = result.data.revision;
              notifyRemoteDataChanged();
            }
          } catch {
            if (!disposed && current === generation) { disconnect(); scheduleRetry(); }
          }
        } while (queued && !disposed && visible());
      } finally { syncing = false; }
    };
    function connect() {
      if (disposed || unauthorized || !visible() || source) return;
      const current = ++generation;
      // Initial/reconnect refresh also repairs a missed event or server restart.
      forceRefresh = true;
      try {
        source = new EventSource('/api/data-events');
        source.addEventListener('changed', (event) => {
          if (current !== generation || disposed) return;
          try {
            const payload: unknown = JSON.parse((event as MessageEvent).data);
            if (!payload || typeof payload !== 'object' || !('revision' in payload) ||
                typeof payload.revision !== 'string') return;
            retryDelay = 1_000;
            if (payload.revision !== revision || forceRefresh) void synchronize();
          } catch { /* ignore malformed notification; reconnect/focus recovers */ }
        });
        source.onerror = () => {
          if (current !== generation || disposed) return;
          disconnect();
          // Probe through the authenticated action so a 401 stops reconnection.
          forceRefresh = true;
          void synchronize();
          scheduleRetry();
        };
      } catch { disconnect(); scheduleRetry(); }
    }
    const visibilityChanged = () => {
      if (visible()) connect();
      else disconnect();
    };
    const online = () => { disconnect(); connect(); };
    connect();
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('online', online);
    return () => {
      disposed = true;
      disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('online', online);
    };
  }, [userId]);
}
