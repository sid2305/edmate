import { migrateDatabase } from './migrate.js';

/** Removes any connection string from an error message, so a password can't reach the logs. */
function redact(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
}

/** `pnpm --filter @edmate/db db:migrate`. Returns the process exit code. */
export async function runMigrateCli(
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
): Promise<number> {
  const url = env.DATABASE_URL;
  if (!url) {
    log('db:migrate: DATABASE_URL is not set');
    return 1;
  }
  try {
    await migrateDatabase(url);
    log('db:migrate: migrations applied');
    return 0;
  } catch (err) {
    log(
      `db:migrate: migration failed: ${redact(err instanceof Error ? err.message : String(err))}`,
    );
    return 1;
  }
}
