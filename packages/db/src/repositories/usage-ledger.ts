// usage_ledger (task 2.4): one row per provider attempt, scoped by student x teacher like every
// other repository. An attempt whose usage is unknown, or whose model has no price, is stored with
// a status, a reason and NULL figures: never as a free call.
//
// The row holds ids, the model id, the tier, counts, a cost and a fixed reason code. No method
// takes or stores request text (system prompt, messages) or anything else a student wrote.
import { randomUUID } from 'node:crypto';
import { EntitlementSchema, UsageSchema, type Entitlement, type Usage } from '@edmate/contracts';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { packages, usageLedger } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { checked, iso } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';

export type UsageSource = Entitlement['source'];
export type UsageStatus = 'recorded' | 'unknown' | 'unpriced';
/** Same codes as @edmate/gateway's UnmeteredReason. */
export type UnmeteredReason = 'no_usage_reported' | `unpriced_model:${string}`;

/** A priced call (its Usage has the real cost). */
export interface UsageEntry {
  turnId: string;
  source: UsageSource;
  usage: Usage;
}

/** A call whose usage is unknown, or known but unpriced. */
export interface UnmeteredEntry {
  turnId: string;
  source: UsageSource;
  tier: Usage['tier'];
  reason: UnmeteredReason;
  /** Required when unpriced (the reason names it); the attempted model, if known, when unknown. */
  model?: string;
  /** Required when unpriced; absent when unknown. */
  tokens?: { inputTokens: number; outputTokens: number };
}

/** A stored row. Figures are null when the call did not report them (or has no price). */
export interface UsageRow {
  id: string;
  teacherId: string;
  packageId: string;
  studentId: string;
  turnId: string;
  source: UsageSource;
  status: UsageStatus;
  reason: string | null;
  model: string | null;
  tier: Usage['tier'];
  inputTokens: number | null;
  outputTokens: number | null;
  costMicroUsd: number | null;
  createdAt: string;
}

/**
 * Sums over a scope's rows. `costMicroUsd` sums priced rows only; `unknown` and `unpriced` count
 * calls whose cost is missing from that sum, so a caller can tell "cost 0" from "cost not known".
 */
export interface UsageTotals {
  teacherId: string;
  studentId: string;
  calls: number;
  recorded: number;
  unknown: number;
  unpriced: number;
  costMicroUsd: number;
  /** Over rows that reported tokens (recorded and unpriced). */
  inputTokens: number;
  outputTokens: number;
}

const Model = UsageSchema.shape.model.min(1).max(200);
const Source = EntitlementSchema.shape.source;
const Tier = UsageSchema.shape.tier;
const Count = UsageSchema.shape.inputTokens;

const Entry = z.strictObject({
  turnId: IdSchema,
  source: Source,
  usage: z.strictObject({ ...UsageSchema.shape, model: Model }),
});

const Unknown = z.strictObject({
  turnId: IdSchema,
  source: Source,
  tier: Tier,
  reason: z.literal('no_usage_reported'),
  /** The model the attempt was sent to, when the caller knows it. */
  model: Model.optional(),
});
const Unpriced = z
  .strictObject({
    turnId: IdSchema,
    source: Source,
    tier: Tier,
    reason: z.templateLiteral(['unpriced_model:', z.string()]),
    model: Model,
    tokens: z.strictObject({ inputTokens: Count, outputTokens: Count }),
  })
  .refine((u) => u.reason === `unpriced_model:${u.model}`);
const Unmetered = z.union([Unknown, Unpriced]);

const Row = z
  .strictObject({
    id: IdSchema,
    teacherId: IdSchema,
    packageId: IdSchema,
    studentId: IdSchema,
    turnId: IdSchema,
    source: Source,
    status: z.enum(['recorded', 'unknown', 'unpriced']),
    reason: z.string().nullable(),
    model: z.string().nullable(),
    tier: Tier,
    inputTokens: Count.nullable(),
    outputTokens: Count.nullable(),
    costMicroUsd: Count.nullable(),
    createdAt: z.date(),
  })
  // A row whose figures disagree with its status is never returned as either.
  .refine((r) =>
    r.status === 'unknown'
      ? r.inputTokens === null && r.outputTokens === null && r.costMicroUsd === null
      : r.status === 'unpriced'
        ? r.costMicroUsd === null && r.inputTokens !== null && r.outputTokens !== null
        : r.reason === null,
  );

function toUsageRow(raw: unknown, method: string): UsageRow {
  const r = checked(Row, raw, method);
  return { ...r, createdAt: iso(r.createdAt) };
}

const TotalsRow = z.strictObject({
  calls: Count,
  recorded: Count,
  unknown: Count,
  unpriced: Count,
  costMicroUsd: Count,
  inputTokens: Count,
  outputTokens: Count,
});

/** A bigint aggregate as text, parsed back to an exact number (or `integrity` past 2^53). */
const asText = (expr: SQL) => sql<string>`(${expr})::text`;
function count(filter?: SQL): SQL<string> {
  return asText(filter ? sql`count(*) filter (where ${filter})` : sql`count(*)`);
}
function sum(expr: SQL): SQL<string> {
  return asText(sql`coalesce(sum(${expr}), 0)`);
}
function exact(value: string, method: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RepositoryError('integrity', method);
  return n;
}

/** The columns every write sets, ownership taken from the package row the scope owns. */
function ownedValues(sc: StudentScope, turnId: string, source: UsageSource) {
  return [
    [usageLedger.id, sql`${randomUUID()}::text`],
    [usageLedger.teacherId, sql`${packages.teacherId}`],
    [usageLedger.packageId, sql`${packages.id}`],
    [usageLedger.studentId, sql`${sc.studentId}::text`],
    [usageLedger.turnId, sql`${turnId}::text`],
    [usageLedger.source, sql`${source}::entitlement_source`],
  ] as const;
}

export function usageLedgerRepo(db: Db) {
  /** INSERT … SELECT FROM packages WHERE id = $pkg AND teacher_id = $scope: 0 rows → not_found. */
  async function insertOwned(
    method: string,
    sc: StudentScope,
    packageId: string,
    values: Parameters<typeof insertSelect>[1],
  ): Promise<void> {
    const result = await translateWrite(method, () =>
      db.execute(
        insertSelect(
          usageLedger,
          values,
          sql`from ${packages} where ${and(
            eq(packages.id, packageId),
            eq(packages.teacherId, sc.teacherId),
          )}`,
        ),
      ),
    );
    if (written(result) !== 1) throw new RepositoryError('not_found', method);
  }

  return {
    /** A priced call. The package must be the scope's teacher's, else `not_found`. */
    async record(scope: StudentScope, packageId: string, entry: UsageEntry): Promise<void> {
      const method = 'usageLedger.record';
      const sc = studentScope(scope, method);
      const pkg = parseArg(IdSchema, packageId, method);
      const e = parseArg(Entry, entry, method);
      await insertOwned(method, sc, pkg, [
        ...ownedValues(sc, e.turnId, e.source),
        [usageLedger.status, sql`'recorded'::usage_status`],
        [usageLedger.model, sql`${e.usage.model}::text`],
        [usageLedger.tier, sql`${e.usage.tier}::model_tier`],
        [usageLedger.inputTokens, sql`${e.usage.inputTokens}::integer`],
        [usageLedger.outputTokens, sql`${e.usage.outputTokens}::integer`],
        [usageLedger.costMicroUsd, sql`${e.usage.costMicroUsd}::bigint`],
      ]);
    },

    /** A call with unknown usage, or with tokens but no price. Same ownership rule as record. */
    async recordUnmetered(
      scope: StudentScope,
      packageId: string,
      entry: UnmeteredEntry,
    ): Promise<void> {
      const method = 'usageLedger.recordUnmetered';
      const sc = studentScope(scope, method);
      const pkg = parseArg(IdSchema, packageId, method);
      const e = parseArg(Unmetered, entry, method);
      const unpriced = 'tokens' in e;
      await insertOwned(method, sc, pkg, [
        ...ownedValues(sc, e.turnId, e.source),
        [
          usageLedger.status,
          unpriced ? sql`'unpriced'::usage_status` : sql`'unknown'::usage_status`,
        ],
        [usageLedger.reason, sql`${e.reason}::text`],
        // Unknown figures are NULL, never 0 (cost is always NULL here).
        [usageLedger.model, sql`${e.model ?? null}::text`],
        [usageLedger.tier, sql`${e.tier}::model_tier`],
        [usageLedger.inputTokens, sql`${unpriced ? e.tokens.inputTokens : null}::integer`],
        [usageLedger.outputTokens, sql`${unpriced ? e.tokens.outputTokens : null}::integer`],
      ]);
    },

    /** The scope's rows for one turn, oldest first: cost per turn. Another scope's turn is []. */
    async listForTurn(scope: StudentScope, turnId: string): Promise<UsageRow[]> {
      const method = 'usageLedger.listForTurn';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, turnId, method);
      const rows = await db
        .select({
          id: usageLedger.id,
          teacherId: usageLedger.teacherId,
          packageId: usageLedger.packageId,
          studentId: usageLedger.studentId,
          turnId: usageLedger.turnId,
          source: usageLedger.source,
          status: usageLedger.status,
          reason: usageLedger.reason,
          model: usageLedger.model,
          tier: usageLedger.tier,
          inputTokens: usageLedger.inputTokens,
          outputTokens: usageLedger.outputTokens,
          costMicroUsd: usageLedger.costMicroUsd,
          createdAt: usageLedger.createdAt,
        })
        .from(usageLedger)
        .where(
          and(
            eq(usageLedger.teacherId, sc.teacherId),
            eq(usageLedger.studentId, sc.studentId),
            eq(usageLedger.turnId, id),
          ),
        )
        .orderBy(asc(usageLedger.createdAt), asc(usageLedger.id));
      return rows.map((r) => toUsageRow(r, method));
    },

    /** Totals over all of the scope's rows: cost per student with this teacher. */
    async sumForStudent(scope: StudentScope): Promise<UsageTotals> {
      const method = 'usageLedger.sumForStudent';
      const sc = studentScope(scope, method);
      const recorded = sql`${usageLedger.status} = 'recorded'`;
      const unknown = sql`${usageLedger.status} = 'unknown'`;
      const unpriced = sql`${usageLedger.status} = 'unpriced'`;
      // sum() skips NULL, so unknown figures are left out, and counted in `unknown` / `unpriced`.
      const [row] = await db
        .select({
          calls: count(),
          recorded: count(recorded),
          unknown: count(unknown),
          unpriced: count(unpriced),
          costMicroUsd: sum(sql`${usageLedger.costMicroUsd}`),
          inputTokens: sum(sql`${usageLedger.inputTokens}::bigint`),
          outputTokens: sum(sql`${usageLedger.outputTokens}::bigint`),
        })
        .from(usageLedger)
        .where(
          and(eq(usageLedger.teacherId, sc.teacherId), eq(usageLedger.studentId, sc.studentId)),
        );
      const parsed = Object.fromEntries(
        Object.entries(row ?? {}).map(([k, v]) => [k, exact(String(v), method)]),
      );
      return { ...sc, ...checked(TotalsRow, parsed, method) };
    },
  };
}
