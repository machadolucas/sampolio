/**
 * Better Auth 1.7.5 tables for the SQLCipher database (`sampolio.db`).
 *
 * The column set is GIVEN by Better Auth: core email+password tables, the
 * `@better-auth/passkey` plugin's `passkey` table, the database rate-limit
 * store (`rateLimit`), and Sampolio's `user.additionalFields` (`role`,
 * `isActive`, `deletedAt`, `avatarVersion`, declared `input: false` in
 * `src/lib/auth/server.ts`). Two rules keep it compatible with the adapter:
 *
 *  1. **Export names and JS property names are load-bearing.** The drizzle
 *     adapter addresses tables as `schema[model]` and columns as
 *     `table[field]`, so `user`/`session`/`account`/`verification`/`passkey`/
 *     `rateLimit` and the camelCase keys must match Better Auth's model and
 *     field names. SQL names mirror them (Better Auth's own generator output).
 *  2. **Instants are `timestamp_ms` integers.** The adapter hands the driver
 *     `Date` objects; `rateLimit.lastRequest` is a plain epoch-ms number.
 *
 * `passkey.lastUsedAt` is Sampolio's own column (not in the plugin schema):
 * the adapter ignores it, and `src/lib/auth/server.ts` stamps it after a
 * successful passkey sign-in.
 *
 * On a Better Auth upgrade: diff against `npx @better-auth/cli generate`
 * output, then `pnpm db:generate` for an additive migration.
 */
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** `DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))` — epoch ms. */
const nowDefault = () => sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull().default(nowDefault()),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' })
    .notNull()
    .default(nowDefault())
    .$onUpdate(() => new Date()),
  // user.additionalFields (all input:false — never settable from a request body)
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  deletedAt: integer('deletedAt', { mode: 'timestamp_ms' }),
  avatarVersion: integer('avatarVersion'),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull().default(nowDefault()),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' })
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_userId_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull().default(nowDefault()),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('account_userId_idx').on(t.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull().default(nowDefault()),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowDefault())
      .$onUpdate(() => new Date()),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const passkey = sqliteTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('publicKey').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credentialID').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('deviceType').notNull(),
    backedUp: integer('backedUp', { mode: 'boolean' }).notNull(),
    transports: text('transports'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
    aaguid: text('aaguid'),
    // Sampolio-owned (see header).
    lastUsedAt: integer('lastUsedAt', { mode: 'timestamp_ms' }),
  },
  (t) => [index('passkey_userId_idx').on(t.userId), index('passkey_credentialID_idx').on(t.credentialID)],
);

/** Database-backed rate-limit store (`rateLimit.storage = 'database'`). */
export const rateLimit = sqliteTable('rateLimit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('lastRequest').notNull(),
});
