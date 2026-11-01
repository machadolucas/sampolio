import { assertSafeId } from './encryption';
import { getSqlite } from './sqlite/client';
import { listRows } from './sqlite/docs';
import { mortgageMemberIndex, splitGroupMemberIndex } from './sqlite/schema';

/** Uncached membership indexes: a removed member must stop hearing changes. */
export function getDataChangeScopes(userId: string): Set<string> {
  assertSafeId(userId, 'userId');
  const user = getSqlite().prepare('SELECT "isActive", "deletedAt" FROM "user" WHERE "id" = ?').get(userId) as
    { isActive: number; deletedAt: number | null } | undefined;
  if (!user?.isActive || user.deletedAt) return new Set();
  return new Set([
    'all-data', 'users', 'app-settings', `user:${userId}`,
    ...listRows(splitGroupMemberIndex, { userId }).map(({ keys }) => `split-group:${keys.groupId}`),
    ...listRows(mortgageMemberIndex, { userId }).map(({ keys }) => `mortgage:${keys.mortgageId}`),
  ]);
}
