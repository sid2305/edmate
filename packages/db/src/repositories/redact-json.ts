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

/** An email local-part character, matching the old regex's `[\p{L}\p{N}._%+-]`. */
const EMAIL_LOCAL_CHAR = /[\p{L}\p{N}._%+-]/u;
/**
 * An email domain, run as a sticky regex so it only matches starting exactly at `lastIndex` (no
 * backtracking into earlier text): `[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}`.
 */
const EMAIL_DOMAIN = /[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/uy;

/**
 * Replaces every email-shaped run in `s` with REDACTED. Reproduces, exactly, the output of the old
 * regex `/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu` used with
 * `String.replace`, but in linear time.
 *
 * 8.7o fix round: a lookbehind on the local part, `(?<![\p{L}\p{N}._%+-])`, was tried to make the
 * regex linear, but it changes output across two adjacent fake addresses (secret-scan: allow
 * fake test-shaped addresses in a code comment, not real accounts): in
 * `"contact ab@test.example-cd@test.example now"`, the old regex gives
 * `"contact [redacted][redacted] now"` (the second local part starts right after the first
 * domain's `-`), but the lookbehind blocks that second match, because the domain's trailing letter
 * (`e` in `.example`) is itself a local-part character, so the lookbehind sees "previous character
 * is a local-part character" and refuses to start there. The lookbehind's "no output change"
 * argument in the 8.7o plan only considered one run of local-part characters in isolation, not a
 * local part that directly follows another match's domain.
 *
 * This linear scan reproduces the old regex's leftmost-match semantics exactly instead:
 * - `pos` is the end of the previous match (0 initially); `from` is where to resume searching for
 *   the next `@` (it moves past a failed candidate's `@` without moving `pos`, so a later local
 *   part is still free to start inside what would have been the failed candidate's domain text).
 * - For each `@` found at or after `from`: walk left over the maximal run of local-part characters,
 *   but never past `pos` (text already consumed by an earlier match is never reused). An astral
 *   (surrogate-pair) character is stepped over as one unit, not as two lone surrogate halves.
 * - If that run is empty, this `@` cannot start a match; move on to the next `@` (`pos` unchanged).
 * - Otherwise, try the domain pattern as a sticky match starting right after the `@`. If it
 *   matches, emit REDACTED for [localStart, domainEnd) and advance `pos` (and `from`) to
 *   `domainEnd`. If it does not match, this `@` cannot start a match either; move on, `pos`
 *   unchanged.
 * This is linear: `@` is in neither the local-part nor domain character class, so each local-part
 * walk stops at the previous match's end or the previous `@`, and each domain attempt stops at the
 * next `@`; no text is rescanned by more than a constant number of passes.
 */
export function redactEmails(s: string): string {
  let out = '';
  let pos = 0;
  let from = 0;
  for (;;) {
    const at = s.indexOf('@', from);
    if (at < 0) break;
    let localStart = at;
    while (localStart > pos) {
      let charStart = localStart - 1;
      const code = s.charCodeAt(charStart);
      // `code` is a low surrogate: step one further left to cover the whole astral character,
      // unless that would go past `pos`.
      if (code >= 0xdc00 && code <= 0xdfff && charStart > pos) {
        charStart -= 1;
      }
      const ch = String.fromCodePoint(s.codePointAt(charStart) as number);
      if (!EMAIL_LOCAL_CHAR.test(ch)) break;
      localStart = charStart;
    }
    if (localStart === at) {
      from = at + 1;
      continue;
    }
    EMAIL_DOMAIN.lastIndex = at + 1;
    const domainMatch = EMAIL_DOMAIN.exec(s);
    if (!domainMatch) {
      from = at + 1;
      continue;
    }
    out += s.slice(pos, localStart) + REDACTED;
    pos = EMAIL_DOMAIN.lastIndex;
    from = pos;
  }
  return out + s.slice(pos);
}

/**
 * A phone-shaped run: digits with spaces, dots, dashes or brackets between them. The run may
 * directly follow a letter (`abc5551234567`): only `\p{N}_.+-` before the start block the match,
 * so a run glued to an id prefix (`_`, a digit or `.`/`+`/`-`) still stays unredacted, while a run
 * glued to a plain letter is now redacted (8.7m).
 */
const PHONE_CANDIDATE = /(?<![\p{N}_.+-])\+?\(?\d[\d\s().-]{4,}\d(?![\p{L}\p{N}_])/gu;
/** At least this many digits make a candidate a phone number. */
const PHONE_MIN_DIGITS = 7;
/** Candidates that are dates or decimals, not phones. */
const NOT_A_PHONE = /^(?:\d{4}-\d{2}-\d{2}|\d+\.\d+)$/;
/**
 * A UUID (8-4-4-4-12 hex groups), whole value or embedded in a longer string (`\b` on each side so
 * a UUID glued to other hex-ish text does not match). A digit-run that falls inside a UUID span
 * (e.g. the `12345678` in `12345678-90ab-4cde-8f12-1234567890ab`) is an id, not a phone number, and
 * must not be redacted by PHONE_CANDIDATE; see 8.7h.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
/**
 * A `<prefix>_<rest>` id token (`rp_<hex40>`, `tch_93d`, `doc_cap_501`, `se_<hash>`): a run of
 * `[A-Za-z0-9]` containing at least one `_`, bounded by characters outside the contracts id
 * alphabet `[A-Za-z0-9_-]` (packages/contracts/src/formats.ts). A digit run inside such a token
 * was never redacted before 8.7m either (the leading `_` or the preceding letter blocked it), so
 * excluding the whole token here is not a regression, just the same result reached a different
 * way now that a letter alone no longer blocks the match.
 */
const PREFIXED_ID = /(?<![A-Za-z0-9_-])[A-Za-z0-9]+_[A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g;
/**
 * A bare hex digest (content hash), 32+ hex characters bounded by non-alphanumerics. The
 * lookahead `(?=[0-9a-fA-F]*[a-fA-F])` requires at least one a-f letter in the run: without it, a
 * pure-digit run of 32+ characters also matched, exempting it from PHONE_CANDIDATE so it survived
 * unredacted where main redacts it (fail-open regression, 8.7m fix round 2). The lookahead is a
 * single bounded scan to the next letter (or end of string) from the current position, so this
 * stays linear overall: verified by hand on a 600k-character all-digit, all-letter and hex-ish
 * input (no quadratic blowup).
 */
const HEX_DIGEST = /(?<![A-Za-z0-9])(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{32,}(?![A-Za-z0-9])/g;

/** Half-open [start, end) character spans covered by a match of `re` in `s`. */
function matchSpans(re: RegExp, s: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  // `String.replace`'s callback gets the match offset as a plain `number` (no `| undefined`,
  // unlike `RegExpMatchArray.index`), so this collects spans without a cast; the string itself is
  // returned unchanged.
  s.replace(re, (m: string, offset: number) => {
    spans.push([offset, offset + m.length]);
    return m;
  });
  return spans;
}

/** Whether [start, end) is fully contained in one of `spans`. */
function coveredBy(start: number, end: number, spans: Array<[number, number]>): boolean {
  return spans.some(([s0, s1]) => start >= s0 && end <= s1);
}

/** The string with every email-like and phone-like part replaced by REDACTED. UUID-shaped runs
 *  (whole value or embedded), prefixed id tokens and bare hex digests are never treated as phone
 *  numbers, even when a digit run inside them is 7 or more digits long. */
function redactString(s: string): string {
  const afterEmail = redactEmails(s);
  const spans = [
    ...matchSpans(UUID, afterEmail),
    ...matchSpans(PREFIXED_ID, afterEmail),
    ...matchSpans(HEX_DIGEST, afterEmail),
  ];
  return afterEmail.replace(PHONE_CANDIDATE, (m: string, offset: number) => {
    if (coveredBy(offset, offset + m.length, spans)) return m;
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
