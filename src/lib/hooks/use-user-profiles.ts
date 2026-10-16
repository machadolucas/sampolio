'use client';

import { useEffect, useState } from 'react';
import { getUserProfiles } from '@/lib/actions/user-profiles';
import { useDataRefresh } from '@/lib/hooks/use-data-refresh';
import type { UserProfile } from '@/types';

// Module-level cache of resolved profiles, shared across every mounted hook so
// the same user is never fetched twice app-wide.
const cache = new Map<string, UserProfile>();
// In-flight fetches keyed by the sorted missing-ids join, so concurrent hooks
// requesting the same missing set share one server round-trip.
const inflight = new Map<string, Promise<void>>();
// Mounted hooks, woken on invalidation so a cleared entry re-fetches in place.
const subscribers = new Set<() => void>();

/** Drop cached profiles (all, or a specific set) so mounted hooks re-fetch them
 * — call after a mutation that changes a name or avatar. */
export function invalidateUserProfiles(ids?: string[]): void {
  if (!ids) {
    cache.clear();
  } else {
    for (const id of ids) cache.delete(id);
  }
  for (const wake of subscribers) wake();
}

/** Fetch the given (currently-missing) ids, deduping identical concurrent
 * requests. Resolves to whether any requested id is now cached (used to decide
 * if a re-render is worthwhile — a fetch that yields nothing must NOT trigger
 * another render, or a permanently-unresolvable id would loop). */
async function fetchMissing(missing: string[]): Promise<boolean> {
  const key = [...missing].sort().join(',');
  let promise = inflight.get(key);
  if (!promise) {
    promise = (async () => {
      try {
        const res = await getUserProfiles(missing);
        if (res.success && res.data) {
          for (const profile of res.data) cache.set(profile.id, profile);
        }
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
  }
  await promise;
  return missing.some((id) => cache.has(id));
}

/** Re-read already-cached profiles in place (no cache clearing, so avatars
 * never flash back to initials) and wake every mounted hook if any changed —
 * picks up a co-member's new name/photo made in another tab or session. */
async function refreshProfiles(ids: string[]): Promise<void> {
  const key = `refresh:${ids.join(',')}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = doRefreshProfiles(ids).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function doRefreshProfiles(ids: string[]): Promise<void> {
  try {
    const res = await getUserProfiles(ids);
    if (!res.success || !res.data) return;
    let changed = false;
    for (const profile of res.data) {
      const prev = cache.get(profile.id);
      if (prev && prev.name === profile.name && prev.avatarUrl === profile.avatarUrl) continue;
      cache.set(profile.id, profile);
      changed = true;
    }
    if (changed) for (const wake of subscribers) wake();
  } catch (err) {
    console.error('[user-profiles] refresh failed:', err);
  }
}

/**
 * Resolve `{ name, avatarUrl }` for a set of user ids. Only cache misses hit the
 * server (deduped across concurrent callers). Returns a plain record keyed by
 * id for the requested ids; ids not yet resolved are simply absent until the
 * fetch lands. SSR-safe — all fetching happens in an effect.
 */
export function useUserProfiles(userIds: readonly string[]): Record<string, UserProfile> {
  // Stable dependency: the sorted, de-duplicated id list.
  const key = [...new Set(userIds)].sort().join(',');
  const [tick, setTick] = useState(0);

  // Re-run the fetch effect when something invalidates the cache.
  useEffect(() => {
    const wake = () => setTick((t) => t + 1);
    subscribers.add(wake);
    return () => {
      subscribers.delete(wake);
    };
  }, []);

  // Own edits invalidate explicitly; other tabs / returning to the app re-read.
  useDataRefresh((reason) => {
    if (reason === 'mutation' || !key) return;
    void refreshProfiles(key.split(','));
  });

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const missing = ids.filter((id) => !cache.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    fetchMissing(missing).then((changed) => {
      if (!cancelled && changed) setTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const result: Record<string, UserProfile> = {};
  for (const id of key ? key.split(',') : []) {
    const profile = cache.get(id);
    if (profile) result[id] = profile;
  }
  return result;
}
