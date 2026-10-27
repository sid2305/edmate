// Task 12.2d: the staff takedowns API (ROUTE_POLICY `/api/staff/**` GET/POST, staff only). GET
// lists active takedowns (12.2b's `listActiveForStaff`); POST is a discriminated body: `create`
// takes down one document or a whole agent (12.2b's `create`, which also closes a linked open
// report), `lift` restores it (`lift`). The staff id is always the session's principal: the body
// is strict, so a `by` (or any other unknown key) is a 400, never read. Repository errors map to
// fixed codes; only the error's name is logged, never its message.
import {
  REPORT_CATEGORIES,
  RepositoryError,
  type Repositories,
  type StaffTakedownRow,
  TAKEDOWN_KINDS,
  TAKEDOWN_NOTE_MAX,
} from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { describeError } from '../../../../src/auth/describe-error';
import { apiError } from '../../../../src/auth/errors';
import type { RoleContext } from '../../../../src/auth/guard';
import { readJson, TOO_LARGE } from '../../../../src/studio/routes';

/** takedowns.create/lift's own note cap (packages/db TAKEDOWN_NOTE_MAX). */
export const MAX_NOTE_CHARS = TAKEDOWN_NOTE_MAX;

const Note = z.string().trim().min(1).max(MAX_NOTE_CHARS);

const ActBody = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    kind: z.enum(TAKEDOWN_KINDS),
    targetId: z.string().min(1).max(200),
    category: z.enum(REPORT_CATEGORIES),
    reportId: z.string().min(1).max(200).optional(),
    note: Note.optional(),
  }),
  z.strictObject({
    action: z.literal('lift'),
    takedownId: z.string().min(1).max(200),
    note: Note.optional(),
  }),
]);

export interface StaffTakedownsBackend {
  repos(): Pick<Repositories, 'takedowns'>;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
}

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  listForbidden: 'Only staff can see active takedowns.',
  actForbidden: "You can't do that.",
  notFound: 'That was not found.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createStaffTakedownsHandlers(backend: StaffTakedownsBackend): {
  list: Handler;
  act: Handler;
} {
  const log = backend.log ?? ((line: string) => console.error(line));
  const failed = (op: string, error: unknown) => {
    log(`[staff] takedowns.${op} failed: ${describeError(error)}`);
    return apiError('provider_error', MSG.failed, 500);
  };
  const mapWriteError = (error: unknown, op: string): Response => {
    if (error instanceof RepositoryError) {
      switch (error.kind) {
        case 'scope':
          return apiError('forbidden', MSG.actForbidden, 403);
        case 'not_found':
          return apiError('not_found', MSG.notFound, 404);
        case 'invalid':
        case 'integrity':
          return validation();
        case 'failed':
          break;
      }
    }
    return failed(op, error);
  };

  return {
    list: async (_req, ctx) => {
      try {
        const rows: StaffTakedownRow[] = await backend
          .repos()
          .takedowns.listActiveForStaff(ctx.principal.userId);
        return ok({ takedowns: rows });
      } catch (error) {
        if (error instanceof RepositoryError) {
          // `invalid` here can only mean the session's own id is malformed.
          if (error.kind === 'scope' || error.kind === 'invalid') {
            return apiError('forbidden', MSG.listForbidden, 403);
          }
        }
        return failed('list', error);
      }
    },

    act: async (req, ctx) => {
      const raw = await readJson(req);
      if (raw === TOO_LARGE) return apiError('input_too_large', MSG.tooLarge, 413);
      const body = ActBody.safeParse(raw);
      if (!body.success) return validation();
      const by = ctx.principal.userId;
      try {
        if (body.data.action === 'create') {
          const { kind, targetId, category, reportId, note } = body.data;
          const row = await backend.repos().takedowns.create(by, {
            kind,
            targetId,
            category,
            ...(reportId === undefined ? {} : { reportId }),
            ...(note === undefined ? {} : { note }),
          });
          return ok({ id: row.id, status: 'active' });
        }
        const { takedownId, note } = body.data;
        const row = await backend
          .repos()
          .takedowns.lift(by, takedownId, note === undefined ? {} : { note });
        return ok({ id: row.id, status: row.status });
      } catch (error) {
        return mapWriteError(error, 'act');
      }
    },
  };
}
