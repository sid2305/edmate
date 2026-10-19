// Fixture PII is fake (from the eval cases). Test names carry labels only, never the values.
import type { GuardResult, LocalePack, TurnInput } from '@edmate/contracts';
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
import { testDeps } from '../../testing/testSteps.js';
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
  const env: StepEnv = { input, deps: t.deps, cancel, turnId: 'turn_x' };
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
