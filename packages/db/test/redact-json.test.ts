// Unit (no database): redactPersonalData scrubs personal keys out of audit before/after payloads.
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REDACTED, REDACT_MAX_DEPTH, redactPersonalData } from '../src/index.js';
// EMAIL is not part of the public API; imported directly from the module for the 8.7o
// differential test only (old vs new regex output), not re-exported from the package.
import { EMAIL } from '../src/repositories/redact-json.js';

/** A fake `rp_<hex40>`-shaped id, same shape as reportRowId (packages/db/src/repositories/reports.ts). */
function fakeReportRowId(): string {
  return `rp_${randomBytes(20).toString('hex')}`;
}

describe('redactPersonalData', () => {
  it('replaces denylisted keys at the top level', () => {
    expect(
      redactPersonalData({ email: 'x@example.test', phone: '000', name: 'N', status: 'live' }),
    ).toEqual({ email: REDACTED, phone: REDACTED, name: REDACTED, status: 'live' });
  });

  it('matches keys case-insensitively and ignores separators', () => {
    expect(
      redactPersonalData({
        EMAIL: 'a',
        DisplayName: 'b',
        first_name: 'c',
        'last-name': 'd',
        IPAddress: 'e',
        ip: 'f',
        Bio: 'g',
        photo: 'h',
        address: 'i',
        firstName: 'j',
        lastName: 'k',
        displayName: 'l',
        ipAddress: 'm',
      }),
    ).toEqual({
      EMAIL: REDACTED,
      DisplayName: REDACTED,
      first_name: REDACTED,
      'last-name': REDACTED,
      IPAddress: REDACTED,
      ip: REDACTED,
      Bio: REDACTED,
      photo: REDACTED,
      address: REDACTED,
      firstName: REDACTED,
      lastName: REDACTED,
      displayName: REDACTED,
      ipAddress: REDACTED,
    });
  });

  it('redacts a denylisted key whatever its value (object, array, null)', () => {
    expect(redactPersonalData({ name: { first: 'a' }, email: ['a', 'b'], phone: null })).toEqual({
      name: REDACTED,
      email: REDACTED,
      phone: REDACTED,
    });
  });

  it('recurses into nested objects and arrays', () => {
    const input = {
      teacher: { id: 'tch_a', profile: { bio: 'b', slug: 's', contacts: [{ email: 'e' }] } },
      list: [{ name: 'n', topicId: 'top_a' }, 3, 'x', null],
    };
    expect(redactPersonalData(input)).toEqual({
      teacher: {
        id: 'tch_a',
        profile: { bio: REDACTED, slug: 's', contacts: [{ email: REDACTED }] },
      },
      list: [{ name: REDACTED, topicId: 'top_a' }, 3, 'x', null],
    });
  });

  it('does not mutate its input', () => {
    const input = { name: 'n', nested: { email: 'e' } };
    const copy = structuredClone(input);
    redactPersonalData(input);
    expect(input).toEqual(copy);
  });

  // Compound keys: any key whose normalised form contains a long term (email, phone, name,
  // address, photo) is redacted; the short terms (ip, bio) match as a whole word of the key.
  it.each([
    'studentEmail',
    'parentName',
    'guardianPhone',
    'fullName',
    'full_name',
    'STUDENT-EMAIL',
    'student email',
    'emailAddress',
    'homeAddress',
    'profilePhotoUrl',
    'phoneNumber',
    'mobilePhone',
    'nickname',
    'username',
    'packageName',
    'clientIp',
    'client_ip',
    'IPAddress',
    'remoteIP',
    'ip_v4',
    'teacherBio',
    'bio_text',
    'ＳｔｕｄｅｎｔＥｍａｉｌ',
    'parent​Name',
  ])('redacts the compound key %s', (key) => {
    expect(redactPersonalData({ [key]: 'x', keep: 1 })).toEqual({ [key]: REDACTED, keep: 1 });
  });

  it.each([
    'subscriptionId',
    'description',
    'piiPatterns',
    'ipsum',
    'zip',
    'biology',
    'symbiotic',
    'status',
    'moduleIds',
    'liveVersion',
    'membership',
  ])('keeps %s (a short term inside another word is not a match)', (key) => {
    expect(redactPersonalData({ [key]: 'v' })).toEqual({ [key]: 'v' });
  });

  it('redacts compound keys nested in objects and arrays, any case', () => {
    expect(
      redactPersonalData({
        students: [
          { studentEmail: 'a', topicId: 'top_a' },
          { PARENT_NAME: 'b', guardian: { guardianPhone: 'c', Relation: 'mother' } },
        ],
        audit: { changes: [[{ FullName: 'd', ok: true }]] },
      }),
    ).toEqual({
      students: [
        { studentEmail: REDACTED, topicId: 'top_a' },
        { PARENT_NAME: REDACTED, guardian: { guardianPhone: REDACTED, Relation: 'mother' } },
      ],
      audit: { changes: [[{ FullName: REDACTED, ok: true }]] },
    });
  });

  // Values: an email or phone number in any string is replaced, whatever its key.
  it.each([
    ['a bare email', 'someone@example.com', REDACTED],
    [
      'an email in text',
      'write to someone.else+tag@example.com today',
      `write to ${REDACTED} today`,
    ],
    ['an uppercase email', 'SOMEONE@EXAMPLE.ORG', REDACTED],
    ['an international phone', '+44 20 7946 0000', REDACTED],
    ['a dashed phone', 'call 555-010-0199 now', `call ${REDACTED} now`],
    ['a dotted phone', '555.010.0199', REDACTED],
    ['a bracketed phone', '(555) 010-0199', REDACTED],
    ['a run of ten digits', '5550100199', REDACTED],
    ['two emails', 'a@example.com, b@example.org', `${REDACTED}, ${REDACTED}`],
  ])('redacts %s in a value', (_label, value, expected) => {
    expect(redactPersonalData({ note: value })).toEqual({ note: expected });
    expect(redactPersonalData([value])).toEqual([expected]);
    expect(redactPersonalData(value)).toBe(expected);
  });

  it.each([
    ['an ISO timestamp', '2026-10-17T10:00:00.000Z'],
    ['a date', '2026-10-17'],
    ['a decimal', '0.123456789'],
    ['a short number', '12345'],
    ['an id', 'stu_test_01'],
    ['a uuid', '3f2a9c1e-5b7d-4e8a-9c0d-1a2b3c4d5e6f'],
    ['a version list', '1.2.3'],
    ['an at-sign without a domain', '@mention and a@b'],
    ['plain text', 'the student reset their progress'],
  ])('keeps %s', (_label, value) => {
    expect(redactPersonalData({ note: value })).toEqual({ note: value });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'email me'],
    ['a number', 42],
    ['a boolean', false],
    ['an empty object', {}],
    ['an empty array', []],
    ['an array of primitives', [1, 'a', true, null]],
  ])('passes %s through unchanged', (_label, value) => {
    expect(redactPersonalData(value)).toEqual(value);
  });

  it('caps depth: structure past the cap is replaced, never recursed into', () => {
    type Nest = { email: string; next?: Nest };
    const root: Nest = { email: 'e0' };
    let cur = root;
    for (let i = 1; i < 50; i += 1) {
      cur.next = { email: `e${i}` };
      cur = cur.next;
    }
    const out = redactPersonalData(root) as Nest;
    let node: Nest | string | undefined = out;
    let depth = 0;
    while (typeof node === 'object' && node !== null) {
      expect(node.email).toBe(REDACTED);
      node = node.next;
      depth += 1;
    }
    expect(depth).toBe(REDACT_MAX_DEPTH);
    expect(node).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toMatch(/"e\d+"/);
  });

  it('handles a very wide object', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, i) => [`k${i}`, i % 2 ? 'v' : { email: 'e' }]),
    );
    const out = redactPersonalData(wide) as Record<string, unknown>;
    expect(out.k0).toEqual({ email: REDACTED });
    expect(out.k1).toBe('v');
  });

  it('treats non-plain objects (a Date) as opaque values', () => {
    const d = new Date('2026-10-17T00:00:00Z');
    expect(redactPersonalData({ at: d })).toEqual({ at: d });
  });

  it('normalises compatibility characters (NFKC) before matching, so ｅmail is caught', () => {
    expect(redactPersonalData({ ｅｍａｉｌ: 'x', Ｎａｍｅ: 'y' })).toEqual({
      ｅｍａｉｌ: REDACTED,
      Ｎａｍｅ: REDACTED,
    });
  });

  it('ignores zero-width and other format characters in keys', () => {
    expect(redactPersonalData({ 'e\u200bmail': 'x', 'na\u200dme': 'y' })).toEqual({
      'e\u200bmail': REDACTED,
      'na\u200dme': REDACTED,
    });
  });

  // 8.7h: a UUID whose first (or any) group is all digits must not be read as a phone number.
  it('keeps 10,000 random UUIDs unredacted (property test)', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const id = randomUUID();
      expect(redactPersonalData({ runId: id })).toEqual({ runId: id });
    }
  });

  it.each([
    '00000000-0000-4000-8000-000000000000',
    '12345678-1234-4234-8234-123456789012',
    '99999999-9999-4999-8999-999999999999',
    '11112222-3333-4444-5555-666677778888',
  ])('keeps a crafted UUID whose groups are all digits: %s', (id) => {
    expect(redactPersonalData({ runId: id })).toEqual({ runId: id });
    expect(redactPersonalData(id)).toBe(id);
  });

  it('keeps a UUID embedded in free text, case-insensitively', () => {
    // The lower-case case is already covered by "still redacts a phone number that sits right
    // next to a UUID" below; this test only needs to add the upper-case case.
    const upper = '12345678-1234-4234-8234-123456789012'.toUpperCase();
    expect(redactPersonalData({ note: `run ${upper} failed` })).toEqual({
      note: `run ${upper} failed`,
    });
  });

  it('still redacts a phone number that sits right next to a UUID', () => {
    const id = '12345678-1234-4234-8234-123456789012';
    expect(redactPersonalData({ note: `id ${id} call 555-010-0199` })).toEqual({
      note: `id ${id} call ${REDACTED}`,
    });
  });

  it('still redacts a digit run inside free text that is not UUID-shaped', () => {
    expect(redactPersonalData({ note: 'call 5550100199 now' })).toEqual({
      note: `call ${REDACTED} now`,
    });
  });

  // 8.7h decided UUID-shaped values are exempt from the phone digit-run rule even when their
  // digits look like a phone number (docs/decisions/log.md, "22 Oct 2026 - 8.7h UUID-shaped
  // values are exempt from the phone digit-run rule"). This is that trade-off at its most
  // phone-like: a value padded with hex characters so its digits read as a phone number but its
  // shape is still a UUID. 8.7m keeps this as-is; it is an accepted trade-off, not a bug.
  it('keeps a UUID-shaped value whose digits look like a phone number (8.7h trade-off)', () => {
    const hexPaddedPhone = '5551234a-bcde-4f00-8000-000000000000';
    expect(redactPersonalData({ note: hexPaddedPhone })).toEqual({ note: hexPaddedPhone });
    expect(redactPersonalData(hexPaddedPhone)).toBe(hexPaddedPhone);
  });

  // 8.7m: a digit run of at least PHONE_MIN_DIGITS that directly follows a letter is now redacted
  // (it used to be skipped entirely, because the lookbehind blocked a match starting anywhere in
  // the run). The regex change only drops `\p{L}` from the lookbehind's negative set, so it stays
  // a single linear scan with no nested quantifiers: redactString still makes one pass over the
  // string per candidate regex.
  it('redacts a phone-length digit run glued directly to a letter', () => {
    expect(redactPersonalData({ note: 'abc5551234567' })).toEqual({ note: 'abc[redacted]' });
  });

  it.each(['tch_93d', 'doc_cap_501', 'stu_1234567'])(
    'keeps an underscore-prefixed id unredacted: %s',
    (id) => {
      expect(redactPersonalData({ note: id })).toEqual({ note: id });
    },
  );

  it('keeps a whole UUID and a UUID embedded in text unredacted (UUID span exemption)', () => {
    const uuid = '12345678-1234-4234-8234-123456789012';
    expect(redactPersonalData(uuid)).toBe(uuid);
    expect(redactPersonalData({ note: `run ${uuid} failed` })).toEqual({
      note: `run ${uuid} failed`,
    });
  });

  it.each(['v2026-10-17', 'v0.123456789'])(
    'keeps a date or decimal glued to a letter unredacted (NOT_A_PHONE): %s',
    (value) => {
      expect(redactPersonalData({ note: value })).toEqual({ note: value });
    },
  );

  it.each(['v2', 'abc123456'])(
    'keeps a glued digit run under PHONE_MIN_DIGITS unredacted: %s',
    (value) => {
      expect(redactPersonalData({ note: value })).toEqual({ note: value });
    },
  );

  // A phone number glued to a UUID with no separator merges into the UUID's last hex group, so
  // the UUID regex's trailing `\b` no longer matches (the next character is still a digit, not a
  // word boundary) and the whole run is treated as one phone-shaped candidate. Decision (8.7m):
  // this over-redacts the UUID along with the phone number rather than risk leaving any phone
  // digit behind; the phone digits must never survive, and here they do not.
  // This case passes on the pre-8.7m code too (the merged run was already fully digit-and-dash,
  // never glued to a letter): it guards the fail-closed invariant, not new 8.7m behaviour.
  it('redacts a UUID with a 10-digit phone number glued on with no separator', () => {
    const glued = '12345678-1234-4234-8234-1234567890125550100199';
    const out = redactPersonalData({ note: glued }) as { note: string };
    expect(out.note).toBe(REDACTED);
    expect(out.note).not.toMatch(/5550100199/);
  });

  // 8.7m follow-up (typescript-reviewer MEDIUM): a letter glued directly onto a UUID with no
  // separator breaks the UUID regex's leading `\b` (letter-then-digit is not a word boundary), so
  // PHONE_CANDIDATE's now-wider lookbehind treats the whole digit-and-dash run as one phone-shaped
  // candidate and redacts it, even though there is no phone number here. This is an accepted
  // trade-off (same reasoning as the glued-phone case above: over-redact rather than risk a real
  // phone digit surviving), not a bug; flagged in the 8.7m handoff.
  it('over-redacts a letter glued directly onto a UUID with no separator (accepted trade-off)', () => {
    const glued = 'id12345678-1234-4234-8234-123456789012';
    expect(redactPersonalData({ note: glued })).toEqual({ note: `id${REDACTED}` });
  });

  // 8.7m fix round: report row ids (rp_<hex40>, packages/db/src/repositories/reports.ts) and other
  // <prefix>_<hash> ids must never be redacted, even when the hex digest has a letter followed by
  // PHONE_MIN_DIGITS+ digits (about 3.65% of random 40-hex digests). Property test, same technique
  // as the randomUUID one above; shown to fail on the pre-fix code (a letter-then-digit run inside
  // the hash was redacted).
  it('keeps 10,000 random report row ids unredacted (property test)', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const id = fakeReportRowId();
      expect(redactPersonalData(id)).toBe(id);
      expect(
        redactPersonalData({ reportId: id, before: { id, status: 'open' }, after: { id } }),
      ).toEqual({ reportId: id, before: { id, status: 'open' }, after: { id } });
    }
  });

  it('keeps a bare 64-character hex digest unredacted', () => {
    const digest = randomBytes(32).toString('hex');
    expect(redactPersonalData({ note: digest })).toEqual({ note: digest });
    expect(redactPersonalData(digest)).toBe(digest);
  });

  // Fix round 2 (typescript-reviewer HIGH): HEX_DIGEST's `[0-9a-fA-F]{32,}` also matched a
  // pure-digit run of 32+ characters, exempting it from PHONE_CANDIDATE and leaving it
  // unredacted where main redacts it (fail-open). HEX_DIGEST must require at least one a-f
  // letter to exempt a run, so a pure-digit run of this length is still redacted.
  it.each([32, 33, 40])('still redacts a pure-digit run of %d digits', (length) => {
    const run = '1'.repeat(length);
    expect(redactPersonalData(run)).toBe(REDACTED);
    expect(
      redactPersonalData({ reportId: 'rp_1', before: { id: run }, after: { id: run } }),
    ).toEqual({
      reportId: 'rp_1',
      before: { id: REDACTED },
      after: { id: REDACTED },
    });
  });

  it('still keeps a 32-char hex digest with exactly one letter unredacted', () => {
    const digest = `${'1'.repeat(31)}a`;
    expect(redactPersonalData({ note: digest })).toEqual({ note: digest });
    expect(redactPersonalData(digest)).toBe(digest);
  });

  it('still redacts a phone number that sits next to, not inside, a prefixed id', () => {
    const id = 'rp_1234567890123456789012345678901234567890';
    expect(redactPersonalData({ note: `${id} call 555-010-0199` })).toEqual({
      note: `${id} call ${REDACTED}`,
    });
  });

  it('keeps a __proto__ key as data, without touching the prototype', () => {
    const input = JSON.parse('{"__proto__":{"email":"e","polluted":true},"ok":1}') as unknown;
    const out = redactPersonalData(input) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.parse(JSON.stringify(out))).toEqual(
      JSON.parse('{"__proto__":{"email":"[redacted]","polluted":true},"ok":1}'),
    );
  });
});

// 8.7o: EMAIL ran in quadratic time on adversarial input, because its local-part alternation
// `[\p{L}\p{N}._%+-]+` could start a match attempt at every position of a long run of local-part
// characters. The fix adds a lookbehind so a match attempt can only start where the previous
// character is not itself a local-part character, making the scan linear. These tests pin a loose
// time bound (CI-safe) and check, with a differential property test against the old regex, that
// no output changes.
describe('EMAIL linear time (8.7o)', () => {
  // The pre-8.7o regex, kept test-only so the differential test below can compare old vs new
  // output. Do not use this constant outside tests.
  const OLD_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

  /** A loose CI-safe bound: adversarial input must finish well under this, not be instant. */
  const TIME_BOUND_MS = 100;

  function timed(fn: () => void): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }

  it.each([
    ['a long run with no @', 'a1_'.repeat(200_000)],
    ['a long run with one trailing @', `${'a1_'.repeat(200_000)}@`],
    ['a long dotted local-part run with no @', 'a.'.repeat(300_000)],
    ['a long dotted local-part run with a trailing @', `${'a.'.repeat(300_000)}@`],
    ['a long dotted domain after @', `x@${'a.'.repeat(300_000)}`],
    ['a long dashed domain after @', `x@${'a-'.repeat(300_000)}`],
  ])('redacts %s in under %dms'.replace('%dms', `${TIME_BOUND_MS}ms`), (_label, input) => {
    let out = '';
    const ms = timed(() => {
      out = redactPersonalData(input) as string;
    });
    expect(ms).toBeLessThan(TIME_BOUND_MS);
    // None of these inputs contains a full email (no valid domain follows the `@`, or there is no
    // `@` at all), so nothing should be redacted: the timing test must not mask a correctness
    // regression. Correctness on real email-shaped input is covered by the differential test below.
    expect(out).toBe(input);
  });

  /** Seeded PRNG (mulberry32): deterministic, so a differential failure is reproducible. */
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ALPHABET = 'abcABC012._%+-@ ';

  function randomString(rand: () => number, maxLength: number): string {
    const length = Math.floor(rand() * (maxLength + 1));
    let s = '';
    for (let i = 0; i < length; i += 1) {
      s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    }
    return s;
  }

  const EXISTING_EMAIL_STRINGS = [
    'someone@example.com',
    'write to someone.else+tag@example.com today',
    'SOMEONE@EXAMPLE.ORG',
    'a@example.com, b@example.org',
    '@mention and a@b',
    'the student reset their progress',
    '12345678-1234-4234-8234-123456789012',
    'abc5551234567',
    'id12345678-1234-4234-8234-123456789012',
  ];

  it('matches the old (quadratic) regex output on every existing email test string', () => {
    for (const s of EXISTING_EMAIL_STRINGS) {
      expect(s.replace(EMAIL, REDACTED)).toBe(s.replace(OLD_EMAIL, REDACTED));
    }
  });

  it('matches the old (quadratic) regex output on 2,000 seeded random strings', () => {
    const rand = mulberry32(0xe4d7a7e);
    for (let i = 0; i < 2000; i += 1) {
      const s = randomString(rand, 60);
      const oldOut = s.replace(OLD_EMAIL, REDACTED);
      const newOut = s.replace(EMAIL, REDACTED);
      expect(newOut).toBe(oldOut);
    }
  });
});
