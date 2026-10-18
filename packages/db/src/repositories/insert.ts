import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * `INSERT INTO <table> (<columns>) SELECT <values> <from>`: an ownership-checked insert in one
 * statement. `from` is the owner row's `FROM … WHERE` (scope included), so a target outside the
 * scope matches no row and nothing is inserted (the caller turns rowCount 0 into `not_found`).
 *
 * Each value is a parameter with an explicit cast written in the template (for example
 * sql`${text}::text`), or a column of the owner row. Columns left out take their defaults.
 */
export function insertSelect(
  table: PgTable,
  values: readonly (readonly [PgColumn, SQL])[],
  from: SQL,
): SQL {
  const columns = sql.join(
    values.map(([column]) => sql.identifier(column.name)),
    sql`, `,
  );
  const selected = sql.join(
    values.map(([, value]) => value),
    sql`, `,
  );
  return sql`insert into ${table} (${columns}) select ${selected} ${from}`;
}

/** Rows written by `db.execute`: node-postgres reports null for statements without a count. */
export function written(result: { rowCount: number | null }): number {
  return result.rowCount ?? 0;
}
