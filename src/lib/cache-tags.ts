import { revalidateTag, updateTag as nextUpdateTag } from 'next/cache';
import { publishDataChanges } from './data-changes';

/** Action-only invalidation plus cross-user/window publication after a write. */
export function updateTag(tag: string): void {
  nextUpdateTag(tag);
  publishDataChanges([tag]);
}

let warnedNoScope = false;

/**
 * Expire cache tags from any server context, never throwing.
 *
 * - Server action: `updateTag` (read-your-own-writes, immediate expiry).
 * - Route handler (e.g. the bank OAuth callback): `updateTag` throws there
 *   (`revalidate.js`: "can only be called from within a Server Action"), so
 *   fall back to `revalidateTag(tag, { expire: 0 })` — the documented
 *   immediate-expiry form, legal in Route Handlers (`revalidateTag.md`).
 * - Outside any request scope (the background bank scheduler): neither form can
 *   work — both need Next's per-request work store. The change journal retains
 *   the tags; synchronizeDataChanges expires them before notified views read.
 *   The bounded `synced` cacheLife remains a fallback when live updates fail.
 *
 * The warning is logged once per process and never includes tag names (they
 * embed user ids).
 */
export function invalidateTags(...tags: string[]): void {
  const skipped: string[] = [];
  for (const tag of tags) {
    try {
      nextUpdateTag(tag);
      continue;
    } catch {
      // Not in a server action — try the route-handler-safe form below.
    }
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      skipped.push(tag);
    }
  }
  publishDataChanges(tags);
  if (skipped.length > 0 && !warnedNoScope) {
    warnedNoScope = true;
    console.warn(
      '[cache-tags] no request scope; cache invalidation queued for the next authenticated synchronization'
    );
  }
}

/** Test-only: re-arm the once-per-process warning. */
export function __resetInvalidateTagsWarningForTests(): void {
  warnedNoScope = false;
}
