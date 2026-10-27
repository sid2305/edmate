// Task 13.4b (13.4 Phase C): one account-wide export across every teacher the signed-in student
// has subscribed to, beside the per-agent export (9.6b, `GET /api/me/export/:agentId`). Aggregates
// `buildExport()` for each live pair (`subscriptions.listLiveForStudent`, which is already scoped
// to the caller's own studentId -- never a client-given id) plus the student's own identity
// fields. Never includes consents: no read method for them exists yet, and
// `packages/db/src/identity/store.ts` is out of bounds for this task (another builder is in that
// file) -- see the handoff's `## Decisions`. Like `buildExport`, this never reads `help_state`,
// turn traces, usage/cost, safety events, audit rows or payments: those stay out by never being
// read here at all, not by filtering a bigger read after the fact.
import type { IdentityUser } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { serverDatabase } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { buildExport, type ExportBackend, type ExportJson } from './buildExport';

/** One of the student's live subscription pairs (`subscriptions.listLiveForStudent`). */
export interface SubscriptionPair {
  agentId: string;
  teacherId: string;
  status: string;
}

/** The account-level fields this export shows: the student's own identity, minus internal ids. */
export interface AccountFields {
  name: string;
  email: string | null;
  emailVerifiedAt: string | null;
}

export interface AccountExportBackend extends ExportBackend {
  subscriptionPairs: {
    /** Call only with the signed-in principal's own id (never a client-given one). */
    listLiveForStudent(studentId: string): Promise<SubscriptionPair[]>;
  };
  identity: {
    getUser(userId: string): Promise<IdentityUser | null>;
  };
}

export interface AccountExportJson {
  format: 'edmate-account-export';
  version: 1;
  exportedAt: string;
  complete: boolean;
  /** Named sections that hit a read cap and so may be missing rows; never silently complete. */
  truncated: string[];
  account: AccountFields | null;
  teachers: Array<{ teacherId: string; agentId: string; status: string; export: ExportJson }>;
}

function accountFields(user: IdentityUser | null): AccountFields | null {
  if (user === null) return null;
  return {
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt === null ? null : user.emailVerifiedAt.toISOString(),
  };
}

/** Builds the account-wide export. `now` is the caller's clock (testable, no `Date.now` inside). */
export async function buildAccountExport(
  backend: AccountExportBackend,
  studentId: string,
  now: string,
): Promise<AccountExportJson> {
  const [pairs, user] = await Promise.all([
    backend.subscriptionPairs.listLiveForStudent(studentId),
    backend.identity.getUser(studentId),
  ]);

  const truncated: string[] = [];
  const teachers = await Promise.all(
    pairs.map(async (pair) => {
      const pairExport = await buildExport(
        backend,
        { studentId, teacherId: pair.teacherId, agentId: pair.agentId },
        now,
      );
      if (!pairExport.complete) {
        for (const section of pairExport.truncated) truncated.push(`${pair.teacherId}:${section}`);
      }
      return {
        teacherId: pair.teacherId,
        agentId: pair.agentId,
        status: pair.status,
        export: pairExport,
      };
    }),
  );

  return {
    format: 'edmate-account-export',
    version: 1,
    exportedAt: now,
    complete: truncated.length === 0,
    truncated,
    account: accountFields(user),
    teachers,
  };
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

const MSG = { failed: 'Something went wrong. Try again.' } as const;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** The `GET /api/me/export` handler over an injected backend. Ignores the request body and any
 * params entirely: the only id in scope is the signed-in principal's own. */
export function createAccountExportHandler(backend: AccountExportBackend): Handler {
  return async (_req, ctx) => {
    try {
      const exportJson = await buildAccountExport(
        backend,
        ctx.principal.userId,
        new Date().toISOString(),
      );
      return Response.json(exportJson, {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition': 'attachment; filename="edmate-account-export.json"',
        },
      });
    } catch (error) {
      console.error(`[account-export] ${errorName(error)}`);
      return apiError('provider_error', MSG.failed, 500);
    }
  };
}

/** Wired to the shared auth runtime's database (same memoised pool the other routes use). */
export const accountExportHandler = createAccountExportHandler({
  agents: { owner: (scope) => serverDatabase().repos.agents.owner(scope) },
  sessions: {
    listForStudent: (scope, opts) => serverDatabase().repos.sessions.listForStudent(scope, opts),
  },
  messages: {
    listForStudent: (scope, opts) => serverDatabase().repos.messages.listForStudent(scope, opts),
  },
  learnerProfiles: { get: (scope) => serverDatabase().repos.learnerProfiles.get(scope) },
  evidenceEvents: {
    list: (scope, opts) => serverDatabase().repos.evidenceEvents.list(scope, opts),
  },
  teacherQuestions: {
    listForStudent: (scope) => serverDatabase().repos.teacherQuestions.listForStudent(scope),
  },
  subscriptions: { findLive: (scope) => serverDatabase().repos.subscriptions.findLive(scope) },
  packageVersions: {
    getById: (scope, id) => serverDatabase().repos.packageVersions.getById(scope, id),
  },
  outline: { getOutline: (scope) => serverDatabase().repos.outline.getOutline(scope) },
  subscriptionPairs: {
    listLiveForStudent: (studentId) =>
      serverDatabase().repos.subscriptions.listLiveForStudent(studentId),
  },
  identity: { getUser: (userId) => serverDatabase().identity.getUser(userId) },
});
