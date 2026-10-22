// Task 11.1a: a teacher's live classes, attached to one or more of their own packages, and the
// scope's own upcoming, entitled classes for a student. In-app, pull-based only (decision
// B-45, 11.1 "Decision: in-app only"): no email/SMS, no background job. The window label
// (`reminder_24h` / `reminder_1h` / `starting_soon` / `later`) is computed here, in
// `listUpcomingForStudent`, from `startsAt` vs `now` — the one place it is computed (see README).
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { liveClasses, packages, packageVersions, subscriptions } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { iso } from './map.js';
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

/** `http(s)://host/path`, no whitespace, no userinfo (same shape as contracts' media.ts). */
const HTTP_URL = /^https?:\/\/[^\s/?#@\\]+(?:[/?#]\S*)?$/;

const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

const CreateInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(LIVE_CLASS_TITLE_MAX_LENGTH),
  link: z
    .string()
    .regex(HTTP_URL, 'http(s)://host/path, no userinfo')
    .pipe(z.url({ protocol: /^https?$/ })),
  startsAt: z.iso
    .datetime({ offset: true })
    .refine((s) => new Date(s).getTime() > Date.now(), 'startsAt must be in the future'),
  packageIds: z
    .array(IdSchema)
    .min(LIVE_CLASS_PACKAGE_IDS_MIN)
    .max(LIVE_CLASS_PACKAGE_IDS_MAX)
    .refine(unique, 'duplicate package id'),
});
export type CreateLiveClassInput = z.infer<typeof CreateInputSchema>;

const ListUpcomingOptionsSchema = z.strictObject({
  /** Overrides `now` for a deterministic window label in tests; the server clock otherwise. */
  now: z.iso.datetime({ offset: true }).optional(),
});
export interface ListUpcomingOptions {
  now?: string;
}

/** One of the teacher's own scheduled classes, soonest first. */
export interface TeacherLiveClassRow {
  id: string;
  title: string;
  link: string | null;
  startsAt: string;
  packageIds: string[];
}

/** One of the scope's own upcoming, entitled classes, with its window label. */
export interface UpcomingLiveClass {
  id: string;
  title: string;
  link: string | null;
  startsAt: string;
  window: LiveClassWindow;
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
     * own packages. `link` must be an http(s) URL and `startsAt` a future timestamp (`invalid`);
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

    /** The scope's own classes, soonest first. Another teacher's classes never appear. */
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
        })
        .from(liveClasses)
        .where(eq(liveClasses.teacherId, teacherId))
        .orderBy(asc(liveClasses.startsAt), asc(liveClasses.id));
      return rows.map((r) => ({ ...r, startsAt: iso(r.startsAt) }));
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

      const rows = await db
        .select({
          id: liveClasses.id,
          title: liveClasses.title,
          link: liveClasses.link,
          startsAt: liveClasses.startsAt,
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
        .orderBy(asc(liveClasses.startsAt), asc(liveClasses.id));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        link: r.link,
        startsAt: iso(r.startsAt),
        window: windowLabel(r.startsAt, now),
      }));
    },
  };
}
