// The turn queues (task 3.8): names, job names, job ids, retry options and payload schemas, shared
// by the producers here and the processors in apps/worker.
//
// - `edmate-turn-meter`: usage rows (billing only).
// - `edmate-turn-commit`: everything else persisted after a turn: messages, the help state and
//   the trace.
// - `edmate-dead-letter`: jobs that failed for good (attempts used up, or a permanent error).
// - `edmate-safety-alert`: SafetyAlerts (task 4.3): tell the trust team, then page on-call every
//   15 minutes until someone acknowledges the alert.
// - `edmate-safety-event`: moderationIn and jailbreak blocks (task 4.4, ADR-0006): one
//   safety_events row each, ids and a fixed code only.
// - `edmate-ingest`: a document to parse, chunk and store (task 8.2 Phase 2). The job carries the
//   file's kind (and, for video/audio, its mime type) because `documents.kind` in the database is
//   the chunk's retrieval category (material/transcript/teacher_note), not the uploaded file's
//   format — there is nowhere else for the processor to learn it.
//
// BullMQ refuses `:` in a custom job id, so the parts are joined with `.` (contracts ids never
// contain one).
import { createHash } from 'node:crypto';
import {
  EntitlementSchema,
  EvidenceEventSchema,
  MessageSchema,
  SafetyAlertSchema,
  SafetyEventCodeSchema,
  TurnTraceSchema,
  UsageSchema,
} from '@edmate/contracts';
import type { JobsOptions } from 'bullmq';
import { z } from 'zod';

export const METER_QUEUE = 'edmate-turn-meter';
export const COMMIT_QUEUE = 'edmate-turn-commit';
export const DEAD_LETTER_QUEUE = 'edmate-dead-letter';
export const ALERT_QUEUE = 'edmate-safety-alert';
export const SAFETY_EVENT_QUEUE = 'edmate-safety-event';
export const INGEST_QUEUE = 'edmate-ingest';

export const JOB = {
  usage: 'usage.record',
  unmetered: 'usage.unmetered',
  message: 'message.append',
  helpState: 'session.help_state',
  trace: 'trace.record',
  evidence: 'evidence.apply',
  alertRaise: 'alert.raise',
  alertEscalateCheck: 'alert.escalate_check',
  safetyEventRecord: 'safety_event.record',
  ingestProcess: 'ingest.process',
} as const;
export type JobName = (typeof JOB)[keyof typeof JOB];

/** What a producer needs from a BullMQ Queue (a fake in unit tests). */
export interface JobQueue {
  add(name: string, data: unknown, opts: JobsOptions): Promise<unknown>;
}

/** Retries with exponential backoff (1 s, 2 s, 4 s, 8 s); then the worker dead-letters the job. */
export const RETRY: Pick<JobsOptions, 'attempts' | 'backoff'> = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
};

/**
 * How long a failed job, or a dead-letter entry, is kept: 7 days. They can hold a student's
 * message text (the failed set) or ids (the dead-letter queue), so neither stays forever.
 */
export const FAILED_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Completed jobs are removed (the database has the row). Failed ones are kept beside the
 * dead-letter entry for FAILED_JOB_TTL_SECONDS (and at most 1 000); a failed help-state job is
 * removed at once, because its payload holds the answer key.
 */
export function jobOptions(jobId: string, name: JobName): JobsOptions {
  return {
    ...RETRY,
    jobId,
    removeOnComplete: true,
    removeOnFail: name === JOB.helpState ? true : { age: FAILED_JOB_TTL_SECONDS, count: 1_000 },
  };
}

export const jobId = {
  usage: (turnId: string, index: number) => `${turnId}.usage.${index}`,
  message: (messageId: string) => `${messageId}.message`,
  helpState: (sessionId: string, writeId: string) => `${sessionId}.help.${writeId}`,
  trace: (turnId: string) => `${turnId}.trace`,
  evidence: (eventId: string) => `${eventId}.evidence`,
  alertRaise: (alertId: string) => `${alertId}.alert`,
  /** One id per round, so each 15-minute check can schedule the next one. */
  alertEscalate: (alertId: string, round: number) => `${alertId}.escalate.${round}`,
  /** ADR-0006's dedupe key `${turnId}:${guard}`, with `.` (BullMQ refuses `:`). */
  safetyEvent: (turnId: string, guard: SafetyEventGuard) => `${turnId}.${guard}.safety`,
  /**
   * One ingest job per *stored file* at a time: the id is the document id plus a short hash of
   * `storageKey`, so a retry (same document, same file) replaces the still-queued attempt, but a
   * replace (same document, a new `storageKey`) gets its own id instead of colliding with a job
   * that may still be active for the old file. `Queue.add()` only dedupes against a job still
   * `waiting`/`delayed`; reusing one id across a replace would block indefinitely against a job
   * already running (see the Phase 2 int test's decision).
   */
  ingest: (documentId: string, storageKey: string) =>
    `${documentId}.ingest.${createHash('sha256').update(storageKey).digest('hex').slice(0, 12)}`,
};

// ---- safety alerts (task 4.3) -----------------------------------------------------------------

/** How long after the raise on-call is paged if nobody acknowledged the alert, and how often again. */
export const ALERT_ESCALATION_MS = 15 * 60_000;
/** "Retried until delivered": a million attempts at the 30 s cap is about a year. */
export const ALERT_ATTEMPTS = 1_000_000;
/** The worker's custom backoff (BullMQ's exponential one has no cap). */
export const ALERT_BACKOFF_TYPE = 'alert-capped';
export const ALERT_BACKOFF_START_MS = 1_000;
export const ALERT_BACKOFF_MAX_MS = 30_000;
/**
 * Completed alert jobs are kept a day so their ids still dedupe a raise retried after the first
 * one finished. They hold the alert's redacted excerpt, so not longer.
 */
export const ALERT_COMPLETED_TTL_SECONDS = 24 * 60 * 60;

/** The delay before attempt `attemptsMade + 1`: doubling from `startMs`, never above `maxMs`. */
export function alertBackoffMs(
  attemptsMade: number,
  startMs = ALERT_BACKOFF_START_MS,
  maxMs = ALERT_BACKOFF_MAX_MS,
): number {
  return Math.min(startMs * 2 ** Math.max(0, attemptsMade - 1), maxMs);
}

export function alertJobOptions(jobId: string, delayMs?: number): JobsOptions {
  return {
    jobId,
    attempts: ALERT_ATTEMPTS,
    backoff: { type: ALERT_BACKOFF_TYPE, delay: ALERT_BACKOFF_START_MS },
    removeOnComplete: { age: ALERT_COMPLETED_TTL_SECONDS },
    removeOnFail: { age: FAILED_JOB_TTL_SECONDS },
    ...(delayMs === undefined ? {} : { delay: delayMs }),
  };
}

export const AlertRaiseJobSchema = z.strictObject({ alert: SafetyAlertSchema });
export type AlertRaiseJob = z.infer<typeof AlertRaiseJobSchema>;

/** `round` 0 is the first check (15 minutes after the raise); each unacknowledged check adds one. */
export const AlertEscalateJobSchema = z.strictObject({
  alert: SafetyAlertSchema,
  round: z.int().min(0),
});
export type AlertEscalateJob = z.infer<typeof AlertEscalateJobSchema>;

/**
 * The usage_ledger row id for the `index`-th usage write of a turn: the same on every retry of
 * the job, so the worker can tell it already wrote the row. A hash, so any turn id fits the
 * contracts id format (at most 128 characters).
 */
export function usageRowId(turnId: string, index: number): string {
  return `ul_${createHash('sha256').update(`${turnId}\u0000${index}`).digest('hex').slice(0, 40)}`;
}

/**
 * Content-hash id for one `EvidenceEvent` (task 3.17, lead answer): the queue job id
 * (`jobId.evidence`) and the row id `evidenceEventsRepo.append`'s worker processor writes both
 * come from this ONE function over a fixed field order, so a replayed job and the attempt that
 * first wrote the row land on the same id — that identity is what makes the write idempotent (see
 * `apps/worker/src/commit/processors.ts`'s `evidence.apply` branch). `e.ts` must be the event's
 * *original* timestamp, never one re-stamped on retry: hashing a fresh timestamp on every attempt
 * would give every retry its own id and defeat the dedup entirely.
 */
export function evidenceEventId(e: {
  studentId: string;
  teacherId: string;
  topicId: string;
  correct: boolean;
  source: string;
  weight: number;
  ts: string;
}): string {
  const key = JSON.stringify([
    e.studentId,
    e.teacherId,
    e.topicId,
    e.correct,
    e.source,
    e.weight,
    e.ts,
  ]);
  return `ev_${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

const Id = MessageSchema.shape.id;
const Scope = z.strictObject({ studentId: Id, teacherId: Id });
export type JobScope = z.infer<typeof Scope>;

const Billing = {
  scope: Scope,
  packageId: Id,
  turnId: Id,
  source: EntitlementSchema.shape.source,
  index: z.int().min(0),
};

export const UsageJobSchema = z.strictObject({ ...Billing, usage: UsageSchema });
export type UsageJob = z.infer<typeof UsageJobSchema>;

export const UnmeteredJobSchema = z.strictObject({
  ...Billing,
  tier: UsageSchema.shape.tier,
  reason: z.union([
    z.literal('no_usage_reported'),
    z.templateLiteral(['unpriced_model:', z.string()]),
  ]),
  model: z.string().min(1).optional(),
  tokens: z
    .strictObject({
      inputTokens: UsageSchema.shape.inputTokens,
      outputTokens: UsageSchema.shape.outputTokens,
    })
    .optional(),
});
export type UnmeteredJob = z.infer<typeof UnmeteredJobSchema>;

export const MessageJobSchema = z.strictObject({
  scope: Scope,
  sessionId: Id,
  message: MessageSchema,
});
export type MessageJob = z.infer<typeof MessageJobSchema>;

export const HelpStateJobSchema = z.strictObject({
  scope: Scope,
  sessionId: Id,
  /** Holds the answer key. Only the session-state processor reads it; it is never logged. */
  helpState: z.unknown(),
});
export type HelpStateJob = z.infer<typeof HelpStateJobSchema>;

export const TraceJobSchema = z.strictObject({ scope: Scope, trace: TurnTraceSchema });
export type TraceJob = z.infer<typeof TraceJobSchema>;

/** One evidence event per job (so its job id and `evidenceEventsRepo.append`'s row id agree). */
export const EvidenceJobSchema = z.strictObject({ scope: Scope, event: EvidenceEventSchema });
export type EvidenceJob = z.infer<typeof EvidenceJobSchema>;

/** The scope a producer is bound to, checked like the db adapters check theirs. */
export function bindScope(scope: JobScope, adapter: string): JobScope {
  const r = Scope.safeParse(scope);
  if (!r.success) throw new TypeError(`${adapter}: invalid scope`);
  return r.data;
}

// ---- safety events (task 4.4, ADR-0006) -------------------------------------------------------

const SafetyEventGuardSchema = z.enum(['moderationIn', 'jailbreak']);
export type SafetyEventGuard = z.infer<typeof SafetyEventGuardSchema>;
const SafetyEventSourceSchema = z.enum(['rule', 'classifier']);

/** `SafetyEventSink.record`'s argument, strict: ids, the guard, a fixed code and the source. */
export const SafetyEventSchema = z.strictObject({
  studentId: Id,
  teacherId: Id,
  sessionId: Id,
  turnId: Id,
  guard: SafetyEventGuardSchema,
  code: SafetyEventCodeSchema,
  source: SafetyEventSourceSchema,
});
export type SafetyEvent = z.infer<typeof SafetyEventSchema>;

/** The job: the event with its student x teacher as the scope the worker writes under. */
export const SafetyEventJobSchema = z.strictObject({
  scope: Scope,
  sessionId: Id,
  turnId: Id,
  guard: SafetyEventGuardSchema,
  code: SafetyEventCodeSchema,
  source: SafetyEventSourceSchema,
});
export type SafetyEventJob = z.infer<typeof SafetyEventJobSchema>;

// ---- ingest (task 8.2 Phase 2) ----------------------------------------------------------------

/** `@edmate/ingest`'s `DocumentKind` plus the two media kinds its `VideoSource` covers. */
export const IngestFileKindSchema = z.enum(['pdf', 'docx', 'pptx', 'markdown', 'video', 'audio']);
export type IngestFileKind = z.infer<typeof IngestFileKindSchema>;

const MEDIA_MIME = /^(?:audio|video)\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

/**
 * One document to ingest. `fileKind` picks the parser (bytes for pdf/docx/pptx/markdown, a
 * transcriber for video/audio); `mimeType` is required exactly for video/audio, where the
 * `Transcriber` port needs it. The processor re-reads the document row for its current
 * `storageKey`: this job names only what to parse it as, not where its bytes live now.
 */
export const IngestJobSchema = z
  .strictObject({
    teacherId: Id,
    documentId: Id,
    fileKind: IngestFileKindSchema,
    mimeType: z.string().regex(MEDIA_MIME).optional(),
  })
  .refine((j) => (j.fileKind === 'video' || j.fileKind === 'audio') === (j.mimeType !== undefined), {
    message: 'mimeType is required for video/audio and refused otherwise',
  });
export type IngestJob = z.infer<typeof IngestJobSchema>;
