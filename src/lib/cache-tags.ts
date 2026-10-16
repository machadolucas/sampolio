import { revalidateTag, updateTag } from 'next/cache';

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
 *   work — both need Next's per-request work store (`revalidate()` throws
 *   "static generation store missing") — so the tags are skipped. Readers of
 *   background-mutated data use the bounded `synced` cacheLife instead.
 *
 * The warning is logged once per process and never includes tag names (they
 * embed user ids).
 */
export function invalidateTags(...tags: string[]): void {
  let skipped = 0;
  for (const tag of tags) {
    try {
      updateTag(tag);
      continue;
    } catch {
      // Not in a server action — try the route-handler-safe form below.
    }
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      skipped++;
    }
  }
  if (skipped > 0 && !warnedNoScope) {
    warnedNoScope = true;
    console.warn(
      '[cache-tags] no request scope; cache tags not invalidated (reads fall back to their cacheLife window)'
    );
  }
}

/** Test-only: re-arm the once-per-process warning. */
export function __resetInvalidateTagsWarningForTests(): void {
  warnedNoScope = false;
}
