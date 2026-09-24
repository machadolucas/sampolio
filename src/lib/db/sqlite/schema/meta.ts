import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Small key/value table for one-shot bookkeeping (e.g. the legacy `.enc` user
 * import marker, `legacy-users-imported`). Not a settings store.
 */
export const meta = sqliteTable('_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
