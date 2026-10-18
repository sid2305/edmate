import type { Entitlement } from '@edmate/contracts';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../client.js';
import { subscriptions } from '../schema/index.js';
import { iso } from './map.js';
import { studentScope, type StudentScope } from './scope.js';

/** The fields EntitlementStore (3.2) needs from a live subscription. */
export interface LiveSubscription {
  id: string;
  packageVersionId: string;
  status: Entitlement['status'];
  periodEnd: string;
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
  };
}
