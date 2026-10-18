// Defense in depth for jsonb that records changes (audit_log.before/after; reusable for
// staff_actions later): personal keys and email/phone-like values are replaced before the value is
// stored. Callers must still keep raw personal text out of these payloads (README rule 9); this
// only catches what slips in. It is not a guarantee: free text (a name inside a sentence) is not
// detected, and keys spelt with cross-script homoglyphs (a Cyrillic "е" in "еmail") survive the
// NFKC fold below, because NFKC does not map one script onto another.

/** What a redacted value becomes. */
export const REDACTED = '[redacted]';

/** Objects and arrays nested deeper than this are replaced with REDACTED, never recursed into. */
export const REDACT_MAX_DEPTH = 8;

/**
 * Terms matched anywhere in the normalised key: `studentEmail`, `parentName`, `guardianPhone`,
 * `homeAddress`, `profilePhotoUrl`. This over-redacts some harmless keys (`packageName`,
 * `namespace`), which is the safe side for an audit trail. There is no allowlist yet: add one
 * here, listing each key, only when a real false positive gets in the way.
 */
const SUBSTRING_TERMS = ['email', 'phone', 'name', 'address', 'photo'];

/**
 * Terms too short to match inside a word (`subscriptionId`, `description` contain "ip"; `biology`
 * contains "bio"): these match only as a whole word of the key (`clientIp`, `ip_v4`, `teacherBio`).
 */
const WORD_TERMS = new Set(['ip', 'bio']);

/** NFKC (full-width letters fold to ASCII) without format characters (zero-width and the like). */
function fold(key: string): string {
  return key.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

/** The key without case, `_`, `-`, spaces or dots, for substring terms. */
function squashed(folded: string): string {
  return folded.toLowerCase().replace(/[_\-\s.]/g, '');
}

/** The key's words: split at camelCase boundaries and at anything not a letter or digit. */
function words(folded: string): string[] {
  return folded
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
}

function isPersonalKey(key: string): boolean {
  const folded = fold(key);
  const flat = squashed(folded);
  return (
    SUBSTRING_TERMS.some((t) => flat.includes(t)) || words(folded).some((w) => WORD_TERMS.has(w))
  );
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
/** A phone-shaped run: digits with spaces, dots, dashes or brackets between them. */
const PHONE_CANDIDATE = /(?<![\p{L}\p{N}_.+-])\+?\(?\d[\d\s().-]{4,}\d(?![\p{L}\p{N}_])/gu;
/** At least this many digits make a candidate a phone number. */
const PHONE_MIN_DIGITS = 7;
/** Candidates that are dates or decimals, not phones. */
const NOT_A_PHONE = /^(?:\d{4}-\d{2}-\d{2}|\d+\.\d+)$/;

/** The string with every email-like and phone-like part replaced by REDACTED. */
function redactString(s: string): string {
  return s.replace(EMAIL, REDACTED).replace(PHONE_CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, '').length;
    return digits >= PHONE_MIN_DIGITS && !NOT_A_PHONE.test(m) ? REDACTED : m;
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * A copy of `value` where every personal key's value is REDACTED and every email or phone number
 * inside a string is replaced, at any depth up to REDACT_MAX_DEPTH (deeper objects and arrays
 * become REDACTED: fail closed). Other primitives and non-plain objects pass through; the input is
 * never mutated.
 */
export function redactPersonalData(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  const nested = Array.isArray(value) || isPlainObject(value);
  if (!nested) return value;
  if (depth >= REDACT_MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v: unknown) => redactPersonalData(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    // defineProperty, not assignment: a `__proto__` key (JSON.parse makes one) stays a plain key.
    Object.defineProperty(out, k, {
      value: isPersonalKey(k) ? REDACTED : redactPersonalData(v, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
