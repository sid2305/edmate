import type { ErrorCode } from '@edmate/contracts';

/**
 * Why a repository call failed:
 * - `scope`: the scope is malformed, or the payload names ids outside it (another student or
 *   teacher, or another teacher's modules, topics or questions).
 * - `not_found`: the target does not exist or belongs to another scope; the two look the same, so
 *   a caller can't probe for other people's rows.
 * - `invalid`: a non-scope argument is malformed (for example a `limit` out of range), or the
 *   write conflicts with an existing immutable row.
 * - `integrity`: a stored row fails its contract or disagrees with its own columns; it is never
 *   returned.
 */
export type RepositoryErrorKind = 'scope' | 'not_found' | 'invalid' | 'integrity';

const CODES: Record<RepositoryErrorKind, ErrorCode> = {
  scope: 'forbidden',
  not_found: 'not_found',
  invalid: 'validation',
  integrity: 'validation',
};

/**
 * The only error repositories raise on purpose. Its message names the method and the kind only,
 * never ids, row content or student text (the repo is public and logs are shared).
 */
export class RepositoryError extends Error {
  override readonly name = 'RepositoryError';
  readonly code: ErrorCode;

  constructor(
    readonly kind: RepositoryErrorKind,
    readonly method: string,
  ) {
    super(`${method}: ${kind}`);
    this.code = CODES[kind];
  }
}

/** Postgres error codes repositories translate; anything else propagates unchanged. */
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

function pgCode(err: unknown): string | undefined {
  // Drizzle wraps driver errors and keeps the original as `cause`.
  let e: unknown = err;
  for (let depth = 0; depth < 3 && typeof e === 'object' && e !== null; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Runs a write and translates constraint violations, whose driver messages quote row values:
 * a missing referenced row (for example a scope id that is not a user) is `not_found`; a
 * duplicate key on an immutable row is `invalid`.
 */
export async function translateWrite<T>(method: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof RepositoryError) throw err;
    const code = pgCode(err);
    if (code === FOREIGN_KEY_VIOLATION) throw new RepositoryError('not_found', method);
    if (code === UNIQUE_VIOLATION) throw new RepositoryError('invalid', method);
    throw err;
  }
}
