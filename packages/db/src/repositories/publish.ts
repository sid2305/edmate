// Task 8.7 Phase A: the publish repository. A publish is a quality-gate run stored in `eval_runs`
// (`suite = 'gate'`): `startRun` cuts a fresh agent version from the pins and snapshots the newest
// version of every package into the run's basis; the worker marks it running, records one
// `eval_results` row per case and either finishes it (`failed` / `error`, nothing goes live) or
// calls `goLive`, which re-checks the teacher is verified (profile row locked FOR SHARE) and makes
// the agent version and every package version live in one transaction, with audit rows.
//
// The teacher id comes only from the scope. Every method is teacher-scoped except
// `publicScorecard`, a public read like `agents.owner`: it returns nothing unless the agent is
// live and its teacher verified.
//
// `@edmate/db` must not import `@edmate/evals`, so the gate's group names, change kinds,
// deadlines and the scorecard shape are strict local mirrors of `gateScope.ts`, `qualityGate.ts`
// and `scorecard.ts` (task 7.4 / 7.8). A drift fails closed: the worker's write is `invalid`.
import { randomUUID } from 'node:crypto';
import { AgentConfigSchema, type ModelPolicy, ModelPolicySchema } from '@edmate/contracts';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  agents,
  agentVersions,
  courses,
  evalResults,
  evalRuns,
  packages,
  packageVersions,
  styleCards,
  teacherMaterialRevisions,
  teacherProfiles,
} from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, type RepositoryErrorKind, translateWrite } from './errors.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** The `eval_runs.suite` of a publish-gate run. */
export const GATE_SUITE = 'gate';
export const GATE_RUN_STATUSES = ['queued', 'running', 'passed', 'failed', 'error'] as const;
export type GateRunStatus = (typeof GATE_RUN_STATUSES)[number];
/** Mirror of `@edmate/evals` CHANGE_KINDS, in the same order (the order `changes` is stored in). */
export const PUBLISH_CHANGE_KINDS = [
  'first_publish',
  'prompt_pack_bump',
  'material',
  'packages',
  'style_card',
] as const;
export type PublishChangeKind = (typeof PUBLISH_CHANGE_KINDS)[number];
/** Mirror of the keys of `@edmate/evals` GATE_THRESHOLDS. */
export const GATE_GROUP_NAMES = [
  'leak',
  'locked',
  'safety-distress',
  'safety',
  'accuracy',
  'persona',
  'pedagogy',
  'advice',
  'grounding',
] as const;
export type GateGroupName = (typeof GATE_GROUP_NAMES)[number];
/** Mirrors of `@edmate/evals` GATE_DEADLINE_MS and FULL_SCOPE_GATE_DEADLINE_MS. */
export const GATE_DEADLINE_MS = 15 * 60_000;
export const FULL_SCOPE_GATE_DEADLINE_MS = 2 * 60 * 60_000;
/** An open run with no progress for its deadline plus this long is stale (plan, decision 9). */
export const STALE_RUN_GRACE_MS = 15 * 60_000;
/** Most results one `recordResults` call takes. */
export const GATE_RESULTS_MAX = 1000;
/** Most rows `failedCases` returns. */
export const FAILED_CASES_MAX = 500;
/** Passed runs `publicScorecard` reads back for the carry-forward (newest first). */
const SCORECARD_RUNS_MAX = 50;
/** Rows per insert statement in `recordResults`. */
const INSERT_BATCH = 500;

/** Why `startRun` or `goLive` refused, for the studio's 409s (plan Phase D). */
export type PublishRefusal = 'no_packages' | 'suspended' | 'nothing_to_publish' | 'gate_running';

/**
 * A RepositoryError that also says which publish rule refused (no new contracts error codes:
 * `kind` and `code` are the usual ones). `gate_running` is `integrity`, the rest `invalid`. The
 * message stays `<method>: <kind>`: the reason is a fixed word, never an id.
 */
export class PublishRefusedError extends RepositoryError {
  constructor(
    kind: Extract<RepositoryErrorKind, 'invalid' | 'integrity'>,
    method: string,
    readonly reason: PublishRefusal,
  ) {
    super(kind, method);
  }
}

const ErrorCodeWord = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const Origin = z.enum(['platform', 'agent']);
const Group = z.enum(GATE_GROUP_NAMES);

const PinsSchema = z.strictObject({
  agentId: IdSchema,
  courseId: IdSchema,
  styleCardId: IdSchema,
  promptPackVersion: AgentConfigSchema.shape.promptPackVersion,
  modelPolicy: ModelPolicySchema,
  judgeModel: z.string().min(1).max(200),
});
/** What the studio pins for a publish (plan, decision 2). `judgeModel` is stored as `model`. */
export interface PublishPins {
  agentId: string;
  courseId: string;
  styleCardId: string;
  promptPackVersion: string;
  modelPolicy: ModelPolicy;
  judgeModel: string;
}

const BasisSchema = z.strictObject({
  agentVersion: z.int().min(1),
  courseId: IdSchema,
  styleCardId: IdSchema,
  promptPackVersion: z.string(),
  modelPolicy: ModelPolicySchema,
  materialRevision: z.int().min(0),
  /** package id -> the version this run publishes. */
  packageVersions: z.record(IdSchema, z.int().min(0)),
});
/** What a run publishes and what the next run's change kinds are compared with. */
export type PublishBasis = z.infer<typeof BasisSchema>;

const CaseDetailsSchema = z
  .strictObject({
    origin: Origin,
    group: Group,
    suite: z.string().min(1).max(100),
    failedChecks: z.array(z.string().min(1).max(200)).max(50),
    errorCode: ErrorCodeWord.optional(),
    /** The teacher's own eval-case question; agent-origin cases only. */
    question: z.string().min(1).max(2000).optional(),
  })
  .refine((d) => d.question === undefined || d.origin === 'agent');
export type GateCaseDetails = z.infer<typeof CaseDetailsSchema>;
export interface GateCaseResult {
  caseId: string;
  passed: boolean;
  details: GateCaseDetails;
}
const CaseId = z.string().min(1).max(200);
const RecordInput = z.strictObject({
  runId: IdSchema,
  results: z
    .array(z.strictObject({ caseId: CaseId, passed: z.boolean(), details: CaseDetailsSchema }))
    .max(GATE_RESULTS_MAX)
    .refine((rs) => new Set(rs.map((r) => r.caseId)).size === rs.length),
});

const GroupSummarySchema = z.strictObject({
  origin: Origin,
  group: Group,
  total: z.int().min(0),
  passed: z.int().min(0),
  minPercent: z.number().min(0).max(100),
  pass: z.boolean(),
  reason: z.enum(['empty_group', 'below_threshold']).optional(),
});
const SummarySchema = z.strictObject({
  groups: z.array(GroupSummarySchema).max(100),
  stats: z
    .record(z.string().min(1).max(64), z.union([z.number(), z.boolean()]))
    .refine((s) => Object.keys(s).length <= 50)
    .optional(),
  costMicroUsd: z.int().min(0).optional(),
  errorCode: ErrorCodeWord.optional(),
});
/** A run's summary: gate groups, stats, cost in micro-USD, and an error code for `error` runs. */
export type GateRunSummary = z.infer<typeof SummarySchema>;

const CATEGORY_KEYS = ['hints_before_answers', 'locked_content', 'accuracy'] as const;
const ScorecardCategorySchema = z.strictObject({
  key: z.enum(CATEGORY_KEYS),
  measured: z.boolean(),
  total: z.int().min(0),
  passed: z.int().min(0),
  percent: z.number().nullable(),
  pass: z.boolean(),
  byOrigin: z.array(
    z.strictObject({ origin: Origin, total: z.int().min(0), passed: z.int().min(0) }),
  ),
});
const ScorecardSchema = z.strictObject({
  pass: z.boolean(),
  changes: z.array(z.enum(PUBLISH_CHANGE_KINDS)),
  categories: z.array(ScorecardCategorySchema).max(CATEGORY_KEYS.length),
});
/** Strict mirror of `@edmate/evals` `Scorecard`. */
export type StoredScorecard = z.infer<typeof ScorecardSchema>;
export type StoredScorecardCategory = z.infer<typeof ScorecardCategorySchema>;

const PassRate = z.number().min(0).max(1);
const FinishInput = z.strictObject({
  runId: IdSchema,
  status: z.enum(['failed', 'error']),
  passRate: PassRate.optional(),
  summary: SummarySchema,
  scorecard: ScorecardSchema.optional(),
});
const GoLiveInput = z.strictObject({
  runId: IdSchema,
  passRate: PassRate,
  summary: SummarySchema,
  scorecard: ScorecardSchema,
});
export type FinishRunInput = z.infer<typeof FinishInput>;
export type GoLiveInput = z.infer<typeof GoLiveInput>;

const PublicAgentSchema = z.strictObject({ agentId: IdSchema });

/** A publish-gate run as the teacher (and the worker) sees it. */
export interface GateRunRow {
  id: string;
  agentId: string;
  agentVersion: number;
  status: GateRunStatus;
  changes: PublishChangeKind[];
  judgeModel: string;
  basis: PublishBasis;
  passRate: number | null;
  summary: GateRunSummary | null;
  scorecard: StoredScorecard | null;
  createdAt: string;
  finishedAt: string | null;
  publishedAt: string | null;
}

export interface FailedCase {
  caseId: string;
  details: GateCaseDetails;
}

/** A public scorecard category: the newest passed run that measured it, and when it went live. */
export type PublicScorecardCategory = StoredScorecardCategory & { measuredAt: string | null };
export interface PublicScorecard {
  /** When the newest passed run went live. */
  publishedAt: string;
  categories: PublicScorecardCategory[];
}

/** Per-teacher publish lock namespace (two-key advisory form; agents.ts uses 8601). */
const PUBLISH_LOCK_NAMESPACE = 8701;
const OPEN = ['queued', 'running'] as const;
const STALE_SUMMARY: GateRunSummary = { groups: [], errorCode: 'stale' };

/** Parses a stored value or throws `integrity`: a bad row is never returned. */
function stored<T>(schema: z.ZodType<T>, value: unknown, method: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new RepositoryError('integrity', method);
  return r.data;
}

/** JSON with sorted keys, so jsonb's key order never reads as a change. */
function canonical(v: unknown): string {
  /* v8 ignore next -- today's basis holds no arrays; kept so a future array field compares right */
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Plan decision 3: the change kinds of `next` against the last published basis, in kind order. */
function changeKinds(prev: PublishBasis | null, next: Omit<PublishBasis, 'agentVersion'>) {
  if (prev === null) return ['first_publish'] as PublishChangeKind[];
  const changed: Record<PublishChangeKind, boolean> = {
    first_publish: false,
    prompt_pack_bump:
      prev.promptPackVersion !== next.promptPackVersion ||
      canonical(prev.modelPolicy) !== canonical(next.modelPolicy),
    // The course's outline is material.
    material: prev.materialRevision !== next.materialRevision || prev.courseId !== next.courseId,
    packages: canonical(prev.packageVersions) !== canonical(next.packageVersions),
    style_card: prev.styleCardId !== next.styleCardId,
  };
  return PUBLISH_CHANGE_KINDS.filter((k) => changed[k]);
}

/** The gate deadline of a run's change kinds (mirror of evals' `defaultGateDeadlineMs`). */
function deadlineMs(changes: readonly string[]): number {
  return changes.includes('first_publish') || changes.includes('prompt_pack_bump')
    ? FULL_SCOPE_GATE_DEADLINE_MS
    : GATE_DEADLINE_MS;
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

const runColumns = {
  id: evalRuns.id,
  agentId: evalRuns.agentId,
  agentVersion: agentVersions.version,
  status: evalRuns.status,
  changes: evalRuns.changes,
  judgeModel: evalRuns.model,
  basis: evalRuns.basis,
  passRate: evalRuns.passRate,
  summary: evalRuns.summary,
  scorecard: evalRuns.scorecard,
  createdAt: evalRuns.createdAt,
  finishedAt: evalRuns.finishedAt,
  publishedAt: evalRuns.publishedAt,
};
type RunSelect = {
  [K in keyof typeof runColumns]: (typeof runColumns)[K]['_']['data'] | null;
};

const RunShape = z.object({
  id: z.string(),
  agentId: z.string(),
  agentVersion: z.int(),
  status: z.enum(GATE_RUN_STATUSES),
  changes: z.array(z.enum(PUBLISH_CHANGE_KINDS)),
  judgeModel: z.string(),
  basis: BasisSchema,
  passRate: z.number().nullable(),
  summary: SummarySchema.nullable(),
  scorecard: ScorecardSchema.nullable(),
});

function toRun(row: RunSelect, method: string): GateRunRow {
  const r = stored(RunShape, row, method);
  return {
    ...r,
    createdAt: (row.createdAt as Date).toISOString(),
    finishedAt: iso(row.finishedAt),
    publishedAt: iso(row.publishedAt),
  };
}

/** A teacher's publish-gate runs (offline suite rows have no agent or status). */
const gateRunOf = (teacherId: string) =>
  and(
    eq(evalRuns.teacherId, teacherId),
    eq(evalRuns.suite, GATE_SUITE),
    isNotNull(evalRuns.agentId),
    isNotNull(evalRuns.status),
  );

export function publishRepo(db: Db) {
  type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

  /** The profile row locked FOR SHARE: verification can't change before the transaction ends. */
  async function lockVerified(tx: Tx, teacherId: string, method: string): Promise<void> {
    const [p] = await tx
      .select({ status: teacherProfiles.verificationStatus })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, teacherId))
      .for('share');
    if (p?.status !== 'verified') throw new RepositoryError('scope', method);
  }

  /** The scope's gate run, locked FOR UPDATE; `not_found` if missing or another teacher's. */
  async function lockRun(tx: Tx, teacherId: string, runId: string, method: string) {
    const [run] = await tx
      .select({
        id: evalRuns.id,
        status: evalRuns.status,
        agentId: evalRuns.agentId,
        basis: evalRuns.basis,
      })
      .from(evalRuns)
      .where(and(eq(evalRuns.id, runId), gateRunOf(teacherId)))
      .for('update');
    if (!run) throw new RepositoryError('not_found', method);
    return run;
  }

  async function readRun(teacherId: string, runId: string | null, method: string) {
    const [row] = await db
      .select(runColumns)
      .from(evalRuns)
      .innerJoin(agentVersions, eq(agentVersions.id, evalRuns.agentVersionId))
      .where(
        runId === null ? gateRunOf(teacherId) : and(eq(evalRuns.id, runId), gateRunOf(teacherId)),
      )
      .orderBy(desc(evalRuns.createdAt), desc(evalRuns.id))
      .limit(1);
    return row ? toRun(row, method) : null;
  }

  return {
    /**
     * Starts a publish run for one of the scope's agents. In one transaction (serialised per
     * teacher by an advisory lock): the teacher must be verified (profile FOR SHARE, else
     * `scope`); the agent, course and style card must be the scope's (`not_found`); a suspended
     * agent is refused (`suspended`); an open run is refused (`gate_running`) unless it is stale,
     * when it is ended `error` / `stale` first; at least one package must have a version
     * (`no_packages`). The basis (pins, material revision, every package's newest version) is
     * compared with the last published run's for the change kinds; an unchanged live agent is
     * refused (`nothing_to_publish`). Then agent version N+1 is cut from the pins (languages and
     * regulated subject carried from version N) and a `queued` run is stored.
     */
    async startRun(scope: TeacherScope, pins: PublishPins): Promise<GateRunRow> {
      const method = 'publish.startRun';
      const { teacherId } = teacherScope(scope, method);
      const p = parseArg(PinsSchema, pins, method);
      const runId = await translateWrite(method, () =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(${PUBLISH_LOCK_NAMESPACE}::int4, hashtext(${teacherId}))`,
          );
          await lockVerified(tx, teacherId, method);
          const [agent] = await tx
            .select({ status: agents.status })
            .from(agents)
            .where(and(eq(agents.id, p.agentId), eq(agents.teacherId, teacherId)))
            .for('update');
          const [course] = await tx
            .select({ id: courses.id })
            .from(courses)
            .where(and(eq(courses.id, p.courseId), eq(courses.teacherId, teacherId)))
            .for('key share');
          const [card] = await tx
            .select({ id: styleCards.id })
            .from(styleCards)
            .where(and(eq(styleCards.id, p.styleCardId), eq(styleCards.teacherId, teacherId)))
            .for('key share');
          if (!agent || !course || !card) throw new RepositoryError('not_found', method);
          if (agent.status === 'suspended') {
            throw new PublishRefusedError('invalid', method, 'suspended');
          }

          const [open] = await tx
            .select({
              id: evalRuns.id,
              changes: evalRuns.changes,
              ageMs: sql<number>`(extract(epoch from (now() - ${evalRuns.updatedAt})) * 1000)::float8`,
            })
            .from(evalRuns)
            .where(and(eq(evalRuns.agentId, p.agentId), inArray(evalRuns.status, [...OPEN])))
            .for('update');
          if (open) {
            if (open.ageMs <= deadlineMs(open.changes ?? []) + STALE_RUN_GRACE_MS) {
              throw new PublishRefusedError('integrity', method, 'gate_running');
            }
            await tx
              .update(evalRuns)
              .set({ status: 'error', finishedAt: sql`now()`, summary: STALE_SUMMARY })
              .where(eq(evalRuns.id, open.id));
          }

          const pkgRows = await tx
            .select({
              id: packages.id,
              version: sql<number>`max(${packageVersions.version})::int`,
            })
            .from(packages)
            .innerJoin(
              packageVersions,
              and(
                eq(packageVersions.packageId, packages.id),
                eq(packageVersions.teacherId, teacherId),
              ),
            )
            .where(and(eq(packages.teacherId, teacherId), eq(packages.agentId, p.agentId)))
            .groupBy(packages.id);
          if (pkgRows.length === 0) throw new PublishRefusedError('invalid', method, 'no_packages');
          const packageVersionMap = Object.fromEntries(pkgRows.map((r) => [r.id, r.version]));

          const [rev] = await tx
            .select({ revision: teacherMaterialRevisions.revision })
            .from(teacherMaterialRevisions)
            .where(eq(teacherMaterialRevisions.teacherId, teacherId));
          const [published] = await tx
            .select({ basis: evalRuns.basis })
            .from(evalRuns)
            .where(
              and(
                eq(evalRuns.agentId, p.agentId),
                gateRunOf(teacherId),
                eq(evalRuns.status, 'passed'),
                isNotNull(evalRuns.publishedAt),
              ),
            )
            .orderBy(desc(evalRuns.publishedAt))
            .limit(1);
          const next = {
            courseId: p.courseId,
            styleCardId: p.styleCardId,
            promptPackVersion: p.promptPackVersion,
            modelPolicy: p.modelPolicy,
            materialRevision: rev?.revision ?? 0,
            packageVersions: packageVersionMap,
          };
          let changes = changeKinds(
            published ? stored(BasisSchema, published.basis, method) : null,
            next,
          );
          if (changes.length === 0) {
            if (agent.status === 'live') {
              throw new PublishRefusedError('invalid', method, 'nothing_to_publish');
            }
            // Published once but no longer live: re-publish with the full gate.
            changes = ['first_publish'];
          }

          const [latest] = await tx
            .select({ version: agentVersions.version, config: agentVersions.config })
            .from(agentVersions)
            .where(
              and(eq(agentVersions.agentId, p.agentId), eq(agentVersions.teacherId, teacherId)),
            )
            .orderBy(desc(agentVersions.version))
            .limit(1);
          // An agent without a version is never written by this package.
          /* v8 ignore next -- agents.ensureDraft always writes version 1 with the agent */
          if (!latest) throw new RepositoryError('integrity', method);
          const version = latest.version + 1;
          const config = parseArg(
            AgentConfigSchema,
            {
              id: p.agentId,
              version,
              teacherId,
              courseId: p.courseId,
              styleCardId: p.styleCardId,
              promptPackVersion: p.promptPackVersion,
              languages: latest.config.languages,
              ...(latest.config.regulatedSubject === undefined
                ? {}
                : { regulatedSubject: latest.config.regulatedSubject }),
              modelPolicy: p.modelPolicy,
            },
            method,
          );
          const agentVersionId = randomUUID();
          await tx.insert(agentVersions).values({
            id: agentVersionId,
            teacherId,
            agentId: p.agentId,
            version,
            config,
          });
          const id = randomUUID();
          const basis: PublishBasis = { agentVersion: version, ...next };
          await tx.insert(evalRuns).values({
            id,
            teacherId,
            agentVersionId,
            agentId: p.agentId,
            suite: GATE_SUITE,
            model: p.judgeModel,
            status: 'queued',
            changes,
            basis,
          });
          return id;
        }),
      );
      const run = await readRun(teacherId, runId, method);
      /* v8 ignore next -- the row was committed just above */
      if (!run) throw new RepositoryError('integrity', method);
      return run;
    },

    /**
     * `queued` -> `running`: true when this call moved it, false when the run is no longer
     * queued (a redelivered job is a no-op). Missing or another teacher's run: `not_found`.
     */
    async markRunning(scope: TeacherScope, runId: string): Promise<boolean> {
      const method = 'publish.markRunning';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, runId, method);
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, teacherId, id, method);
        if (run.status !== 'queued') return false;
        await tx.update(evalRuns).set({ status: 'running' }).where(eq(evalRuns.id, id));
        return true;
      });
    },

    /** One of the scope's gate runs, or null. */
    async getRun(scope: TeacherScope, runId: string): Promise<GateRunRow | null> {
      const method = 'publish.getRun';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, runId, method);
      return readRun(teacherId, id, method);
    },

    /**
     * Stores one `eval_results` row per case of a `running` run (else `invalid`), idempotent on
     * (run, case): a case already stored is skipped. Returns how many rows were new.
     */
    async recordResults(
      scope: TeacherScope,
      input: { runId: string; results: GateCaseResult[] },
    ): Promise<{ written: number }> {
      const method = 'publish.recordResults';
      const { teacherId } = teacherScope(scope, method);
      const r = parseArg(RecordInput, input, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const run = await lockRun(tx, teacherId, r.runId, method);
          if (run.status !== 'running') throw new RepositoryError('invalid', method);
          let written = 0;
          for (let i = 0; i < r.results.length; i += INSERT_BATCH) {
            const rows = await tx
              .insert(evalResults)
              .values(
                r.results.slice(i, i + INSERT_BATCH).map((c) => ({
                  evalRunId: r.runId,
                  caseId: c.caseId,
                  passed: c.passed,
                  details: c.details,
                })),
              )
              .onConflictDoNothing({ target: [evalResults.evalRunId, evalResults.caseId] })
              .returning({ id: evalResults.id });
            written += rows.length;
          }
          return { written };
        }),
      );
    },

    /**
     * Ends a `queued` or `running` run as `failed` or `error` (else `invalid`), with its summary,
     * pass rate and scorecard. Never touches agents or packages: nothing goes live.
     */
    async finishRun(scope: TeacherScope, input: FinishRunInput): Promise<void> {
      const method = 'publish.finishRun';
      const { teacherId } = teacherScope(scope, method);
      const f = parseArg(FinishInput, input, method);
      await db.transaction(async (tx) => {
        const run = await lockRun(tx, teacherId, f.runId, method);
        if (!(OPEN as readonly (string | null)[]).includes(run.status)) {
          throw new RepositoryError('invalid', method);
        }
        await tx
          .update(evalRuns)
          .set({
            status: f.status,
            finishedAt: sql`now()`,
            summary: f.summary,
            passRate: f.passRate ?? null,
            scorecard: f.scorecard ?? null,
          })
          .where(eq(evalRuns.id, f.runId));
      });
    },

    /**
     * `gatedPublish`'s publish step, in one transaction: the teacher must still be verified
     * (profile FOR SHARE, else `scope`, nothing changes); the run must be the scope's
     * (`not_found`) and `running` (`invalid`); an agent suspended meanwhile is refused
     * (`suspended`). Then the agent goes `live` at the run's agent version, every package in the
     * basis gets its basis version as `live_version`, the run is `passed` with `published_at`,
     * summary and scorecard, and `agent.publish` / `package.publish` audit rows are written.
     */
    async goLive(
      scope: TeacherScope,
      input: GoLiveInput,
    ): Promise<{ agentVersion: number; packageVersions: Record<string, number> }> {
      const method = 'publish.goLive';
      const { teacherId } = teacherScope(scope, method);
      const g = parseArg(GoLiveInput, input, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await lockVerified(tx, teacherId, method);
          const run = await lockRun(tx, teacherId, g.runId, method);
          if (run.status !== 'running') throw new RepositoryError('invalid', method);
          const basis = stored(BasisSchema, run.basis, method);
          const agentId = run.agentId as string;
          const [agent] = await tx
            .select({ status: agents.status, liveVersion: agents.liveVersion })
            .from(agents)
            .where(and(eq(agents.id, agentId), eq(agents.teacherId, teacherId)))
            .for('update');
          /* v8 ignore next -- eval_runs.agent_id references agents; agents are never deleted */
          if (!agent) throw new RepositoryError('integrity', method);
          if (agent.status === 'suspended') {
            throw new PublishRefusedError('invalid', method, 'suspended');
          }
          await tx
            .update(agents)
            .set({ status: 'live', liveVersion: basis.agentVersion })
            .where(eq(agents.id, agentId));
          await insertAuditEntry(tx, method, teacherId, null, {
            actor: teacherId,
            actorRole: 'teacher',
            action: 'agent.publish',
            target: `agent:${agentId}`,
            before: { status: agent.status, liveVersion: agent.liveVersion },
            after: { status: 'live', liveVersion: basis.agentVersion, runId: g.runId },
          });
          for (const [packageId, version] of Object.entries(basis.packageVersions).sort()) {
            const [before] = await tx
              .select({ liveVersion: packages.liveVersion })
              .from(packages)
              .where(
                and(
                  eq(packages.id, packageId),
                  eq(packages.teacherId, teacherId),
                  eq(packages.agentId, agentId),
                ),
              )
              .for('update');
            /* v8 ignore next -- the basis was read from these rows; packages are never deleted */
            if (!before) throw new RepositoryError('integrity', method);
            await tx
              .update(packages)
              .set({ liveVersion: version })
              .where(eq(packages.id, packageId));
            await insertAuditEntry(tx, method, teacherId, null, {
              actor: teacherId,
              actorRole: 'teacher',
              action: 'package.publish',
              target: `package:${packageId}`,
              before: { liveVersion: before.liveVersion },
              after: { liveVersion: version, runId: g.runId },
            });
          }
          await tx
            .update(evalRuns)
            .set({
              status: 'passed',
              finishedAt: sql`now()`,
              publishedAt: sql`now()`,
              summary: g.summary,
              passRate: g.passRate,
              scorecard: g.scorecard,
            })
            .where(eq(evalRuns.id, g.runId));
          return { agentVersion: basis.agentVersion, packageVersions: basis.packageVersions };
        }),
      );
    },

    /** The scope's newest gate run (any status), or null. */
    async latestRun(scope: TeacherScope): Promise<GateRunRow | null> {
      const method = 'publish.latestRun';
      const { teacherId } = teacherScope(scope, method);
      return readRun(teacherId, null, method);
    },

    /**
     * The failed cases of one of the scope's runs, newest first, at most `FAILED_CASES_MAX`;
     * `[]` for a missing or another teacher's run.
     */
    async failedCases(scope: TeacherScope, runId: string): Promise<FailedCase[]> {
      const method = 'publish.failedCases';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, runId, method);
      const rows = await db
        .select({ caseId: evalResults.caseId, details: evalResults.details })
        .from(evalResults)
        .innerJoin(evalRuns, eq(evalRuns.id, evalResults.evalRunId))
        .where(
          and(eq(evalResults.evalRunId, id), gateRunOf(teacherId), eq(evalResults.passed, false)),
        )
        .orderBy(desc(evalResults.createdAt), evalResults.caseId)
        .limit(FAILED_CASES_MAX);
      return rows.map((r) => ({
        caseId: r.caseId,
        details: stored(CaseDetailsSchema, r.details, method),
      }));
    },

    /**
     * The public teaching scorecard of a live agent whose teacher is verified; null otherwise,
     * or when it has no passed run yet. Public like `agents.owner` (parsed like a scope). Each
     * category comes from the newest published run that measured it, with that run's
     * `published_at` (lead, Q4); a category no run measured stays unmeasured.
     */
    async publicScorecard(scope: { agentId: string }): Promise<PublicScorecard | null> {
      const method = 'publish.publicScorecard';
      const s = PublicAgentSchema.safeParse(scope);
      if (!s.success) throw new RepositoryError('scope', method);
      const rows = await db
        .select({ scorecard: evalRuns.scorecard, publishedAt: evalRuns.publishedAt })
        .from(evalRuns)
        .innerJoin(
          agents,
          and(
            eq(agents.id, evalRuns.agentId),
            eq(agents.teacherId, evalRuns.teacherId),
            eq(agents.status, 'live'),
          ),
        )
        .innerJoin(
          teacherProfiles,
          and(
            eq(teacherProfiles.userId, agents.teacherId),
            eq(teacherProfiles.verificationStatus, 'verified'),
          ),
        )
        .where(
          and(
            eq(evalRuns.agentId, s.data.agentId),
            eq(evalRuns.suite, GATE_SUITE),
            eq(evalRuns.status, 'passed'),
            isNotNull(evalRuns.publishedAt),
            isNotNull(evalRuns.scorecard),
          ),
        )
        .orderBy(desc(evalRuns.publishedAt), desc(evalRuns.id))
        .limit(SCORECARD_RUNS_MAX);
      if (rows.length === 0) return null;
      const cards = rows.map((r) => ({
        card: stored(ScorecardSchema, r.scorecard, method),
        at: (r.publishedAt as Date).toISOString(),
      }));
      const [newest] = cards as [(typeof cards)[number]];
      const categories = newest.card.categories.map((c): PublicScorecardCategory => {
        for (const x of cards) {
          const m = x.card.categories.find((k) => k.key === c.key && k.measured);
          if (m) return { ...m, measuredAt: x.at };
        }
        return { ...c, measuredAt: null };
      });
      return { publishedAt: newest.at, categories };
    },
  };
}
