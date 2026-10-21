// A user's role, read under a share lock inside the caller's transaction (task 8.1). It lives
// outside `repositories/`, whose source never names the users table (test/scope.test.ts: no
// names, emails or phones): it selects the role column and nothing else, so a repository can
// check "is this user staff / a teacher right now" without ever reading personal data.
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { users } from './schema/index.js';

type Role = (typeof users.role.enumValues)[number];

/**
 * The role of user `id`, or null when there is no such user. `FOR SHARE` keeps the row's role
 * fixed until the caller's transaction ends, so a concurrent demotion can't slip between the
 * check and the write it guards (the identity.grantRole pattern).
 */
export async function lockRole(tx: Pick<Db, 'select'>, id: string): Promise<Role | null> {
  const [row] = await tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .for('share');
  return row?.role ?? null;
}
