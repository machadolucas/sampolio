'use client';

import { useEffect, useRef } from 'react';

/**
 * App-wide "data changed" bus — the single client-side freshness mechanism.
 *
 * Pages load data with server actions into `useState`, so a mutation's
 * `updateTag` never reaches what is on screen by itself. Instead:
 *
 * - every successful client-side mutation calls `notifyDataChanged()` (shared
 *   mutating components do it themselves; `AppContext.refreshData` forwards
 *   here), and
 * - every mounted data view subscribes with `useDataRefresh(refetch)`.
 *
 * A notification refetches every mounted subscriber (bursts coalesce into one
 * round), is relayed to other tabs / PWA windows over a `BroadcastChannel`, and
 * returning to the app (tab visible / window focus, throttled) triggers the same
 * refetch so background bank syncs and other members' edits appear without a
 * reload. Hidden routes kept alive by Next's Activity have their effects torn
 * down while hidden; a change announced meanwhile is replayed when they show
 * again (each subscriber remembers the last change version it saw).
 */

export type DataRefreshReason = 'mutation' | 'remote' | 'focus';
type Listener = (reason: DataRefreshReason) => void;

const CHANNEL_NAME = 'sampolio-data';
/** Minimum gap between two focus/visibility-triggered refetch rounds. */
export const FOCUS_REFRESH_THROTTLE_MS = 15_000;

const listeners = new Set<Listener>();
/** Bumped on every concrete change (not on focus) — lets a re-subscribing view
 * tell whether it missed one while unmounted/hidden. */
let changeVersion = 0;
let channel: BroadcastChannel | null | undefined;
let pendingReason: DataRefreshReason | null = null;
let lastFocusRefreshAt = 0;
let windowListenersAttached = false;

function emit(reason: DataRefreshReason): void {
  if (reason !== 'focus') changeVersion++;
  // A concrete change outranks a focus refresh when both land in one burst.
  if (pendingReason) {
    if (pendingReason === 'focus') pendingReason = reason;
    return;
  }
  pendingReason = reason;
  queueMicrotask(() => {
    const r = pendingReason ?? reason;
    pendingReason = null;
    for (const listener of [...listeners]) {
      try {
        listener(r);
      } catch (err) {
        console.error('[data-refresh] listener failed:', err);
      }
    }
  });
}

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    channel?.addEventListener('message', () => emit('remote'));
  } catch {
    channel = null;
  }
  return channel;
}

function onReturn(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (now - lastFocusRefreshAt < FOCUS_REFRESH_THROTTLE_MS) return;
  lastFocusRefreshAt = now;
  emit('focus');
}

function attachWindowListeners(): void {
  if (windowListenersAttached || typeof window === 'undefined') return;
  windowListenersAttached = true;
  // Mounting already fetched fresh data; don't refetch on the very next focus.
  lastFocusRefreshAt = Date.now();
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);
}

function detachWindowListeners(): void {
  if (!windowListenersAttached || typeof window === 'undefined') return;
  windowListenersAttached = false;
  window.removeEventListener('focus', onReturn);
  document.removeEventListener('visibilitychange', onReturn);
}

/** Subscribe outside React. Returns the unsubscribe function. */
export function subscribeDataChanges(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  attachWindowListeners();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detachWindowListeners();
  };
}

/** Announce that server data changed: refetches every mounted view in this tab
 * and in the user's other open tabs. Call after every successful mutation. */
export function notifyDataChanged(): void {
  emit('mutation');
  try {
    getChannel()?.postMessage({ type: 'changed', at: Date.now() });
  } catch {
    /* another tab simply won't hear about it; focus refresh still covers it */
  }
}

/**
 * Refetch whenever data changes anywhere in the app (this tab, another tab) and
 * when the user returns to the app. `refetch` may change identity freely — the
 * latest one is always called. Pass `{ focus: false }` for views too expensive
 * to refetch on every return.
 */
export function useDataRefresh(
  refetch: (reason: DataRefreshReason) => unknown,
  options?: { focus?: boolean },
): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  const focus = options?.focus ?? true;
  // Change version this view last saw; null until first subscribed (the mount
  // fetch is fresh by definition). Refs survive an Activity hide/show cycle.
  const seenVersionRef = useRef<number | null>(null);
  useEffect(() => {
    const run = (reason: DataRefreshReason) => {
      seenVersionRef.current = changeVersion;
      Promise.resolve(refetchRef.current(reason)).catch((err) =>
        console.error('[data-refresh] refetch failed:', err),
      );
    };
    if (seenVersionRef.current === null) seenVersionRef.current = changeVersion;
    else if (seenVersionRef.current < changeVersion) run('mutation');
    return subscribeDataChanges((reason) => {
      if (reason === 'focus' && !focus) return;
      run(reason);
    });
  }, [focus]);
}

/** Test-only: reset module state between cases. */
export function __resetDataRefreshForTests(): void {
  listeners.clear();
  detachWindowListeners();
  try {
    channel?.close();
  } catch {
    /* ignore */
  }
  channel = undefined;
  pendingReason = null;
  lastFocusRefreshAt = 0;
  changeVersion = 0;
}
