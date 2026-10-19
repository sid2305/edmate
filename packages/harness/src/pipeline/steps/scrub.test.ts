// Fixture PII is fake (from the eval cases). Test names carry labels only, never the values.
import { type GuardResult, LIMITS, type LocalePack, type TurnInput } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoSafetyAlert,
  demoStyleCard,
  demoTurnInput,
  turnInputHint,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import type { Guard } from '../../guardrails/guard.js';
import type { PiiScrubCtx } from '../../guardrails/piiScrub.js';
import { PII_PLACEHOLDERS as P } from '../../guardrails/piiPatterns.js';
import { fakeGuard } from '../../testing/guardFixtures.js';
import { indiaLocalePackWithPii } from '../../testing/piiLocaleFixtures.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import { cancelSource, type CancelToken } from '../clock.js';
import { ScrubFailedError } from '../errors.js';
import { ScrubbedSchema } from '../results.js';
import type { Entitled, StepEnv } from '../types.js';
import { defaultSteps } from './index.js';
import { createScrub, SCRUB_GUARD_TIMEOUT_MS, scrub } from './scrub.js';

const PHONE = '90000 11111';
const entitled = (locale: LocalePack = indiaLocalePackWithPii): Entitled => ({
  entitlement: demoEntitlementSubscription,
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  locale,
  styleCard: demoStyleCard,
});

function setup(input: TurnInput, cancel: CancelToken = cancelSource().token) {
  const t = testDeps();
  const env: StepEnv = { input, deps: t.deps, cancel, turnId: 'turn_x', ...stepEnvExtras() };
  return { t, env, drive: <T>(p: Promise<T>) => t.clock.drive(p) };
}

const withText = (text: string): TurnInput => ({ ...demoTurnInput, text });

/** Everything an error shows when logged or serialised. */
function shown(e: unknown): string {
  const err = e as Error;
  return [String(err), err.message, err.stack, JSON.stringify({ ...err, cause: err.cause })].join(
    '\n',
  );
}

async function failure(p: Promise<unknown>): Promise<ScrubFailedError> {
  const e: unknown = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ScrubFailedError);
  return e as ScrubFailedError;
}

describe('scrub (step 3a)', () => {
  it('rewrites the text through the registered piiScrub guard', async () => {
    const { env, drive } = setup(withText(`save my number ${PHONE} please`));
    const r = await drive(scrub(env, entitled()));
    expect(r).toEqual({
      text: `save my number ${P.phone} please`,
      guards: [
        { name: 'piiScrub', ok: false, action: 'rewrite' },
        { name: 'piiScrub', ok: true },
      ],
    });
    expect(ScrubbedSchema.parse(r)).toEqual(r);
  });

  it('is what defaultSteps uses', async () => {
    expect(defaultSteps.scrub).toBe(scrub);
  });

  it('passes clean text through unchanged', async () => {
    const { env, drive } = setup(demoTurnInput);
    expect(await drive(scrub(env, entitled()))).toEqual({
      text: demoTurnInput.text,
      guards: [{ name: 'piiScrub', ok: true }],
    });
  });

  it('a text-less input stays text-less (the guard still runs, on nothing)', async () => {
    const { env, drive } = setup(turnInputHint);
    expect(await drive(scrub(env, entitled()))).toEqual({
      guards: [{ name: 'piiScrub', ok: true }],
    });
  });

  it("applies the entitlement's locale patterns", async () => {
    const pan = withText('my PAN is ABCDE1234F');
    const none = { ...demoLocalePack, piiPatterns: [] };
    expect((await setup(pan).drive(scrub(setup(pan).env, entitled(none)))).text).toBe(pan.text);
    const { env, drive } = setup(pan);
    expect((await drive(scrub(env, entitled()))).text).toBe(`my PAN is ${P.id}`);
  });

  it('gives each guard its own time slice', () => {
    expect(SCRUB_GUARD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SCRUB_GUARD_TIMEOUT_MS).toBeLessThan(400);
  });
});

describe('scrub: skillPayload (no bypass)', () => {
  const payload = {
    code: `phone = "${PHONE}"`,
    nested: { list: ['fine', 'mail aarav.student@example.com', 9000011111, 42, true, null] },
    [`note ${PHONE}`]: 'key with a number',
    deep: [[['OTP 482913']]],
  };

  it('scrubs every string, key and PII-shaped number; keeps everything else', async () => {
    const { env, drive } = setup({ ...demoTurnInput, skillPayload: payload });
    const r = await drive(scrub(env, entitled()));
    expect(r.text).toBe(demoTurnInput.text);
    expect(r.skillPayload).toEqual({
      code: `phone = "${P.phone}"`,
      nested: { list: ['fine', `mail ${P.email}`, P.id, 42, true, null] },
      [`note ${P.phone}`]: 'key with a number',
      deep: [[[`OTP ${P.otp}`]]],
    });
    expect(JSON.stringify(r)).not.toMatch(/90000|9000011111|aarav|482913/);
    // The trace shows the payload was rewritten too (once, not once per string).
    expect(r.guards).toEqual([
      { name: 'piiScrub', ok: true },
      { name: 'piiScrub', ok: false, action: 'rewrite' },
      { name: 'piiScrub', ok: true },
    ]);
    expect(ScrubbedSchema.parse(r)).toEqual(r);
  });

  it('a clean payload comes back equal, and the trace has only the text run', async () => {
    const clean = { a: ['x', 1, { b: 'y' }], c: null };
    const { env, drive } = setup({ ...demoTurnInput, skillPayload: clean });
    const r = await drive(scrub(env, entitled()));
    expect(r.skillPayload).toEqual(clean);
    expect(r.guards).toEqual([{ name: 'piiScrub', ok: true }]);
  });

  it('a scalar payload is scrubbed too', async () => {
    const { env, drive } = setup({ ...turnInputHint, skillPayload: `call ${PHONE}` });
    expect((await drive(scrub(env, entitled()))).skillPayload).toBe(`call ${P.phone}`);
    const n = setup({ ...turnInputHint, skillPayload: null });
    expect(await n.drive(scrub(n.env, entitled()))).toMatchObject({ skillPayload: null });
  });

  it('no payload → no skillPayload key', async () => {
    const { env, drive } = setup(demoTurnInput);
    expect(await drive(scrub(env, entitled()))).not.toHaveProperty('skillPayload');
  });

  it('a "__proto__" key stays an own key, never a prototype', async () => {
    const raw = JSON.parse('{"__proto__": {"x": "call 90000 11111"}}') as unknown;
    const { env, drive } = setup({ ...demoTurnInput, skillPayload: raw });
    const r = (await drive(scrub(env, entitled()))).skillPayload as Record<string, unknown>;
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(Object.hasOwn(r, '__proto__')).toBe(true);
    expect(JSON.stringify(r)).toBe(`{"__proto__":{"x":"call ${P.phone}"}}`);
  });

  it('fails closed when two keys scrub to the same key', async () => {
    const clash = { [`a ${PHONE}`]: 1, 'a 90000 22222': 2 };
    const { env, drive } = setup({ ...demoTurnInput, skillPayload: clash });
    const e = await failure(drive(scrub(env, entitled())));
    expect(e.cause).toEqual({ guardCause: 'payload_shape' });
  });

  it('fails closed on a payload nested past the depth cap', async () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 70; i++) deep = [deep];
    const { env, drive } = setup({ ...demoTurnInput, skillPayload: deep });
    expect((await failure(drive(scrub(env, entitled())))).cause).toEqual({
      guardCause: 'payload_shape',
    });
  });

  it('fails closed on a payload that is not JSON data', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const bad of [circular, () => 1]) {
      const { env, drive } = setup({ ...demoTurnInput, skillPayload: bad });
      expect((await failure(drive(scrub(env, entitled())))).cause).toEqual({
        guardCause: 'payload_shape',
      });
    }
  });

  it('a guard failure on a payload string fails the whole scrub', async () => {
    const onlyPayload = fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', (text) => {
      if (text.includes('boom')) throw new Error(`cannot scrub ${text}`);
      return { ok: true };
    });
    const step = createScrub([onlyPayload]);
    const { env, drive } = setup({ ...demoTurnInput, skillPayload: { a: `boom ${PHONE}` } });
    const e = await failure(drive(step(env, entitled())));
    expect(e.cause).toEqual({ guardCause: 'error', errorName: 'Error' });
    expect(shown(e)).not.toContain(PHONE);
  });

  it('scrubs a repeated string once', async () => {
    const g = fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', { ok: true });
    const { env, drive } = setup({ ...demoTurnInput, skillPayload: ['same', 'same', 'same'] });
    await drive(createScrub([g])(env, entitled()));
    expect(g.calls.map((c) => c.text)).toEqual([demoTurnInput.text, 'same']);
  });
});

describe('scrub: values under PII-named keys are redacted whole (fix round)', () => {
  const run = async (skillPayload: unknown) => {
    const { env, drive } = setup({ ...demoTurnInput, skillPayload });
    return drive(scrub(env, entitled()));
  };

  it('a bare OTP (no keyword in the value) is redacted', async () => {
    expect((await run({ otp: '482913' })).skillPayload).toEqual({ otp: P.otp });
  });

  it.each([
    ['phone', { phone: '9000011111' }, { phone: P.phone }],
    ['mobile number as a number', { mobile_number: 9000011111 }, { mobile_number: P.phone }],
    ['email', { Email: 'riya' }, { Email: P.email }],
    ['card number', { cardNumber: '4111' }, { cardNumber: P.card }],
    ['cvv', { cvv: 123 }, { cvv: P.card }],
    ['aadhaar', { aadhaar: '1234' }, { aadhaar: P.id }],
    ['pan', { PAN: 'ABCDE' }, { PAN: P.id }],
    ['upi id', { 'upi-id': 'riya' }, { 'upi-id': P.id }],
    ['student name', { studentName: 'Riya Sen' }, { studentName: P.name }],
    ['student name, one word (fix round)', { studentName: 'Riya' }, { studentName: P.name }],
    ['pin code (compound, not bare "pin")', { pinCode: '411001' }, { pinCode: P.otp }],
    [
      'an array is still the key’s own value',
      { studentName: ['Riya', 'Sen'] },
      { studentName: [P.name, P.name] },
    ],
    [
      'empty, boolean and null values stay',
      { name: '', otp: null, phone: true },
      { name: '', otp: null, phone: true },
    ],
  ] as const)('%s', async (_label, payload, expected) => {
    expect((await run(payload)).skillPayload).toEqual(expected);
  });

  it('ordinary keys are left to the pattern scrub', async () => {
    const payload = { fileName: 'main.py', code: 'name = "x"', names: ['Riya'], panel: 'left' };
    expect((await run(payload)).skillPayload).toEqual(payload);
  });

  it('the trace shows the payload rewrite', async () => {
    expect((await run({ otp: '482913' })).guards).toEqual([
      { name: 'piiScrub', ok: true },
      { name: 'piiScrub', ok: false, action: 'rewrite' },
    ]);
  });
});

describe('scrub: a bare "name"/"card"/"pin" key redacts its own scalar value (fix round, CRITICAL)', () => {
  const run = async (skillPayload: unknown) => {
    const { env, drive } = setup({ ...demoTurnInput, skillPayload });
    return drive(scrub(env, entitled()));
  };

  // 4.2c item 7's "ambiguous, needs a compound form" rule let a bare "name"/"card"/"pin" key's
  // own scalar value reach the model unredacted ({"name":"Riya Sen"} never redacted at all). The
  // ambiguity only ever needs to stop a bare key's category spreading into an unrelated NESTED
  // key, which a key-less nested object or array element already does on its own (see below); it
  // must never block the key's own direct value.
  it.each([
    ['bare "name" at the top level', { name: 'Riya' }, { name: P.name }],
    ['bare "name", a full name', { name: 'Riya Sen' }, { name: P.name }],
    ['bare "pin", a 6-digit PIN string', { pin: '411001' }, { pin: P.otp }],
    ['bare "pin", a 4-digit postcode-shaped string', { pin: '1100' }, { pin: P.otp }],
    ['student name (prefixed, not bare)', { studentName: 'Riya' }, { studentName: P.name }],
  ] as const)('%s', async (_label, payload, expected) => {
    expect((await run(payload)).skillPayload).toEqual(expected);
  });

  it.each([
    ['bare "card" with an object value is a flashcard, not a payment card', { card: { front: 'What is a list?' } }],
    [
      'bare "name" nested under a file-like key is a file name, not a person',
      { files: [{ name: 'main.py' }] },
    ],
    ['bare "pin", a short number is not a PIN code', { pin: 13 }],
  ] as const)('left alone: %s', async (_label, payload) => {
    expect((await run(payload)).skillPayload).toEqual(payload);
  });

  it('bare "name" with an object value redacts its direct name-like fields only', async () => {
    const payload = { name: { first: 'Riya', last: 'Sen' } };
    expect((await run(payload)).skillPayload).toEqual({ name: { first: P.name, last: P.name } });
  });

  it('an object value under a PII-named key does not propagate into its own unrelated keys', async () => {
    const payload = { studentName: { nickname: 'Riya', initials: 'RS' } };
    expect((await run(payload)).skillPayload).toEqual(payload);
  });

  it('compound forms of the same ambiguous words still redact', async () => {
    expect((await run({ cardNumber: '4111' })).skillPayload).toEqual({ cardNumber: P.card });
    expect((await run({ studentName: 'Riya' })).skillPayload).toEqual({ studentName: P.name });
    expect((await run({ pinCode: '411001' })).skillPayload).toEqual({ pinCode: P.otp });
  });
});

describe('scrub: the file-like-parent exemption also needs the value to look like a file or identifier (fix round 2, HIGH)', () => {
  const run = async (skillPayload: unknown) => {
    const { env, drive } = setup({ ...demoTurnInput, skillPayload });
    return drive(scrub(env, entitled()));
  };

  // Fix round 1 keyed the exemption on the enclosing key's name alone, so a person's name under
  // `files`, `module`, `function`, `class` or `variable` was never redacted, at any depth. Now
  // both have to hold: the parent is file-shaped AND the value itself looks like a file name or a
  // plain identifier (a dot-extension, or a single no-whitespace token that isn't a bare
  // Title-Case word). Unsure cases redact (fail toward privacy).
  it.each([
    ['a name under "files"', { files: [{ name: 'Riya Sen' }] }, { files: [{ name: P.name }] }],
    ['a one-word name under "module"', { module: { name: 'Riya' } }, { module: { name: P.name } }],
    ['a name under "function"', { function: { name: 'Riya Sen' } }, { function: { name: P.name } }],
    ['a name under "class"', { class: { name: 'Riya Sen' } }, { class: { name: P.name } }],
    ['a name under "variable"', { variable: { name: 'Riya Sen' } }, { variable: { name: P.name } }],
    [
      'a name under "files" nested two levels deep',
      { project: { files: [{ name: 'Riya Sen' }] } },
      { project: { files: [{ name: P.name }] } },
    ],
  ] as const)('%s', async (_label, payload, expected) => {
    expect((await run(payload)).skillPayload).toEqual(expected);
  });

  it.each([
    ['a dot-extension file name under "files"', { files: [{ name: 'main.py' }] }],
    ['a snake_case identifier under "function"', { function: { name: 'greet_user' } }],
  ] as const)('still left alone: %s', async (_label, payload) => {
    expect((await run(payload)).skillPayload).toEqual(payload);
  });
});

describe('scrub at the input cap (fix round)', () => {
  const fill = (head: string, unit: string, cap: number) =>
    head + unit.repeat(Math.floor((cap - head.length) / unit.length));

  it.each([
    [
      'a phone keyword before every ten-digit number, at the 8,000-unit length cap',
      fill('', 'call 1234567890 ', LIMITS.turnTextMaxLength),
      400,
    ],
    [
      'a run of ten-digit numbers after one keyword, at the 8,000-unit length cap',
      fill('contact ', '1234567890 ', LIMITS.turnTextMaxLength),
      4,
    ],
    [
      'an OTP keyword before every number, at the 4,000-character cap',
      fill('', 'OTP 4821 ', LIMITS.turnTextMaxChars),
      400,
    ],
    [
      'a run of OTP-like numbers after one keyword, at the 4,000-character cap',
      fill('OTP ', '1234 ', LIMITS.turnTextMaxChars),
      5,
    ],
  ])(
    '%s: settles, scrubs clean, in generous time',
    { timeout: 30_000 },
    async (_label, text, min) => {
      expect(text.length).toBeGreaterThan(LIMITS.turnTextMaxChars - 20);
      const started = Date.now();
      const { env, drive } = setup({
        ...demoTurnInput,
        text,
        skillPayload: { note: text.slice(0, 200) },
      });
      const r = await drive(scrub(env, entitled()));
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(r.guards.slice(0, 2)).toEqual([
        { name: 'piiScrub', ok: false, action: 'rewrite' },
        { name: 'piiScrub', ok: true },
      ]);
      // The keyword-adjacent numbers went, and the output is a fixed point.
      expect((r.text ?? '').split('[').length - 1).toBeGreaterThanOrEqual(min);
      const again = setup({ ...demoTurnInput, text: r.text ?? '' });
      expect(await again.drive(scrub(again.env, entitled()))).toEqual({
        text: r.text,
        guards: [{ name: 'piiScrub', ok: true }],
      });
    },
  );
});

describe('scrub: every non-ok outcome fails closed with ids and an error name only', () => {
  const run = async (g: Guard<PiiScrubCtx>, cancel?: CancelToken) => {
    const { env, drive } = setup(withText(`call ${PHONE}`), cancel);
    return failure(drive(createScrub([g])(env, entitled())));
  };
  const rewriteAlways: GuardResult = {
    ok: false,
    action: 'rewrite',
    text: `x ${PHONE}`,
    reason: `saw ${PHONE}`,
  };

  it.each([
    [
      'a thrown Error (its message holds the text)',
      () =>
        fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', (t) => {
          throw new Error(`failed on ${t}`);
        }),
      { guardCause: 'error', errorName: 'Error' },
    ],
    [
      'a thrown TypeError',
      () =>
        fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', (t) => {
          throw new TypeError(t);
        }),
      { guardCause: 'error', errorName: 'TypeError' },
    ],
    [
      'a schema-invalid result',
      () =>
        fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', {
          ok: false,
          action: 'nope',
          reason: PHONE,
        } as unknown as GuardResult),
      { guardCause: 'invalid_result' },
    ],
    [
      'a block verdict',
      () =>
        fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', {
          ok: false,
          action: 'block',
          reason: `saw ${PHONE}`,
        }),
      { guardCause: 'verdict' },
    ],
    [
      'a rewrite the second pass rejects',
      () => fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', rewriteAlways),
      { guardCause: 'rewrite_unverified' },
    ],
    [
      'an escalate',
      () =>
        fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', {
          ok: false,
          action: 'escalate',
          alert: demoSafetyAlert,
        }),
      { guardCause: 'escalate' },
    ],
    [
      'an undeclared guard',
      () => fakeGuard<PiiScrubCtx>('moderationIn', 'scrub', { ok: true }),
      { guardCause: 'undeclared' },
    ],
  ] as const)('%s', async (_label, make, cause) => {
    const e = await run(make());
    expect(e.cause).toEqual(cause);
    expect(e.detail).toEqual(cause);
    expect(e.message).toBe(`scrub failed closed (${cause.guardCause})`);
    expect(shown(e)).not.toContain(PHONE);
    expect(shown(e)).not.toContain('saw');
  });

  it('an empty guard list', async () => {
    const { env, drive } = setup(demoTurnInput);
    expect((await failure(drive(createScrub([])(env, entitled())))).cause).toEqual({
      guardCause: 'empty',
    });
  });

  it('a guard past its time slice', async () => {
    const slow: Guard<PiiScrubCtx> = {
      name: 'piiScrub',
      phase: 'scrub',
      run: () => new Promise(() => undefined),
    };
    expect((await run(slow)).cause).toEqual({ guardCause: 'timeout' });
  });

  it('a cancelled step', async () => {
    const c = cancelSource();
    c.cancel();
    expect((await run(fakeGuard('piiScrub', 'scrub', { ok: true }), c.token)).cause).toEqual({
      guardCause: 'cancelled',
    });
  });

  it('a bad locale pattern on the real guard → error PiiPatternError', async () => {
    const bad = { ...demoLocalePack, piiPatterns: [String.raw`\a`] };
    const { env, drive } = setup(withText(`call ${PHONE}`));
    const e = await failure(drive(scrub(env, entitled(bad))));
    expect(e.cause).toEqual({ guardCause: 'error', errorName: 'PiiPatternError' });
  });
});
