import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only reads the schema and writes ./migrations. The app applies migrations
// with `pnpm --filter @edmate/db db:migrate` (src/migrate.ts), not with drizzle-kit.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
