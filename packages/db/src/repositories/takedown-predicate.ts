// The takedown predicate (task 12.2i, cycle fix for a 12.2h review LOW): `qualified` and
// `notTakenDown` used to live in `takedowns.ts`, but `chunks.ts` calls `notTakenDown` eagerly at
// module-eval time (inside its top-level `documentColumns`), and `takedowns.ts` imports
// `bumpRevision` from `./chunks.js` *before* its own `qualified`/`notTakenDown` were defined.
// Importing `reports.ts` or `takedowns.ts` directly (not through the barrel) requested
// `takedowns.ts` first, which started executing `chunks.ts` before reaching its own `qualified`
// const — a TDZ `ReferenceError`. This module is a leaf: it imports only `drizzle-orm`,
// `drizzle-orm/pg-core` and the schema, never `chunks.ts`, `takedowns.ts` or `reports.ts`, so it
// can never be part of a cycle with them, regardless of import order. `chunks.ts` and
// `reports.ts` import `notTakenDown` from here directly; `takedowns.ts` re-exports it unchanged
// so no caller outside this file needs to change.
import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { takedowns } from '../schema/index.js';

const qualified = (c: PgColumn): SQL =>
  sql`${sql.identifier(getTableName(c.table))}.${sql.identifier(c.name)}`;

/**
 * The one takedown predicate: true when the document whose id is in `documentId` has no active
 * takedown. Every column is qualified by hand, so the outer column can never bind to a takedowns
 * column inside the subquery. It probes `takedowns_target_idx` (target equality).
 */
export function notTakenDown(documentId: PgColumn): SQL {
  return sql`not exists (select 1 from ${sql.identifier(getTableName(takedowns))} where ${qualified(
    takedowns.target,
  )} = 'document:' || ${qualified(documentId)} and ${qualified(takedowns.status)} = 'active')`;
}
