/**
 * Per-split-group in-process mutex (server-only plain module — NOT 'use
 * server'). Serializes read-modify-write of a group's doc, chunks and summary
 * on this single node, so two devices adding/importing at once can't clobber
 * each other. Shared by the split-group actions and account deletion, which
 * both remove members. Non-reentrant: never call it from inside `fn` for the
 * same group. The chain map lives on globalThis so every module instance
 * (e.g. separate server-action bundles) shares one lock per group.
 */

const LOCKS_KEY = Symbol.for('sampolio.splitGroupLocks');
type LockMap = Map<string, Promise<unknown>>;

function chains(): LockMap {
  const g = globalThis as typeof globalThis & { [LOCKS_KEY]?: LockMap };
  g[LOCKS_KEY] ??= new Map();
  return g[LOCKS_KEY];
}

export function withGroupLock<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  const map = chains();
  const prev = map.get(groupId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  map.set(
    groupId,
    run.catch(() => {}),
  );
  return run;
}
