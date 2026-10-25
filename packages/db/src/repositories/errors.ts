import type { ErrorCode } from '@edmate/contracts';

/**
 * Why a repository call failed:
 * - `scope`: the scope is malformed, or the payload names ids outside it (another student or
 *   teacher, or another teacher's modules, topics or questions).
 * - `not_found`: the target does not exist or belongs to another scope; the two look the same, so
 *   a caller can't probe for other people's rows.
 * - `invalid`: a non-scope argument is malformed (for example a `limit` out of range), or the
 *   write conflicts with an existing immutable row of the same scope.
 * - `limit`: a write would exceed a fixed per-scope cap (for example a teacher's package count);
 *   distinct from `invalid` so a caller can tell "you're at the limit" from any other bad write.
 * - `integrity`: a stored row fails its contract or disagrees with its own columns; it is never
 *   returned.
 * - `failed`: the database failed (connection, timeout, an unexpected error). The cause is
 *   scrubbed: only the driver's error code and constraint name survive.
 */
export type RepositoryErrorKind =
  | 'scope'
  | 'not_found'
  | 'invalid'
  | 'limit'
  | 'integrity'
  | 'failed';

const CODES: Record<RepositoryErrorKind, ErrorCode> = {
  scope: 'forbidden',
  not_found: 'not_found',
  invalid: 'validation',
  limit: 'limit_reached',
  integrity: 'validation',
  // The contracts have no database-specific code; provider_error is the "upstream failed" one.
  failed: 'provider_error',
};

/**
 * The only error repositories raise. Its message names the method and the kind only, never ids,
 * row content or student text (the repo is public and logs are shared).
 */
export class RepositoryError extends Error {
  override readonly name = 'RepositoryError';
  readonly code: ErrorCode;

  constructor(
    readonly kind: RepositoryErrorKind,
    readonly method: string,
    options?: { cause: ScrubbedDbError },
  ) {
    super(`${method}: ${kind}`, options);
    this.code = CODES[kind];
  }
}

/**
 * What is kept of a driver error: its code (a Postgres SQLSTATE such as `57014`, or a Node code
 * such as `ECONNREFUSED`) and constraint name. Drizzle's own message ("Failed query: … params: …")
 * and the driver's detail quote ids and student text, so neither is kept, nor is the original
 * error as a cause.
 */
export class ScrubbedDbError extends Error {
  override readonly name = 'ScrubbedDbError';

  constructor(
    readonly code: string | undefined,
    readonly constraint: string | undefined,
  ) {
    super(`database error${code ? ` ${code}` : ''}${constraint ? ` (${constraint})` : ''}`);
  }
}

/** A string property found on the error or its causes (Drizzle wraps driver errors). */
function find(err: unknown, key: 'code' | 'constraint'): string | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 3 && typeof e === 'object' && e !== null; depth += 1) {
    const value = (e as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Postgres error codes writes translate. */
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

/**
 * Runs a write and translates constraint violations: a missing referenced row (for example a
 * scope id that is not a user) is `not_found`; a duplicate key is `onDuplicate` (default
 * `invalid`; `not_found` where the key is global and chosen by the caller, so it can't be used to
 * probe other scopes' rows). Anything else is rethrown for `guarded` to scrub.
 */
export async function translateWrite<T>(
  method: string,
  run: () => Promise<T>,
  onDuplicate: 'invalid' | 'not_found' = 'invalid',
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof RepositoryError) throw err;
    const code = find(err, 'code');
    if (code === FOREIGN_KEY_VIOLATION) throw new RepositoryError('not_found', method);
    // Task 9.3b: the constraint name travels on `cause` even for `invalid`/`not_found` (not just
    // `guarded`'s `failed`), so a caller such as the subscription-start route can tell the
    // live-per-pair unique index apart from any other unique violation -- never by message text.
    if (code === UNIQUE_VIOLATION) {
      throw new RepositoryError(onDuplicate, method, {
        cause: new ScrubbedDbError(code, find(err, 'constraint')),
      });
    }
    throw err;
  }
}

/**
 * Runs a repository method: a RepositoryError passes through; any other error becomes
 * `RepositoryError('failed')` with a scrubbed cause. createRepositories wraps every method.
 */
export async function guarded<T>(method: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof RepositoryError) throw err;
    throw new RepositoryError('failed', method, {
      cause: new ScrubbedDbError(find(err, 'code'), find(err, 'constraint')),
    });
  }
}
