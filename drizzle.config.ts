import { defineConfig } from 'drizzle-kit';

// GENERATE ONLY (`pnpm db:generate`). The runtime migrator in
// src/lib/db/sqlite/migrate.ts applies drizzle/ on first connection.
// drizzle-kit cannot open the SQLCipher database, so there are deliberately
// no dbCredentials here — never run `drizzle-kit push`/`migrate`/`studio`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/sqlite/schema/index.ts',
  out: './drizzle',
});
