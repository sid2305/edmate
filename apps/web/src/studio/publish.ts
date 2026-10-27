// Task 8.7 Phase D: the studio publish API. A publish runs the quality gate over the whole agent
// (a fresh agent version plus the newest version of every package) on the worker's gate queue;
// a pass goes live there in one transaction (apps/worker/src/gate/processor.ts). This file only
// starts a run and reads the latest one.
//
//   POST /api/studio/publish   {}  -> 202 { runId }
//   GET  /api/studio/publish       -> { run: PublishRunView | null }
//
// The teacher is always the session's principal; the body is a strict `{}` (any key is a 400).
// The pins (agent, default course, newest style card, newest signed prompt-pack set,
// MODEL_MIX.paid, the release judge) come from the repos and the runtime, never the client.
// Error codes are the contract's `ErrorCode`s; a top-level `reason` names the case
// (`not_verified`, `no_packages`, `style_card_required`, `gate_running`, `nothing_to_publish`,
// `suspended`, `conflict`, `unavailable`, `internal`). Logs carry fixed codes and error names only.
import type { ErrorCode, ModelPolicy } from '@edmate/contracts';
import {
  PublishRefusedError,
  RepositoryError,
  type GateCaseDetails,
  type GateRunRow,
  type GateRunSummary,
  type Repositories,
  type StoredScorecard,
  type TeacherScope,
} from '@edmate/db';
import type { GateJob } from '@edmate/queue';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorBody } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { readJson, TOO_LARGE, type ServerLog } from './routes';

/** Everything the publish API needs, built once per process (publishRuntime.ts) or per test. */
export interface PublishBackend {
  repos: {
    teacherProfiles: Pick<Repositories['teacherProfiles'], 'assertVerifiedForPublish'>;
    packages: Pick<Repositories['packages'], 'listForTeacher'>;
    courses: Pick<Repositories['courses'], 'ensureDefault'>;
    styleCards: Pick<Repositories['styleCards'], 'latest'>;
    publish: Pick<
      Repositories['publish'],
      'startRun' | 'finishRun' | 'latestRun' | 'failedCases' | 'changedSinceLastPublish'
    >;
  };
  /** The newest signed prompt-pack set's version. */
  promptPackVersion: string;
  /** `MODEL_MIX.paid` (B-42). */
  modelPolicy: ModelPolicy;
  /** The release judge as `<provider>:<model>` (the worker refuses a run pinned to another). */
  judgeModel: string;
  /** `enqueueGate` on the gate queue. */
  enqueue(job: GateJob): Promise<void>;
  log: ServerLog;
  /** The current time (tests pin it; the real backend returns `new Date()`). */
  now(): Date;
}

/**
 * How long a run may sit `queued` or `running` before the studio treats it as stuck and shows
 * `error`/`stale` instead of a spinner that never resolves (8.7l: enqueue and finishRun can both
 * fail in a way that leaves a run neither finished nor retried). Not spec'd; the worker should
 * claim a queued gate run almost at once, so two minutes is generous slack, not a real wait.
 */
export const STALE_QUEUE_MS = 2 * 60 * 1000;

/** One failed case as the studio shows it: never a model reply, only the teacher's own question. */
export type PublishFailedCase = { caseId: string } & GateCaseDetails;

/** The latest gate run as the studio page sees it. */
export interface PublishRunView {
  runId: string;
  status: GateRunRow['status'];
  changes: GateRunRow['changes'];
  groups: GateRunSummary['groups'];
  /** A fixed code word for an `error` run (`gate_unavailable`, `stale`, ...), else null. */
  errorCode: string | null;
  failedCases: PublishFailedCase[];
  scorecard: StoredScorecard | null;
  startedAt: string;
  finishedAt: string | null;
  publishedAt: string | null;
  /** Whether anything has changed since this run's own publish (task 8.7k); `false` otherwise. */
  changedSincePublish: boolean;
}

/** The summary stored when the gate job can't be queued (a fixed code word, never error text). */
export const ENQUEUE_FAILED = 'enqueue_failed';

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  notFound: 'Your agent was not found. Reload and try again.',
  notVerified: 'Your profile must be verified before you can publish.',
  noPackages: 'Make at least one package before you publish.',
  styleCard: 'Set up your style card before you publish.',
  refused: 'Publishing is not possible right now.',
  conflict: 'Something changed while you were publishing. Reload and try again.',
  unavailable: 'Publishing is not available right now. Try again soon.',
  failed: 'Something went wrong. Try again.',
} as const;

const noStore = { 'cache-control': 'no-store' };
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
function fail(code: ErrorCode, message: string, status: number, reason?: string): Response {
  const extra = reason === undefined ? {} : { reason };
  return Response.json({ error: errorBody(code, message), ...extra }, { status, headers: noStore });
}
const notVerified = () => fail('forbidden', MSG.notVerified, 403, 'not_verified');
const unavailable = () => fail('provider_error', MSG.unavailable, 503, 'unavailable');

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** The only body POST accepts: nothing (the pins are the server's). */
const StartBody = z.strictObject({});

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;
type Work = (b: PublishBackend, scope: TeacherScope, req: NextRequest) => Promise<Response>;

const start: Work = async (b, scope, req) => {
  const raw = await readJson(req);
  if (raw === TOO_LARGE) return fail('input_too_large', MSG.tooLarge, 413);
  if (!StartBody.safeParse(raw).success) return fail('validation', MSG.validation, 400);

  // Checked first and cheaply so an unverified teacher gets a clear 403; `startRun` re-checks
  // inside its transaction (profile FOR SHARE), and `goLive` once more.
  await b.repos.teacherProfiles.assertVerifiedForPublish(scope);
  // Sequential by design (task 8.7n): `ensureDefault` writes (creates a default course row if
  // the teacher has none), so it must stay gated behind both failure checks above it. Batching
  // these three with `Promise.all` was considered and rejected -- it would let `ensureDefault`'s
  // write race ahead of, or complete before, the `no_packages`/`style_card_required` checks,
  // creating a default course even when the request is about to fail for an unrelated reason (a
  // side effect that today happens only on the success path). No behaviour change here.
  const rows = await b.repos.packages.listForTeacher(scope);
  const agentId = rows[0]?.agentId;
  if (agentId === undefined) return fail('validation', MSG.noPackages, 409, 'no_packages');
  const card = await b.repos.styleCards.latest(scope);
  if (card === null) return fail('validation', MSG.styleCard, 409, 'style_card_required');
  const course = await b.repos.courses.ensureDefault(scope);
  const run = await b.repos.publish.startRun(scope, {
    agentId,
    courseId: course.id,
    styleCardId: card.id,
    promptPackVersion: b.promptPackVersion,
    modelPolicy: b.modelPolicy,
    judgeModel: b.judgeModel,
  });
  // Enqueued only after startRun has committed (the worker re-reads the run). A failed enqueue
  // ends the run `error` so it never waits for the stale rule (lessons: a silent skip looks like
  // a pass).
  try {
    await b.enqueue({ runId: run.id, teacherId: scope.teacherId });
  } catch (error) {
    b.log.error('studio.publish_enqueue_failed', { error: errorName(error) });
    try {
      await b.repos.publish.finishRun(scope, {
        runId: run.id,
        status: 'error',
        summary: { groups: [], errorCode: ENQUEUE_FAILED },
      });
    } catch (finishError) {
      b.log.error('studio.publish_finish_failed', { error: errorName(finishError) });
    }
    return unavailable();
  }
  return ok({ runId: run.id }, 202);
};

/** A `queued`/`running` run whose `createdAt` is past the stale deadline, relative to `b.now()`. */
function stale(b: PublishBackend, run: GateRunRow): boolean {
  if (run.status !== 'queued' && run.status !== 'running') return false;
  return b.now().getTime() - Date.parse(run.createdAt) > STALE_QUEUE_MS;
}

const latest: Work = async (b, scope) => {
  const run = await b.repos.publish.latestRun(scope);
  if (run === null) return ok({ run: null });
  const isStale = stale(b, run);
  const status = isStale ? 'error' : run.status;
  const failed = run.status === 'failed' ? await b.repos.publish.failedCases(scope, run.id) : [];
  const changedSincePublish = await b.repos.publish.changedSinceLastPublish(scope);
  const view: PublishRunView = {
    runId: run.id,
    status,
    changes: run.changes,
    groups: run.summary?.groups ?? [],
    errorCode: isStale ? 'stale' : (run.summary?.errorCode ?? null),
    failedCases: failed.map((f) => ({ caseId: f.caseId, ...f.details })),
    scorecard: run.scorecard,
    startedAt: run.createdAt,
    finishedAt: run.finishedAt,
    publishedAt: run.publishedAt,
    changedSincePublish,
  };
  return ok({ run: view });
};

/** A thrown error mapped to a fixed response; only a code (and an error name) is logged. */
function fromError(b: PublishBackend, error: unknown): Response {
  if (error instanceof PublishRefusedError) {
    return fail('validation', MSG.refused, 409, error.reason);
  }
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'scope':
        return notVerified();
      case 'not_found':
        return fail('not_found', MSG.notFound, 404);
      case 'invalid':
      case 'integrity':
        return fail('validation', MSG.conflict, 409, 'conflict');
      case 'failed':
        b.log.error('studio.publish_failed', { reason: 'failed' });
        return unavailable();
    }
  }
  b.log.error('studio.publish_failed', { reason: 'internal', error: errorName(error) });
  return fail('provider_error', MSG.failed, 500, 'internal');
}

/**
 * The two handlers over a lazily built backend (publishRuntime.ts). A backend that can't be built
 * (no Redis, no judge model, no signed prompt-pack set) is 503, logged by reason code.
 */
export function createPublishHandlers(
  backend: () => Promise<PublishBackend>,
  fallbackLog: ServerLog,
): { start: Handler; latest: Handler } {
  const run =
    (work: Work): Handler =>
    async (req, ctx) => {
      let b: PublishBackend;
      try {
        b = await backend();
      } catch (error) {
        const coded: unknown = error instanceof Error ? Reflect.get(error, 'reason') : undefined;
        const reason = typeof coded === 'string' ? coded : errorName(error);
        fallbackLog.error('studio.publish_unavailable', { reason });
        return unavailable();
      }
      const scope: TeacherScope = { teacherId: ctx.principal.userId };
      try {
        return await work(b, scope, req);
      } catch (error) {
        return fromError(b, error);
      }
    };
  return { start: run(start), latest: run(latest) };
}
