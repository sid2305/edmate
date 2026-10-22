import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPaymentsError } from '../src/errors.js';
import { Secret } from '../src/secret.js';
import {
  checkWebhookInput,
  parseJsonBody,
  readHeader,
  WEBHOOK_MAX_BYTES,
} from '../src/webhook/body.js';
import {
  checkSignedTimestamp,
  concatBytes,
  hmacSha256Hex,
  matchesAnySignature,
  MAX_TIMESTAMP_TOLERANCE_SECONDS,
} from '../src/webhook/hmac.js';
import { fakeSecret } from './helpers/fake-secret.js';

const enc = (s: string) => new TextEncoder().encode(s);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return isPaymentsError(err) ? err.code : 'not a PaymentsError';
  }
}

describe('matchesAnySignature', () => {
  const secret = Secret.of(fakeSecret());
  const body = enc('{"event_id":"evt_1"}');
  const good = hmacSha256Hex(secret, body);

  it('accepts a valid signature, in either hex case', () => {
    expect(matchesAnySignature({ payload: body, candidates: [good], secrets: [secret] })).toBe(
      true,
    );
    expect(
      matchesAnySignature({ payload: body, candidates: [good.toUpperCase()], secrets: [secret] }),
    ).toBe(true);
  });

  it('refuses a tampered body or a wrong secret', () => {
    expect(
      matchesAnySignature({
        payload: enc('{"event_id":"evt_2"}'),
        candidates: [good],
        secrets: [secret],
      }),
    ).toBe(false);
    expect(
      matchesAnySignature({
        payload: body,
        candidates: [good],
        secrets: [Secret.of(fakeSecret())],
      }),
    ).toBe(false);
  });

  it.each([
    ['other length', good.slice(0, 62)],
    ['longer', good + '00'],
    ['non-hex', 'z'.repeat(64)],
    ['empty', ''],
  ])('refuses a %s signature without throwing', (_name, candidate) => {
    expect(matchesAnySignature({ payload: body, candidates: [candidate], secrets: [secret] })).toBe(
      false,
    );
  });

  it('refuses when there are no candidates; no secrets is a configuration bug', () => {
    expect(matchesAnySignature({ payload: body, candidates: [], secrets: [secret] })).toBe(false);
    expect(codeOf(() => matchesAnySignature({ payload: body, candidates: [good], secrets: [] }))).toBe(
      'validation',
    );
  });

  it('an empty or blank secret never verifies: it is validation, even next to a good one', () => {
    // Secret.of refuses these, so a stand-in with the same shape reaches the check.
    for (const value of ['', '   ', '\t\n']) {
      const blank = { reveal: () => value } as unknown as Secret;
      const forged = createHmac('sha256', value).update(body).digest('hex');
      expect(
        codeOf(() => matchesAnySignature({ payload: body, candidates: [forged], secrets: [blank] })),
      ).toBe('validation');
      expect(
        codeOf(() =>
          matchesAnySignature({ payload: body, candidates: [good], secrets: [secret, blank] }),
        ),
      ).toBe('validation');
    }
  });

  it('accepts any of several signatures and any of several secrets (rotation)', () => {
    const next = Secret.of(fakeSecret());
    const nextSig = hmacSha256Hex(next, body);
    expect(
      matchesAnySignature({ payload: body, candidates: ['00', nextSig], secrets: [secret, next] }),
    ).toBe(true);
    expect(
      matchesAnySignature({ payload: body, candidates: [good, 'bad'], secrets: [next, secret] }),
    ).toBe(true);
  });
});

describe('concatBytes', () => {
  it('joins strings and bytes in order', () => {
    expect(new TextDecoder().decode(concatBytes('12', ':', enc('{}')))).toBe('12:{}');
    expect(concatBytes().length).toBe(0);
  });
});

describe('checkSignedTimestamp', () => {
  const receivedAt = '2026-10-22T10:00:00.000Z';
  const now = Date.parse(receivedAt) / 1000;

  it('passes inside the tolerance, both directions, edges included', () => {
    for (const signedAtSeconds of [now, now - 300, now + 300, now - 10]) {
      expect(codeOf(() => checkSignedTimestamp({ signedAtSeconds, receivedAt }))).toBeUndefined();
    }
  });

  it('gives stale_signature when older or further in the future than the tolerance', () => {
    expect(codeOf(() => checkSignedTimestamp({ signedAtSeconds: now - 301, receivedAt }))).toBe(
      'stale_signature',
    );
    expect(codeOf(() => checkSignedTimestamp({ signedAtSeconds: now + 301, receivedAt }))).toBe(
      'stale_signature',
    );
    expect(
      codeOf(() =>
        checkSignedTimestamp({ signedAtSeconds: now - 61, receivedAt, toleranceSeconds: 60 }),
      ),
    ).toBe('stale_signature');
    expect(codeOf(() => checkSignedTimestamp({ signedAtSeconds: Number.NaN, receivedAt }))).toBe(
      'stale_signature',
    );
  });

  it('refuses a tolerance above 300 s or a receivedAt that is not an ISO timestamp with Z or an offset', () => {
    expect(MAX_TIMESTAMP_TOLERANCE_SECONDS).toBe(300);
    expect(
      codeOf(() =>
        checkSignedTimestamp({ signedAtSeconds: now, receivedAt, toleranceSeconds: 301 }),
      ),
    ).toBe('validation');
    expect(
      codeOf(() =>
        checkSignedTimestamp({ signedAtSeconds: now, receivedAt, toleranceSeconds: -1 }),
      ),
    ).toBe('validation');
    expect(
      codeOf(() => checkSignedTimestamp({ signedAtSeconds: now, receivedAt: 'yesterday' })),
    ).toBe('validation');
    // Date.parse would read these as local time or accept them; the contracts schema does not.
    for (const bad of ['2026-10-22T10:00:00', '2026-10-22', 'Thu, 22 Oct 2026 10:00:00 GMT']) {
      expect(codeOf(() => checkSignedTimestamp({ signedAtSeconds: now, receivedAt: bad }))).toBe(
        'validation',
      );
    }
    expect(
      codeOf(() =>
        checkSignedTimestamp({ signedAtSeconds: now, receivedAt: '2026-10-22T15:30:00+05:30' }),
      ),
    ).toBeUndefined();
  });
});

describe('webhook body helpers', () => {
  const receivedAt = '2026-10-22T10:00:00.000Z';

  it('accepts bytes up to 1 MiB and refuses more, or a string body', () => {
    expect(WEBHOOK_MAX_BYTES).toBe(1024 * 1024);
    const ok = new Uint8Array(WEBHOOK_MAX_BYTES);
    expect(
      codeOf(() => checkWebhookInput({ rawBody: ok, headers: {}, receivedAt })),
    ).toBeUndefined();
    expect(
      codeOf(() =>
        checkWebhookInput({
          rawBody: new Uint8Array(WEBHOOK_MAX_BYTES + 1),
          headers: {},
          receivedAt,
        }),
      ),
    ).toBe('malformed_event');
    expect(
      codeOf(() => checkWebhookInput({ rawBody: '{}' as never, headers: {}, receivedAt })),
    ).toBe('malformed_event');
  });

  it('refuses missing headers or a receivedAt that is not a date', () => {
    const rawBody = enc('{}');
    expect(codeOf(() => checkWebhookInput({ rawBody, headers: null as never, receivedAt }))).toBe(
      'validation',
    );
    expect(codeOf(() => checkWebhookInput({ rawBody, headers: {}, receivedAt: 'soon' }))).toBe(
      'validation',
    );
    for (const bad of ['2026-10-22T10:00:00', '2026-10-22', 'Thu, 22 Oct 2026 10:00:00 GMT']) {
      expect(codeOf(() => checkWebhookInput({ rawBody, headers: {}, receivedAt: bad }))).toBe(
        'validation',
      );
    }
    expect(
      codeOf(() =>
        checkWebhookInput({ rawBody, headers: {}, receivedAt: '2026-10-22T03:00:00-07:00' }),
      ),
    ).toBeUndefined();
    expect(codeOf(() => checkWebhookInput({ rawBody, headers: {}, receivedAt: 7 as never }))).toBe(
      'validation',
    );
  });

  it('reads own lower-case headers only', () => {
    expect(readHeader({ 'x-signature': 'abc' }, 'x-signature')).toBe('abc');
    expect(readHeader({}, 'x-signature')).toBeUndefined();
    expect(readHeader({}, 'constructor')).toBeUndefined();
    expect(readHeader({ 'x-signature': 5 as never }, 'x-signature')).toBeUndefined();
  });

  it('parses JSON and gives malformed_event for bad JSON or bad UTF-8', () => {
    expect(parseJsonBody(enc('{"a":1}'))).toEqual({ a: 1 });
    expect(codeOf(() => parseJsonBody(enc('{"a":')))).toBe('malformed_event');
    expect(codeOf(() => parseJsonBody(new Uint8Array([0x7b, 0xff, 0x7d])))).toBe('malformed_event');
  });
});
