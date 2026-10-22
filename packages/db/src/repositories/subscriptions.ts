import { randomUUID } from 'node:crypto';
import type { Entitlement } from '@edmate/contracts';
import { and, asc, desc, eq, gte, inArray, ne, notExists, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  agents,
  auditLog,
  packages,
  packageVersions,
  subscriptions,
  teacherProfiles,
} from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { iso } from './map.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';

/** The fields EntitlementStore (3.2) needs from a live subscription. */
export interface LiveSubscription {
  id: string;
  packageVersionId: string;
  status: Entitlement['status'];
  periodEnd: string;
}

/** The automated actor the monthly cost alarm (task 2.5) writes its audit rows as. */
export const COST_ALARM_ACTOR = 'system_cost_alarm';
/** The audit action of a cost-alarm pause; also the marker that keeps a pause to once a month. */
export const COST_ALARM_PAUSE_ACTION = 'subscription.pause_cost_alarm';

export interface PauseFreeOptions {
  /** The start of the alarm's month (UTC ISO). A subscription it paused since then is skipped. */
  monthStart: string;
  /** Stored on each audit row, for example the month and threshold. No personal text. */
  reason: string;
}

/** A subscription the cost alarm paused. No student id: the result goes to the teacher. */
export interface PausedSubscription {
  subscriptionId: string;
  packageId: string;
  previousStatus: Exclude<Entitlement['status'], 'paused' | 'ended'>;
}

const PauseOptions = z.strictObject({
  monthStart: z.iso.datetime({ offset: true }),
  reason: z.string().min(1).max(500),
});

/** `subscriptions.start`'s input: the caller (9.3's no-payment start) picks status and period. */
export interface StartInput {
  packageVersionId: string;
  status: 'trial' | 'active';
  periodEnd: string;
}

const StartOptions = z.strictObject({
  packageVersionId: IdSchema,
  status: z.enum(['trial', 'active']),
  periodEnd: z.iso.datetime({ offset: true }),
});

/** Statuses a pause leaves alone: already paused (staff or alarm), or ended for good. */
const NOT_LIVE = ['paused', 'ended'] as const;

/** The statuses `changePackage` and `pause` act on; `paused` and `ended` are `invalid`. */
const LIVE_FOR_STUDENT_WRITE = ['trial', 'active', 'past_due'] as const;

/** `subscriptions.changePackage`'s input (task 9.6 Phase C; no payment, so no proration). */
export interface ChangePackageInput {
  subscriptionId: string;
  packageVersionId: string;
}
const ChangePackageOptions = z.strictObject({
  subscriptionId: IdSchema,
  packageVersionId: IdSchema,
});

/** `subscriptions.pause`, `resume` and `cancel` all take just the subscription to act on. */
export interface SubscriptionIdInput {
  subscriptionId: string;
}
const SubscriptionIdOptions = z.strictObject({ subscriptionId: IdSchema });

/** The audit action `changePackage` writes. */
export const CHANGE_PACKAGE_ACTION = 'subscription.change_package';
/** The audit action a student's own `pause` writes (distinct from `COST_ALARM_PAUSE_ACTION`). */
export const STUDENT_PAUSE_ACTION = 'subscription.pause_student';
/** The audit action `resume` writes. */
export const STUDENT_RESUME_ACTION = 'subscription.resume_student';
/** The audit action `cancel` writes. */
export const STUDENT_CANCEL_ACTION = 'subscription.cancel_student';

/** The shape every `changePackage`/`pause`/`resume`/`cancel` audit row's `before`/`after` is. */
const StatusSnapshot = z.object({
  status: z.enum(['trial', 'active', 'past_due', 'paused', 'ended']),
  packageVersionId: IdSchema,
});

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Lock order for every write in this file that takes more than one lock: **the subscription row
 * first**, `for update`, exactly as `start`'s insert-select locks `teacherProfiles` before it
 * writes — one table, locked once, before any other read in the same transaction. The four
 * student plan-change methods below (`changePackage`, `pause`, `resume`, `cancel`) never lock
 * `packages`, `package_versions` or `agents` (they only read those, for a live-version/live-agent
 * membership check that can't itself be raced into a bad write): every write here takes at most
 * the subscriptions row's lock, always first, so none of these methods — nor `start` nor
 * `pauseFreeForTeacher` above — can deadlock against each other (see "Two writers that lock the
 * same rows in different orders deadlock", docs/lessons.md).
 */
async function lockLive(
  tx: Tx,
  studentId: string,
  teacherId: string,
  subscriptionId: string,
  method: string,
): Promise<{ id: string; studentId: string; teacherId: string } & LiveSubscription> {
  const [row] = await tx
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      packageVersionId: subscriptions.packageVersionId,
      periodEnd: subscriptions.periodEnd,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.studentId, studentId),
        eq(subscriptions.teacherId, teacherId),
      ),
    )
    .for('update', { of: subscriptions });
  if (!row) throw new RepositoryError('not_found', method);
  return { ...row, periodEnd: iso(row.periodEnd), studentId, teacherId };
}

/** Writes the one audit row every plan-change method leaves behind (status + package version). */
async function writeChangeAudit(
  tx: Tx,
  method: string,
  action: string,
  live: { id: string; studentId: string; teacherId: string },
  before: { status: Entitlement['status']; packageVersionId: string },
  after: { status: Entitlement['status']; packageVersionId: string },
): Promise<void> {
  await insertAuditEntry(tx, method, live.teacherId, live.studentId, {
    actor: live.studentId,
    actorRole: 'student',
    action,
    target: `subscription:${live.id}`,
    before,
    after,
  });
}

export function subscriptionsRepo(db: Db) {
  return {
    /** The scope's subscription that has not ended (at most one per student x teacher), or null. */
    async findLive(scope: StudentScope): Promise<LiveSubscription | null> {
      const method = 'subscriptions.findLive';
      const { studentId, teacherId } = studentScope(scope, method);
      const [row] = await db
        .select({
          id: subscriptions.id,
          packageVersionId: subscriptions.packageVersionId,
          status: subscriptions.status,
          periodEnd: subscriptions.periodEnd,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.studentId, studentId),
            eq(subscriptions.teacherId, teacherId),
            ne(subscriptions.status, 'ended'),
          ),
        )
        .limit(1);
      return row ? { ...row, periodEnd: iso(row.periodEnd) } : null;
    },

    /**
     * Starts a subscription with no payment (task 9.3; checkout is 10.8): the scope's student
     * subscribes to one of the scope's teacher's package versions. The write only lands when
     * `packageVersionId` names a `package_versions` row of this teacher (else `not_found` — a
     * stray or another teacher's id never writes), and only when that teacher is currently
     * verified (task 9.3c: a teacher rejected after publishing can't be started by typing the
     * URL) — the same `not_found` a non-live package already uses. Task 9.3b/9.6: the version
     * must also be its package's **live** version, of a **live** agent (a draft or old version,
     * or a suspended agent's package, is `not_found` — the same check `changePackage` makes
     * below, so a URL built from an old offer never starts anything). One `INSERT ... SELECT …
     * FOR SHARE` statement (already this method's whole transaction): the `teacherProfiles` row
     * is read FOR SHARE as part of the very statement that writes the subscription, so a
     * verification change can only land strictly before or after it, never mid-write.
     */
    async start(scope: StudentScope, input: StartInput): Promise<LiveSubscription> {
      const method = 'subscriptions.start';
      const { studentId, teacherId } = studentScope(scope, method);
      const i = parseArg(StartOptions, input, method);
      const id = randomUUID();

      return translateWrite(method, async () => {
        const result = await db.execute(
          insertSelect(
            subscriptions,
            [
              [subscriptions.id, sql`${id}::text`],
              [subscriptions.studentId, sql`${studentId}::text`],
              [subscriptions.teacherId, sql`${packageVersions.teacherId}`],
              [subscriptions.packageVersionId, sql`${packageVersions.id}`],
              [subscriptions.status, sql`${i.status}::subscription_status`],
              [subscriptions.periodEnd, sql`${new Date(i.periodEnd)}::timestamptz`],
            ],
            sql`from ${packageVersions}
              inner join ${teacherProfiles} on ${and(
                eq(teacherProfiles.userId, packageVersions.teacherId),
                eq(teacherProfiles.verificationStatus, 'verified'),
              )}
              inner join ${packages} on ${and(
                eq(packages.id, packageVersions.packageId),
                eq(packages.liveVersion, packageVersions.version),
              )}
              inner join ${agents} on ${and(eq(agents.id, packages.agentId), eq(agents.status, 'live'))}
              where ${and(
                eq(packageVersions.id, i.packageVersionId),
                eq(packageVersions.teacherId, teacherId),
              )}
              for share of ${teacherProfiles}`,
          ),
        );
        if (written(result) !== 1) throw new RepositoryError('not_found', method);
        return { id, packageVersionId: i.packageVersionId, status: i.status, periodEnd: i.periodEnd };
      });
    },

    /**
     * The monthly cost alarm's effect (task 2.5): pauses every live (trial, active, past_due)
     * subscription of the scope's teacher whose package version is free (`pricePerMonth.amountMinor`
     * = 0), and writes one `system` audit row per pause in the same transaction. Paid
     * subscriptions are never touched; neither are ended or already paused ones. A subscription
     * the alarm already paused since `monthStart` is skipped, so a staff unpause holds for the
     * rest of the month. Returns what it paused, ordered by id.
     */
    async pauseFreeForTeacher(
      scope: TeacherScope,
      options: PauseFreeOptions,
    ): Promise<PausedSubscription[]> {
      const method = 'subscriptions.pauseFreeForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const opts = parseArg(PauseOptions, options, method);
      const monthStart = new Date(opts.monthStart);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const alreadyPaused = tx
            .select({ one: sql`1` })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.teacherId, teacherId),
                eq(auditLog.action, COST_ALARM_PAUSE_ACTION),
                eq(auditLog.target, sql`'subscription:' || ${subscriptions.id}`),
                gte(auditLog.ts, monthStart),
              ),
            );
          // FOR UPDATE: a concurrent run waits, then sees `paused` and skips the row.
          const due = await tx
            .select({
              id: subscriptions.id,
              studentId: subscriptions.studentId,
              status: subscriptions.status,
              packageId: packageVersions.packageId,
            })
            .from(subscriptions)
            .innerJoin(
              packageVersions,
              and(
                eq(packageVersions.id, subscriptions.packageVersionId),
                eq(packageVersions.teacherId, subscriptions.teacherId),
              ),
            )
            .where(
              and(
                eq(subscriptions.teacherId, teacherId),
                notInArray(subscriptions.status, [...NOT_LIVE]),
                // Free is a PackageConfig fact (contracts: amountMinor 0 = free package).
                sql`${packageVersions.config} -> 'pricePerMonth' -> 'amountMinor' = '0'::jsonb`,
                notExists(alreadyPaused),
              ),
            )
            .orderBy(asc(subscriptions.id))
            .for('update', { of: subscriptions });
          if (due.length === 0) return [];

          // The rows are locked by this transaction, so every one of them is updated.
          await tx
            .update(subscriptions)
            .set({ status: 'paused' })
            .where(
              and(
                eq(subscriptions.teacherId, teacherId),
                inArray(
                  subscriptions.id,
                  due.map((d) => d.id),
                ),
              ),
            );

          const paused: PausedSubscription[] = [];
          for (const d of due) {
            // The WHERE above excludes paused and ended.
            const previousStatus = d.status as PausedSubscription['previousStatus'];
            await insertAuditEntry(tx, method, teacherId, d.studentId, {
              actor: COST_ALARM_ACTOR,
              actorRole: 'system',
              action: COST_ALARM_PAUSE_ACTION,
              target: `subscription:${d.id}`,
              reason: opts.reason,
              before: { status: previousStatus },
              after: { status: 'paused' },
            });
            paused.push({ subscriptionId: d.id, packageId: d.packageId, previousStatus });
          }
          return paused;
        }),
      );
    },

    /**
     * Switches the scope's live subscription to another package version of the **same agent**
     * (task 9.6 Phase C; checkout and proration are 10.8/10.3). The target must be the **live**
     * version (`packages.live_version`) of a package of this teacher and this agent, and that
     * agent must be `live` — a draft or old version, another teacher's version, or a suspended
     * agent's package is `not_found`, same as `start`. The current subscription must be `trial`,
     * `active` or `past_due` (`paused`/`ended` is `invalid`); the same version as now is also
     * `invalid` (nothing to change). `status` and `period_end` are kept: there is no payment yet,
     * so neither proration nor a new billing period exists (9.6's Q1 = (a), until 10.3).
     */
    async changePackage(
      scope: StudentScope,
      input: ChangePackageInput,
    ): Promise<LiveSubscription> {
      const method = 'subscriptions.changePackage';
      const { studentId, teacherId } = studentScope(scope, method);
      const i = parseArg(ChangePackageOptions, input, method);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const live = await lockLive(tx, studentId, teacherId, i.subscriptionId, method);
          if (!LIVE_FOR_STUDENT_WRITE.includes(live.status as (typeof LIVE_FOR_STUDENT_WRITE)[number])) {
            throw new RepositoryError('invalid', method);
          }
          if (live.packageVersionId === i.packageVersionId) {
            throw new RepositoryError('invalid', method);
          }
          const [current] = await tx
            .select({ agentId: packages.agentId })
            .from(packageVersions)
            .innerJoin(packages, eq(packages.id, packageVersions.packageId))
            .where(eq(packageVersions.id, live.packageVersionId));
          // Integrity, not not_found: the subscription's own current version must exist. The FK
          // on subscriptions.package_version_id (via package_versions.package_id -> packages)
          // makes this unreachable in practice; kept so a future FK relaxation fails closed.
          /* v8 ignore next -- see above */
          if (!current) throw new RepositoryError('integrity', method);

          const [target] = await tx
            .select({ id: packageVersions.id })
            .from(packageVersions)
            .innerJoin(
              packages,
              and(
                eq(packages.id, packageVersions.packageId),
                eq(packages.liveVersion, packageVersions.version),
                eq(packages.agentId, current.agentId),
              ),
            )
            .innerJoin(agents, and(eq(agents.id, packages.agentId), eq(agents.status, 'live')))
            .where(
              and(
                eq(packageVersions.id, i.packageVersionId),
                eq(packageVersions.teacherId, live.teacherId),
              ),
            );
          if (!target) throw new RepositoryError('not_found', method);

          await tx
            .update(subscriptions)
            .set({ packageVersionId: i.packageVersionId })
            .where(eq(subscriptions.id, live.id));
          await writeChangeAudit(
            tx,
            method,
            CHANGE_PACKAGE_ACTION,
            live,
            { status: live.status, packageVersionId: live.packageVersionId },
            { status: live.status, packageVersionId: i.packageVersionId },
          );
          return { id: live.id, packageVersionId: i.packageVersionId, status: live.status, periodEnd: live.periodEnd };
        }),
      );
    },

    /**
     * A student pausing their own subscription (task 9.6 Phase C; the cost alarm's own pause is
     * `pauseFreeForTeacher` above, audited separately so `resume` can tell them apart). `trial`,
     * `active` or `past_due` become `paused`; already `paused` (by the student, the cost alarm or
     * any future staff action) or `ended` is `invalid`.
     */
    async pause(scope: StudentScope, input: SubscriptionIdInput): Promise<LiveSubscription> {
      const method = 'subscriptions.pause';
      const { studentId, teacherId } = studentScope(scope, method);
      const i = parseArg(SubscriptionIdOptions, input, method);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const live = await lockLive(tx, studentId, teacherId, i.subscriptionId, method);
          if (!LIVE_FOR_STUDENT_WRITE.includes(live.status as (typeof LIVE_FOR_STUDENT_WRITE)[number])) {
            throw new RepositoryError('invalid', method);
          }
          await tx
            .update(subscriptions)
            .set({ status: 'paused' })
            .where(eq(subscriptions.id, live.id));
          await writeChangeAudit(
            tx,
            method,
            STUDENT_PAUSE_ACTION,
            live,
            { status: live.status, packageVersionId: live.packageVersionId },
            { status: 'paused', packageVersionId: live.packageVersionId },
          );
          return { id: live.id, packageVersionId: live.packageVersionId, status: 'paused', periodEnd: live.periodEnd };
        }),
      );
    },

    /**
     * Undoes the student's own pause (task 9.6 Phase C, Q6): only a pause this student made
     * (`STUDENT_PAUSE_ACTION`) can be undone by them. The cost alarm's pause, any future staff
     * pause, or a paused row with no audit row at all, is `invalid` — the plan page shows a
     * fixed "paused by Edmate" text for those instead of a resume button. Not currently `paused`
     * is also `invalid`. Resume restores the status the latest own-pause audit row's `before`
     * names; `period_end` never moves (no payment yet).
     */
    async resume(scope: StudentScope, input: SubscriptionIdInput): Promise<LiveSubscription> {
      const method = 'subscriptions.resume';
      const { studentId, teacherId } = studentScope(scope, method);
      const i = parseArg(SubscriptionIdOptions, input, method);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const live = await lockLive(tx, studentId, teacherId, i.subscriptionId, method);
          if (live.status !== 'paused') throw new RepositoryError('invalid', method);

          const [lastPause] = await tx
            .select({ action: auditLog.action, before: auditLog.before })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.target, `subscription:${live.id}`),
                eq(auditLog.teacherId, live.teacherId),
                eq(auditLog.studentId, live.studentId),
              ),
            )
            .orderBy(desc(auditLog.ts), desc(auditLog.id))
            .limit(1);
          if (!lastPause || lastPause.action !== STUDENT_PAUSE_ACTION) {
            throw new RepositoryError('invalid', method);
          }
          const parsed = StatusSnapshot.safeParse(lastPause.before);
          if (!parsed.success) throw new RepositoryError('integrity', method);
          const restored = parsed.data.status;
          if (restored === 'paused' || restored === 'ended') {
            throw new RepositoryError('integrity', method);
          }

          await tx
            .update(subscriptions)
            .set({ status: restored })
            .where(eq(subscriptions.id, live.id));
          await writeChangeAudit(
            tx,
            method,
            STUDENT_RESUME_ACTION,
            live,
            { status: 'paused', packageVersionId: live.packageVersionId },
            { status: restored, packageVersionId: live.packageVersionId },
          );
          return { id: live.id, packageVersionId: live.packageVersionId, status: restored, periodEnd: live.periodEnd };
        }),
      );
    },

    /**
     * Cancels the scope's live subscription (task 9.6 Phase C): any live status (`trial`,
     * `active`, `past_due` or `paused`) becomes `ended` at once (9.6's Q1 = (a); 10.3 moves this
     * to period end once a provider exists). `ended` already is `invalid`. After it, `findLive`
     * is `null` and `start` succeeds again for the pair.
     */
    async cancel(scope: StudentScope, input: SubscriptionIdInput): Promise<LiveSubscription> {
      const method = 'subscriptions.cancel';
      const { studentId, teacherId } = studentScope(scope, method);
      const i = parseArg(SubscriptionIdOptions, input, method);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const live = await lockLive(tx, studentId, teacherId, i.subscriptionId, method);
          if (live.status === 'ended') throw new RepositoryError('invalid', method);
          await tx
            .update(subscriptions)
            .set({ status: 'ended' })
            .where(eq(subscriptions.id, live.id));
          await writeChangeAudit(
            tx,
            method,
            STUDENT_CANCEL_ACTION,
            live,
            { status: live.status, packageVersionId: live.packageVersionId },
            { status: 'ended', packageVersionId: live.packageVersionId },
          );
          return { id: live.id, packageVersionId: live.packageVersionId, status: 'ended', periodEnd: live.periodEnd };
        }),
      );
    },
  };
}
