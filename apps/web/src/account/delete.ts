// Task 13.4b: `DELETE /api/me` -- a student erases their own account. Scoped to the signed-in
// principal's own id only (never a client-given one, per `src/memory/routes.ts`'s convention);
// the request body is ignored entirely.
//
// Held (409) while any safety alert of theirs, across every teacher, is still open (B-59 answer
// 3: a payment dispute hold has nothing to check yet, since M10 hasn't landed -- the lead carries
// that follow-up). The hold check and the anonymise are two separate calls, so an alert raised in
// the gap between them is accepted as-is: alert rows keep their own scope regardless of what
// `identity.anonymise` does to the student's identity fields afterwards.
//
// `identity.anonymise` (13.4 Phase A, merged) already deletes the student's `auth_sessions` rows
// in the same transaction, so the browser's old cookie stops authenticating even before sign-out
// clears it. Sign-out runs after a successful anonymise and its failure is logged, not surfaced:
// the account is already deleted either way, so a cookie-clearing hiccup must not turn a
// completed delete into an error response.
import { RepositoryError } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { serverDatabase, signOut } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';

export interface DeleteBackend {
  safetyAlerts: { hasOpenForStudent(studentId: string): Promise<boolean> };
  identity: { anonymise(userId: string): Promise<void> };
  /** Clears the session cookie (task 1.3/1.4's `signOut`, reused as-is). */
  signOut(): Promise<unknown>;
}

const MSG = {
  onHold:
    "We can't delete your account while a safety check on it is still open. Please try again later, or contact support.",
  failed: 'Something went wrong. Try again.',
} as const;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function onHold(): Response {
  return Response.json(
    { error: 'delete_on_hold', message: MSG.onHold },
    { status: 409, headers: { 'cache-control': 'no-store' } },
  );
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The `DELETE /api/me` handler over an injected backend. */
export function createDeleteHandler(backend: DeleteBackend): Handler {
  return async (_req, ctx) => {
    const studentId = ctx.principal.userId;
    try {
      if (await backend.safetyAlerts.hasOpenForStudent(studentId)) return onHold();
      await backend.identity.anonymise(studentId);
    } catch (error) {
      if (
        error instanceof RepositoryError &&
        (error.kind === 'not_found' || error.kind === 'scope')
      ) {
        return apiError('not_found', 'Account not found.', 404);
      }
      console.error(`[account] delete failed: ${errorName(error)}`);
      return apiError('provider_error', MSG.failed, 500);
    }
    try {
      await backend.signOut();
    } catch (error) {
      console.error(`[account] sign-out after delete failed: ${errorName(error)}`);
    }
    return Response.json(
      { deleted: true },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  };
}

/** Wired to the shared auth runtime. */
export const deleteHandler = createDeleteHandler({
  safetyAlerts: {
    hasOpenForStudent: (studentId) =>
      serverDatabase().repos.safetyAlerts.hasOpenForStudent(studentId),
  },
  identity: { anonymise: (userId) => serverDatabase().identity.anonymise(userId) },
  signOut: () => signOut({ redirect: false }),
});
