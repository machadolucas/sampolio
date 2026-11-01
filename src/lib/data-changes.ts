import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

/** Process-local journal. Shared by instrumentation, route and action bundles. */
interface Change { sequence: number; pending: boolean }
interface Journal {
  epoch: string;
  sequence: number;
  tags: Map<string, Change>;
  listeners: Set<() => void>;
  queued: boolean;
}
const globalState = globalThis as typeof globalThis & { __sampolioChanges?: Journal };
function journal(): Journal {
  return globalState.__sampolioChanges ??= {
    epoch: uuidv4(), sequence: 0, tags: new Map(), listeners: new Set(), queued: false,
  };
}

export function dataChangeScope(tag: string): string | null {
  if (['all-data', 'users', 'app-settings'].includes(tag)) return tag;
  return /^(user|split-group|mortgage):[A-Za-z0-9_-]+(?=:|$)/.exec(tag)?.[0] ?? null;
}

/** Call after a committed write; retain tags until request-scoped synchronization. */
export function publishDataChanges(tags: string[]): void {
  const state = journal();
  let changed = false;
  for (const tag of new Set(tags)) {
    if (!dataChangeScope(tag)) continue;
    state.tags.set(tag, {
      sequence: ++state.sequence,
      // Keep a background invalidation until a request explicitly flushes it.
      // Even request-scoped invalidation commits after the action returns.
      // A different browser can receive this event before that commit, so its
      // synchronization must expire these tags in its own request as well.
      pending: true,
    });
    changed = true;
  }
  // Bound memory even on a long-lived server. One global expiration safely
  // replaces all compacted pending tags; the new revision wakes every client.
  if (state.tags.size > 4096) {
    state.tags.clear();
    state.tags.set('all-data', { sequence: ++state.sequence, pending: true });
  }
  if (!changed || state.queued) return;
  state.queued = true;
  queueMicrotask(() => {
    state.queued = false;
    for (const listener of [...state.listeners]) {
      try { listener(); } catch { /* a disconnected stream cannot fail a write */ }
    }
  });
}

function relevant(tag: string, scopes: Set<string>): boolean {
  const scope = dataChangeScope(tag);
  return scope !== null && scopes.has(scope);
}

export function readDataChangeState(scopes: Set<string>): {
  revision: string; pending: Map<string, number>;
} {
  const state = journal();
  let sequence = 0;
  const pending = new Map<string, number>();
  for (const [tag, change] of state.tags) {
    if (!relevant(tag, scopes)) continue;
    sequence = Math.max(sequence, change.sequence);
    if (change.pending) pending.set(tag, change.sequence);
  }
  // Opaque to the browser: no user ids, tags or cross-user sequence numbers.
  const revision = createHash('sha256')
    .update(JSON.stringify([state.epoch, [...scopes].sort(), sequence])).digest('hex');
  return { revision, pending };
}

/** Synchronization never publishes: otherwise clients would refresh forever. */
export function acknowledgeDataChanges(pending: Map<string, number>): void {
  const state = journal();
  for (const [tag, sequence] of pending) {
    const change = state.tags.get(tag);
    if (change?.sequence === sequence) change.pending = false;
  }
}

export function subscribeServerDataChanges(listener: () => void): () => void {
  const state = journal();
  state.listeners.add(listener);
  return () => { state.listeners.delete(listener); };
}

export function __resetDataChangesForTests(): void { delete globalState.__sampolioChanges; }
