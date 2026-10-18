import { parseArgs } from 'node:util';
import { createDb } from './client.js';
import { createIdentityStore, ROLES, type IdentityStore, type Role } from './identity/index.js';
import { migrateDatabase } from './migrate.js';
import { redact } from './redact.js';

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

/** Opens the identity store for the grant CLI (injected in tests). */
export type OpenIdentity = (url: string) => { identity: IdentityStore; close: () => Promise<void> };

const openIdentity: OpenIdentity = (url) => {
  const { db, close } = createDb({ DATABASE_URL: url });
  return { identity: createIdentityStore(db), close };
};

const USAGE =
  'usage: db:grant-role -- --email <email> --role <student|teacher|staff> ' +
  '--by <staff-user-id|operator> [--reason <text>]';

interface GrantArgs {
  email: string;
  role: Role;
  by: string;
  reason?: string;
}

/** The parsed arguments, or a one-line reason they are wrong. */
function parseGrantArgs(argv: string[]): GrantArgs | string {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      // pnpm forwards the `--` separator itself.
      args: argv[0] === '--' ? argv.slice(1) : argv,
      options: {
        email: { type: 'string' },
        role: { type: 'string' },
        by: { type: 'string' },
        reason: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return USAGE;
  }
  const { email, role, by, reason } = values;
  if (typeof email !== 'string' || typeof role !== 'string' || typeof by !== 'string') {
    return USAGE;
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    return `--role must be one of ${ROLES.join(', ')}`;
  }
  return {
    email,
    role: role as Role,
    by,
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}

/**
 * `pnpm --filter @edmate/db db:grant-role -- --email <e> --role <r> --by <id|operator>`: the
 * operator's way to set a user's role (the first staff account is bootstrapped with it). Writes a
 * `role.grant` audit row. Never prints the email or a connection string. Returns the exit code.
 */
export async function runGrantRoleCli(
  argv: string[],
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
  open: OpenIdentity = openIdentity,
): Promise<number> {
  const args = parseGrantArgs(argv);
  if (typeof args === 'string') {
    log(`db:grant-role: ${args}`);
    return 1;
  }
  const url = env.DATABASE_URL;
  if (!url) {
    log('db:grant-role: DATABASE_URL is not set');
    return 1;
  }
  let handle: ReturnType<OpenIdentity> | undefined;
  try {
    handle = open(url);
    const user = await handle.identity.getUserByEmail(args.email);
    if (!user) {
      log('db:grant-role: no user has that email (they must sign in once first)');
      return 1;
    }
    const updated = await handle.identity.grantRole({
      userId: user.id,
      role: args.role,
      by: args.by,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    });
    log(`db:grant-role: user ${updated.id} is now ${updated.role}`);
    return 0;
  } catch (err) {
    log(`db:grant-role: failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
