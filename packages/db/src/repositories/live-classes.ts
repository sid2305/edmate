// Task 11.1a: a teacher's live classes, attached to one or more of their own packages, and the
// scope's own upcoming, entitled classes for a student. In-app, pull-based only (decision
// B-45, 11.1 "Decision: in-app only"): no email/SMS, no background job. The window label
// (`reminder_24h` / `reminder_1h` / `starting_soon` / `later`) is computed here, in
// `listUpcomingForStudent`, from `startsAt` vs `now` — the one place it is computed (see README).
// Task 11.1d: `status` (`scheduled` | `cancelled`), `update` and `cancel` before a class starts;
// a cancelled class stays visible (status shown, nothing dropped) — see the task's own README note.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  documents,
  liveClasses,
  packages,
  packageVersions,
  subscriptions,
} from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { type DocumentStatus, iso } from './map.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Longest live-class title. */
export const LIVE_CLASS_TITLE_MAX_LENGTH = 200;
/** Fewest and most packages a class may be attached to. */
export const LIVE_CLASS_PACKAGE_IDS_MIN = 1;
export const LIVE_CLASS_PACKAGE_IDS_MAX = 20;
/** Longest `link`, in characters (same cap the studio route already enforces in front of this). */
export const LIVE_CLASS_LINK_MAX_LENGTH = 2048;
/** Most rows one `listForTeacher` / `listUpcomingForStudent` call returns (`RECORDING_LIST_MAX` precedent). */
export const LIVE_CLASS_LIST_MAX = 500;

/** Subscription statuses that entitle a student to a reminder (lead answer, 22 Oct 2026, Q2). */
const LIVE_SUBSCRIPTION_STATUSES = ['trial', 'active'] as const;

/** How close `startsAt` is to `now`. Computed once, here (see file header). */
export type LiveClassWindow = 'reminder_24h' | 'reminder_1h' | 'starting_soon' | 'later';

/** Inside this many ms of `startsAt`: "starting soon" (the start, not just the reminder). */
const STARTING_SOON_MS = 5 * 60 * 1000;
const REMINDER_1H_MS = 60 * 60 * 1000;
const REMINDER_24H_MS = 24 * 60 * 60 * 1000;

function windowLabel(startsAt: Date, now: Date): LiveClassWindow {
  const diff = startsAt.getTime() - now.getTime();
  if (diff <= STARTING_SOON_MS) return 'starting_soon';
  if (diff <= REMINDER_1H_MS) return 'reminder_1h';
  if (diff <= REMINDER_24H_MS) return 'reminder_24h';
  return 'later';
}

/**
 * `https://host/path`, no whitespace, no userinfo (11.1a/11.1c review: http is no longer
 * accepted). The length cap runs before the regex not for speed (zod v4's chained
 * `.max().regex()` does not short-circuit on the first failure) but so the length error, not the
 * shape error, is the one reported first when both are violated.
 */
const HTTPS_URL = /^https:\/\/[^\s/?#@\\]+(?:[/?#]\S*)?$/;

const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

/** Shared title/link/startsAt field schemas, used by both `create` and `update` (11.1a review). */
const TitleSchema = z.string().trim().min(1).max(LIVE_CLASS_TITLE_MAX_LENGTH);
const LinkSchema = z
  .string()
  .max(LIVE_CLASS_LINK_MAX_LENGTH)
  .regex(HTTPS_URL, 'https://host/path, no userinfo')
  .pipe(z.url({ protocol: /^https$/ }));
const StartsAtSchema = z.iso
  .datetime({ offset: true })
  .refine((s) => new Date(s).getTime() > Date.now(), 'startsAt must be in the future');

const CreateInputSchema = z.strictObject({
  title: TitleSchema,
  link: LinkSchema,
  startsAt: StartsAtSchema,
  packageIds: z
    .array(IdSchema)
    .min(LIVE_CLASS_PACKAGE_IDS_MIN)
    .max(LIVE_CLASS_PACKAGE_IDS_MAX)
    .refine(unique, 'duplicate package id'),
});
export type CreateLiveClassInput = z.infer<typeof CreateInputSchema>;

/** `update`'s input: title/link/startsAt only — no `packageIds` (not part of this task). */
const UpdateInputSchema = z.strictObject({
  title: TitleSchema,
  link: LinkSchema,
  startsAt: StartsAtSchema,
});
export type UpdateLiveClassInput = z.infer<typeof UpdateInputSchema>;

const ListUpcomingOptionsSchema = z.strictObject({
  /** Overrides `now` for a deterministic window label in tests; the server clock otherwise. */
  now: z.iso.datetime({ offset: true }).optional(),
});
export interface ListUpcomingOptions {
  now?: string;
}

/** Whether a class is still on, or the teacher cancelled it (task 11.1d). */
export type LiveClassStatus = 'scheduled' | 'cancelled';
const LiveClassStatusSchema = z.enum(['scheduled', 'cancelled']);
/** Checked parse of a `live_classes.status` column value, reused by both list methods below. */
function parseStatus(x: unknown, method: string): LiveClassStatus {
  return parseArg(LiveClassStatusSchema, x, method);
}

/** One of the teacher's own scheduled classes, soonest first. */
export interface TeacherLiveClassRow {
  id: string;
  title: string;
  link: string | null;
  startsAt: string;
  packageIds: string[];
  status: LiveClassStatus;
}

/** Most rows one `liveClasses.listRecordingsForTeacher` call returns (`DOCUMENT_LIST_MAX` precedent). */
export const RECORDING_LIST_MAX = 500;

/** Task 11.4a: one document linked to one of the teacher's own live classes. */
export interface LiveClassRecording {
  liveClassId: string;
  documentId: string;
  sourceTitle: string;
  status: DocumentStatus;
  /** A fixed failure code; only when `status` is `failed`. */
  failureReason?: string;
}

/** One of the scope's own upcoming, entitled classes, with its window label. */
export interface UpcomingLiveClass {
  id: string;
  title: string;
  link: string | null;
  startsAt: string;
  window: LiveClassWindow;
  status: LiveClassStatus;
}

/**
 * Every id in `packageIds` must be one of the scope's own packages, key-share locked so none is
 * deleted before the insert commits (same shape as `packages.ts`'s `checkModules` / outline's
 * named-module check). Otherwise `not_found`: nothing is written.
 */
async function checkOwnPackages(
  tx: Tx,
  teacherId: string,
  packageIds: readonly string[],
  method: string,
) {
  const unique_ = [...new Set(packageIds)];
  const mine = await tx
    .select({ id: packages.id })
    .from(packages)
    .where(and(eq(packages.teacherId, teacherId), inArray(packages.id, unique_)))
    .for('key share');
  if (mine.length !== unique_.length) throw new RepositoryError('not_found', method);
}

export function liveClassesRepo(db: Db) {
  return {
    /**
     * Schedules one of the scope's teacher's live classes, attached to 1..20 of that teacher's
     * own packages. `link` must be an https URL, at most `LIVE_CLASS_LINK_MAX_LENGTH` characters,
     * and `startsAt` a future timestamp (`invalid`);
     * any package id that is not the scope's own is `not_found` and nothing is written. Writes
     * one `live_class.schedule` audit row (`after`: title, startsAt, packageIds).
     */
    async create(scope: TeacherScope, input: CreateLiveClassInput): Promise<{ id: string }> {
      const method = 'liveClasses.create';
      const { teacherId } = teacherScope(scope, method);
      const i = parseArg(CreateInputSchema, input, method);
      const id = randomUUID();

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await checkOwnPackages(tx, teacherId, i.packageIds, method);
          await tx.insert(liveClasses).values({
            id,
            teacherId,
            title: i.title,
            link: i.link,
            startsAt: new Date(i.startsAt),
            packageIds: i.packageIds,
          });
          await insertAuditEntry(tx, method, teacherId, null, {
            actor: teacherId,
            actorRole: 'teacher',
            action: 'live_class.schedule',
            target: `live_class:${id}`,
            after: { title: i.title, startsAt: i.startsAt, packageIds: i.packageIds },
          });
          return { id };
        }),
      );
    },

    /**
     * The scope's own classes, soonest first. Another teacher's classes never appear. Past the
     * `LIVE_CLASS_LIST_MAX` cap, the kept rows are the ones with the furthest-out `startsAt`
     * (ordered descending for the query, then re-sorted ascending for return) so a teacher who
     * schedules a new class far in the future never has it silently dropped in favour of classes
     * closer to `now` (11.1d review LOW; lead answer, 25 Oct 2026, Q1).
     */
    async listForTeacher(scope: TeacherScope): Promise<TeacherLiveClassRow[]> {
      const method = 'liveClasses.listForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const rows = await db
        .select({
          id: liveClasses.id,
          title: liveClasses.title,
          link: liveClasses.link,
          startsAt: liveClasses.startsAt,
          packageIds: liveClasses.packageIds,
          status: liveClasses.status,
        })
        .from(liveClasses)
        .where(eq(liveClasses.teacherId, teacherId))
        .orderBy(desc(liveClasses.startsAt), desc(liveClasses.id))
        .limit(LIVE_CLASS_LIST_MAX);
      return rows
        .map((r) => ({
          ...r,
          startsAt: iso(r.startsAt),
          status: parseStatus(r.status, method),
        }))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    },

    /**
     * Task 11.4a: the scope's own documents linked to one of its own live classes (recordings,
     * transcripts, captions), newest first, at most `RECORDING_LIST_MAX`. One query: documents of
     * the scope joined to live classes of the same teacher, so another teacher's rows never appear.
     * `status` is display only (never a retrieval gate); `failureReason` only when `failed`.
     */
    async listRecordingsForTeacher(scope: TeacherScope): Promise<LiveClassRecording[]> {
      const method = 'liveClasses.listRecordingsForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const rows = await db
        .select({
          liveClassId: liveClasses.id,
          documentId: documents.id,
          sourceTitle: documents.sourceTitle,
          status: documents.status,
          failureReason: documents.failureReason,
        })
        .from(documents)
        .innerJoin(
          liveClasses,
          and(eq(liveClasses.id, documents.liveClassId), eq(liveClasses.teacherId, teacherId)),
        )
        .where(and(eq(documents.teacherId, teacherId), isNotNull(documents.liveClassId)))
        .orderBy(desc(documents.createdAt), desc(documents.id))
        .limit(RECORDING_LIST_MAX);
      return rows.map((r) => ({
        liveClassId: r.liveClassId,
        documentId: r.documentId,
        sourceTitle: r.sourceTitle,
        status: r.status,
        ...(r.failureReason === null ? {} : { failureReason: r.failureReason }),
      }));
    },

    /**
     * The scope's own teacher's classes that have not started, attached to the base package of
     * the scope's own live (`trial` / `active`) subscription only; `paused`, `past_due` and
     * `ended` subscriptions, and classes with no live subscription to an attached package, see
     * nothing. Soonest first, each with its window label computed from `startsAt` vs `now`
     * (`options.now` overrides the server clock, for deterministic tests only).
     */
    async listUpcomingForStudent(
      scope: StudentScope,
      options?: ListUpcomingOptions,
    ): Promise<UpcomingLiveClass[]> {
      const method = 'liveClasses.listUpcomingForStudent';
      const { studentId, teacherId } = studentScope(scope, method);
      const opts = parseArg(ListUpcomingOptionsSchema, options ?? {}, method);
      const now = opts.now ? new Date(opts.now) : new Date();

      // `.selectDistinct` collapses the duplicate row a student with two live subscriptions whose
      // packages both overlap the class's `packageIds` would otherwise get from this join — one of
      // the selected columns per class, not one per qualifying subscription (11.1a review LOW).
      const rows = await db
        .selectDistinct({
          id: liveClasses.id,
          title: liveClasses.title,
          link: liveClasses.link,
          startsAt: liveClasses.startsAt,
          status: liveClasses.status,
        })
        .from(liveClasses)
        .innerJoin(
          subscriptions,
          and(
            eq(subscriptions.teacherId, liveClasses.teacherId),
            eq(subscriptions.studentId, studentId),
          ),
        )
        .innerJoin(packageVersions, eq(packageVersions.id, subscriptions.packageVersionId))
        .where(
          and(
            eq(liveClasses.teacherId, teacherId),
            gt(liveClasses.startsAt, now),
            inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
            sql`${packageVersions.packageId} = any(${liveClasses.packageIds})`,
          ),
        )
        .orderBy(asc(liveClasses.startsAt), asc(liveClasses.id))
        .limit(LIVE_CLASS_LIST_MAX);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        // A cancelled class stays visible (status shown) but the join link itself is dropped here,
        // not just hidden client-side, so a cancelled class never hands a student a live link to
        // join (11.1d review LOW).
        link: r.status === 'cancelled' ? null : r.link,
        startsAt: iso(r.startsAt),
        window: windowLabel(r.startsAt, now),
        status: parseStatus(r.status, method),
      }));
    },

    /**
     * Edits one of the scope's own classes' title/link/startsAt, only before it starts. Locks the
     * row `FOR UPDATE` by id and teacherId first: another teacher's or a missing id is `not_found`
     * before any other check. A cancelled class, or one whose own (current) `startsAt` is no
     * longer in the future, is `invalid` — read inside the same lock, never the caller's value.
     * Writes one `live_class.update` audit row (`title`/`link`/`startsAt`, before and after).
     */
    async update(
      scope: TeacherScope,
      id: string,
      input: UpdateLiveClassInput,
    ): Promise<{ updated: true }> {
      const method = 'liveClasses.update';
      const { teacherId } = teacherScope(scope, method);
      const classId = parseArg(IdSchema, id, method);
      const i = parseArg(UpdateInputSchema, input, method);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .select({
              status: liveClasses.status,
              startsAt: liveClasses.startsAt,
              title: liveClasses.title,
              link: liveClasses.link,
            })
            .from(liveClasses)
            .where(and(eq(liveClasses.id, classId), eq(liveClasses.teacherId, teacherId)))
            .for('update');
          if (!row) throw new RepositoryError('not_found', method);
          if (row.status === 'cancelled' || row.startsAt.getTime() <= Date.now()) {
            throw new RepositoryError('invalid', method);
          }
          await tx
            .update(liveClasses)
            .set({ title: i.title, link: i.link, startsAt: new Date(i.startsAt) })
            .where(and(eq(liveClasses.id, classId), eq(liveClasses.teacherId, teacherId)));
          await insertAuditEntry(tx, method, teacherId, null, {
            actor: teacherId,
            actorRole: 'teacher',
            action: 'live_class.update',
            target: `live_class:${classId}`,
            before: { title: row.title, link: row.link, startsAt: iso(row.startsAt) },
            after: { title: i.title, link: i.link, startsAt: iso(new Date(i.startsAt)) },
          });
          return { updated: true };
        }),
      );
    },

    /**
     * Cancels one of the scope's own classes. Same lock and `not_found` shape as `update`. Already
     * `'cancelled'` is an idempotent no-op (`{ cancelled: false }`, nothing written, no audit row —
     * a double-click Cancel must not error). `'scheduled'` but no longer in the future is
     * `invalid` (the class already happened). Otherwise sets `status = 'cancelled'` and writes one
     * `live_class.cancel` audit row.
     */
    async cancel(scope: TeacherScope, id: string): Promise<{ cancelled: boolean }> {
      const method = 'liveClasses.cancel';
      const { teacherId } = teacherScope(scope, method);
      const classId = parseArg(IdSchema, id, method);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .select({ status: liveClasses.status, startsAt: liveClasses.startsAt })
            .from(liveClasses)
            .where(and(eq(liveClasses.id, classId), eq(liveClasses.teacherId, teacherId)))
            .for('update');
          if (!row) throw new RepositoryError('not_found', method);
          if (row.status === 'cancelled') return { cancelled: false };
          if (row.startsAt.getTime() <= Date.now()) {
            throw new RepositoryError('invalid', method);
          }
          await tx
            .update(liveClasses)
            .set({ status: 'cancelled' })
            .where(and(eq(liveClasses.id, classId), eq(liveClasses.teacherId, teacherId)));
          await insertAuditEntry(tx, method, teacherId, null, {
            actor: teacherId,
            actorRole: 'teacher',
            action: 'live_class.cancel',
            target: `live_class:${classId}`,
            before: { status: 'scheduled' },
            after: { status: 'cancelled' },
          });
          return { cancelled: true };
        }),
      );
    },
  };
}
