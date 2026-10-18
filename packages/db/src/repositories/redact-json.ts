// Defense in depth for jsonb that records changes (audit_log.before/after; reusable for
// staff_actions later): personal keys are replaced before the value is stored. Callers must still
// keep raw personal text out of these payloads (README rule 9); this only catches what slips in.

/** What a redacted value becomes. */
export const REDACTED = '[redacted]';

/** Objects and arrays nested deeper than this are replaced with REDACTED, never recursed into. */
export const REDACT_MAX_DEPTH = 8;

/** Personal keys, normalised (see `normalise`). Refined by security review; extend freely. */
const DENYLIST = new Set([
  'email',
  'phone',
  'name',
  'displayname',
  'firstname',
  'lastname',
  'address',
  'bio',
  'photo',
  'ip',
  'ipaddress',
]);

/**
 * A key as matched: NFKC (so full-width letters fold to ASCII), lower case, without format
 * characters (zero-width and the like) or `_`, `-`, spaces and dots between words.
 */
function normalise(key: string): string {
  return key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Cf}_\-\s.]/gu, '');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * A copy of `value` with every denylisted key's value replaced by REDACTED, at any depth up to
 * REDACT_MAX_DEPTH (deeper objects and arrays become REDACTED: fail closed). Primitives and
 * non-plain objects pass through; the input is never mutated.
 */
export function redactPersonalData(value: unknown, depth = 0): unknown {
  const nested = Array.isArray(value) || isPlainObject(value);
  if (!nested) return value;
  if (depth >= REDACT_MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v: unknown) => redactPersonalData(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    // defineProperty, not assignment: a `__proto__` key (JSON.parse makes one) stays a plain key.
    Object.defineProperty(out, k, {
      value: DENYLIST.has(normalise(k)) ? REDACTED : redactPersonalData(v, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
