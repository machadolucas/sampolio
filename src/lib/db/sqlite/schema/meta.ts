import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Small key/value table for one-shot bookkeeping. Databases created before
 * 4.1.2 hold the 4.0 user-import marker `legacy-users-imported`, which nothing
 * reads any more. Not a settings store.
 */
export const meta = sqliteTable('_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
