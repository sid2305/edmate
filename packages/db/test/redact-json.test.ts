// Unit (no database): redactPersonalData scrubs personal keys out of audit before/after payloads.
import { describe, expect, it } from 'vitest';
import { REDACTED, REDACT_MAX_DEPTH, redactPersonalData } from '../src/index.js';

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
