// Task 9.3 Phase B: the no-payment package-start route. Until M10 a paid package starts as an
// active subscription with no payment call anywhere (checkout is 10.8). The route never trusts a
// client-given `version` or `packageVersionId`: the body is only `{ agentId, packageId }`, and the
// package version is looked up server-side from the agent's own live packages.
import type { LivePackage, Repositories, StudentScope } from '@edmate/db';
import { RepositoryError, ScrubbedDbError, STALE_PACKAGE_VERSION_REASON } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { serverDatabase } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { consoleLog } from '../turn/runtime';
import { errorName, type ServerLog } from '../turn/routes';
import { MAX_BODY_BYTES, readJson, TOO_LARGE } from '../studio/routes';

/** The only unique violation `fromError` maps to 409 already-subscribed (task 9.3b). */
const LIVE_PER_PAIR_CONSTRAINT = 'subscriptions_one_live_per_pair_key';

/** Everything the start route needs: the agent/package/subscription repos, built once per process. */
export interface StartBackend {
  repos(): Pick<Repositories, 'agents' | 'packageVersions' | 'subscriptions'>;
  /** Defaults to a console logger (task 9.3b: an unexpected unique violation logs its name). */
  log?: ServerLog;
}

const BodySchema = z.strictObject({
  agentId: z.string().min(1).max(200),
  packageId: z.string().min(1).max(200),
});

/** A no-payment subscription runs for 30 days when active, or the package's own trial length. */
const DEFAULT_PERIOD_DAYS = 30;

const MSG = {
  validation: 'Check the request and try again.',
  bodyTooLarge: 'The request is too large.',
  notFound: 'That package was not found.',
  alreadySubscribed: 'You already have a package with this teacher.',
  freePaused: "This teacher's free plan is paused for now. Try again next month or choose another package.",
  staleVersion: 'This plan has changed. Reload the page to see the current plans.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);
const tooLarge = () => apiError('input_too_large', MSG.bodyTooLarge, 413);
const notFound = () => apiError('not_found', MSG.notFound, 404);

/** Every `RepositoryErrorKind` this route maps; `assertNever` below fails to compile if a new
 * kind is ever added without a case here (task 9.3b: the exhaustiveness guard the review asked
 * for). */
function assertNever(kind: never, log: ServerLog): Response {
  log.error('subscriptions.start.unhandled_error_kind', { error: String(kind) });
  return apiError('provider_error', MSG.failed, 500);
}

/**
 * A thrown `RepositoryError`'s kind mapped to this route's fixed response; anything else is 500.
 * Task 9.3b: `invalid` is no longer unconditionally "already subscribed" -- that message is only
 * for the subscriptions live-per-pair unique index (the cost-alarm `invalid` is told apart in
 * the handler first, task 9.6i, before this function ever sees it). A *different* unique
 * violation reaching here is unexpected (not a student-facing conflict), so it logs the error
 * name only (never the constraint or row content) and fails closed as a 500; an `invalid` with
 * no unique-violation cause at all (a malformed argument) stays the ordinary 400.
 */
function fromError(error: unknown, log: ServerLog): Response {
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'not_found':
      case 'scope':
        return notFound();
      case 'invalid': {
        const cause = error.cause instanceof ScrubbedDbError ? error.cause : null;
        if (cause === null) return validation();
        if (cause.constraint === LIVE_PER_PAIR_CONSTRAINT) {
          return apiError('validation', MSG.alreadySubscribed, 409);
        }
        log.error('subscriptions.start.unexpected_unique_violation', { error: errorName(error) });
        return apiError('provider_error', MSG.failed, 500);
      }
      case 'integrity':
        return validation();
      // Starting a subscription has no cap, so this repo call never raises `'limit'`; mapped
      // the same as `'integrity'` only so the exhaustive switch compiles.
      case 'limit':
        return validation();
      case 'failed':
        return apiError('provider_error', MSG.failed, 500);
      default:
        return assertNever(error.kind, log);
    }
  }
  return apiError('provider_error', MSG.failed, 500);
}

function findPackage(packages: LivePackage[], packageId: string): LivePackage | null {
  return packages.find((p) => p.offer.packageId === packageId) ?? null;
}

/** `status`/`periodEnd` from the package's own `trialDays` (9.3 Phase B's own call, logged). */
function startParams(pkg: LivePackage, now: Date): { status: 'trial' | 'active'; periodEnd: string } {
  const trialDays = pkg.offer.trialDays;
  if (trialDays > 0) {
    const periodEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    return { status: 'trial', periodEnd: periodEnd.toISOString() };
  }
  const periodEnd = new Date(now.getTime() + DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return { status: 'active', periodEnd: periodEnd.toISOString() };
}

/**
 * Task 9.6i: `start` is `invalid` either when the pair already has a live subscription (the
 * unique index), when the teacher's free tier is cost-alarm paused this month, or (task 9.3b)
 * when the package version the route looked up was superseded by a publish race between the
 * lookup and the write. The stale-version case carries its own marker on the thrown error's
 * cause, so it is checked first -- never guessed from the absence of a live row, which would
 * otherwise show the student the alarm-paused message for an ordinary publish race. Only when
 * the marker is absent does `findLive` tell the remaining two apart: no live row means the alarm
 * refusal. A `findLive` failure goes through `fromError` (never a guessed message).
 */
async function explainInvalid(
  error: RepositoryError,
  repos: ReturnType<StartBackend['repos']>,
  scope: StudentScope,
  log: ServerLog,
): Promise<Response> {
  const cause = error.cause instanceof ScrubbedDbError ? error.cause : null;
  if (cause !== null && cause.constraint === STALE_PACKAGE_VERSION_REASON) {
    return apiError('validation', MSG.staleVersion, 400);
  }
  try {
    const live = await repos.subscriptions.findLive(scope);
    return live === null
      ? apiError('validation', MSG.freePaused, 409)
      : apiError('validation', MSG.alreadySubscribed, 409);
  } catch (err) {
    return fromError(err, log);
  }
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The start handler over an injected backend (no database in tests; rule 4). */
export function createSubscriptionHandlers(backend: StartBackend): { start: Handler } {
  const log = backend.log ?? consoleLog('[subscriptions]');
  const start: Handler = async (req, ctx) => {
    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return validation();
    const { agentId, packageId } = parsed.data;
    const repos = backend.repos();
    let scope: StudentScope | null = null;
    try {
      const owner = await repos.agents.owner({ agentId });
      if (owner === null) return notFound();
      const packages = await repos.packageVersions.liveForAgent({ agentId });
      const pkg = findPackage(packages, packageId);
      if (pkg === null) return notFound();
      scope = { studentId: ctx.principal.userId, teacherId: owner.teacherId };
      const { status, periodEnd } = startParams(pkg, new Date());
      const subscription = await repos.subscriptions.start(scope, {
        packageVersionId: pkg.packageVersionId,
        status,
        periodEnd,
      });
      return ok({ subscription }, 201);
    } catch (error) {
      if (error instanceof RepositoryError && error.kind === 'invalid' && scope !== null) {
        return explainInvalid(error, repos, scope, log);
      }
      return fromError(error, log);
    }
  };
  return { start };
}

export { MAX_BODY_BYTES };

/** Wired to the shared auth runtime's database (same memoised pool the other routes use). */
export const subscriptionHandlers = createSubscriptionHandlers({
  repos: () => serverDatabase().repos,
});
