// Shared between `packages.ts` and `package-versions.ts` (task 8.6f, follow-up to 8.6b/8.6c):
// the module-ownership check and the package row lock both writers take, so they lock the same
// row the same way (docs/lessons.md: "Two writers that lock the same rows in different orders
// deadlock").
//
// Shared lock order: every writer calls `lockPackageRow` (the package row, `for('update')`)
// before `checkModules` (the module rows, `for('key share')`) -- package.ts `saveVersion` and
// package-versions.ts `create` both follow this order so a concurrent pair on the same package
// never deadlocks.
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { modules, packages } from '../schema/index.js';
import { RepositoryError } from './errors.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Every module the draft unlocks is the teacher's, key-share locked so none is deleted before the
 * insert commits; otherwise `scope` (a package can never unlock another teacher's material).
 */
export async function checkModules(
  tx: Tx,
  teacherId: string,
  moduleIds: readonly string[],
  method: string,
): Promise<void> {
  const unique = [...new Set(moduleIds)];
  if (unique.length === 0) return;
  const mine = await tx
    .select({ id: modules.id })
    .from(modules)
    .where(and(eq(modules.teacherId, teacherId), inArray(modules.id, unique)))
    .for('key share');
  if (mine.length !== unique.length) throw new RepositoryError('scope', method);
}

/**
 * Locks the named package row (`for('update')`) of the scope's teacher and agent, so concurrent
 * version writes to the same package serialise; `not_found` if it is missing or another
 * teacher's/agent's.
 */
export async function lockPackageRow(
  tx: Tx,
  teacherId: string,
  ids: { packageId: string; agentId: string },
  method: string,
): Promise<void> {
  const [pkg] = await tx
    .select({ id: packages.id })
    .from(packages)
    .where(
      and(
        eq(packages.id, ids.packageId),
        eq(packages.teacherId, teacherId),
        eq(packages.agentId, ids.agentId),
      ),
    )
    .for('update');
  if (!pkg) throw new RepositoryError('not_found', method);
}
