// Task 12.5c: the staff alert inbox API (ROUTE_POLICY `/api/staff/**`, staff only). GET lists
// alerts for the session's own staff id (12.5a's `listForStaff`), with `overdue` computed from
// `@edmate/queue`'s `ALERT_ESCALATION_MS` as a backstop for a stopped worker (an alert whose
// `createdAt` is at least that old and still unacknowledged, even if the worker never marked it
// escalated). POST acknowledges one alert through `acknowledge`, which writes the
// `safety_alert.ack` audit row in the same transaction (12.5a). The staff id is always the
// session's principal: the body is a strict object, so a `by` (or any other unknown key) is a
// 400, never read. Repository errors map to fixed codes; only the error's name is logged, never
// its message or the excerpt (both can hold sensitive text).
import {
  RepositoryError,
  SAFETY_ALERT_LIST_MAX_LIMIT,
  SAFETY_ALERT_NOTE_MAX_LENGTH,
  type Repositories,
  type SafetyAlertRow,
} from '@edmate/db';
import { ALERT_ESCALATION_MS } from '@edmate/queue';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { describeError } from '../../../../src/auth/describe-error';
import { apiError } from '../../../../src/auth/errors';
import type { RoleContext } from '../../../../src/auth/guard';
import { readJson, TOO_LARGE } from '../../../../src/studio/routes';

const StatusQuery = z.enum(['open', 'all']);

const AckBody = z.strictObject({
  alertId: z.string().min(1).max(200),
  note: z.string().trim().min(1).max(SAFETY_ALERT_NOTE_MAX_LENGTH).optional(),
});

/** One alert as the API returns it: the repository row plus the overdue backstop. */
export interface AlertView {
  id: string;
  level: SafetyAlertRow['level'];
  kind: SafetyAlertRow['kind'];
  studentId: string;
  teacherId: string;
  sessionId: string;
  teacherSlug: string | null;
  excerptRedacted: string;
  createdAt: string;
  receivedAt: string;
  escalatedAt: string | null;
  escalationRound: number;
  lastPagedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
  overdue: boolean;
}

/** Unacknowledged and at least `ALERT_ESCALATION_MS` old, even if the worker never marked it. */
export function toAlertView(row: SafetyAlertRow, now: number): AlertView {
  const overdue =
    row.acknowledgedAt === null && now - new Date(row.createdAt).getTime() >= ALERT_ESCALATION_MS;
  return { ...row, overdue };
}

export interface StaffAlertBackend {
  repos(): Pick<Repositories, 'safetyAlerts'>;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
  /** Overridable clock for the overdue backstop; defaults to `Date.now`. */
  now?(): number;
}

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  listForbidden: 'Only staff can see the alert inbox.',
  ackForbidden: "You can't acknowledge this alert: your staff access may have changed.",
  notFound: 'That alert was not found.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createStaffAlertHandlers(backend: StaffAlertBackend): {
  list: Handler;
  acknowledge: Handler;
} {
  const log = backend.log ?? ((line: string) => console.error(line));
  const now = backend.now ?? (() => Date.now());
  const failed = (op: string, error: unknown) => {
    log(`[staff] alerts.${op} failed: ${describeError(error)}`);
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    list: async (req, ctx) => {
      const raw = new URL(req.url).searchParams.get('status') ?? 'open';
      const status = StatusQuery.safeParse(raw);
      if (!status.success) return validation();
      try {
        const rows = await backend.repos().safetyAlerts.listForStaff(ctx.principal.userId, {
          status: status.data,
          limit: SAFETY_ALERT_LIST_MAX_LIMIT,
        });
        return ok({ alerts: rows.map((r) => toAlertView(r, now())) });
      } catch (error) {
        if (error instanceof RepositoryError) {
          // `invalid` / `not_found` here can only mean the session's own id is not a staff user.
          if (error.kind === 'scope' || error.kind === 'invalid' || error.kind === 'not_found') {
            return apiError('forbidden', MSG.listForbidden, 403);
          }
        }
        return failed('list', error);
      }
    },

    acknowledge: async (req, ctx) => {
      const body = await readJson(req);
      if (body === TOO_LARGE) return apiError('input_too_large', MSG.tooLarge, 413);
      const parsed = AckBody.safeParse(body);
      if (!parsed.success) return validation();
      const { alertId, note } = parsed.data;
      try {
        const result = await backend.repos().safetyAlerts.acknowledge(ctx.principal.userId, {
          alertId,
          ...(note === undefined ? {} : { note }),
        });
        return ok({ alertId, acknowledged: result.acknowledged });
      } catch (error) {
        if (error instanceof RepositoryError) {
          switch (error.kind) {
            case 'scope':
              return apiError('forbidden', MSG.ackForbidden, 403);
            case 'not_found':
              return apiError('not_found', MSG.notFound, 404);
            case 'invalid':
            case 'integrity':
              return validation();
            case 'failed':
              break;
          }
        }
        return failed('acknowledge', error);
      }
    },
  };
}
