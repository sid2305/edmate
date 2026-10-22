import { randomUUID } from 'node:crypto';
import type { Entitlement } from '@edmate/contracts';
import { and, asc, eq, gte, inArray, ne, notExists, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { auditLog, packageVersions, subscriptions, teacherProfiles } from '../schema/index.js';
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
     * URL) — the same `not_found` a non-live package already uses. One `INSERT ... SELECT …
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
  };
}
