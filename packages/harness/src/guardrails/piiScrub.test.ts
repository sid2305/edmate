// Fixture PII is fake (from the eval cases). Test names carry labels only, never the values.
import { GuardResultSchema, LIMITS, type LocalePack } from '@edmate/contracts';
import { demoLocalePack } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { indiaLocalePackWithPii } from '../testing/piiLocaleFixtures.js';
import { PII_SCRUB_CASES, piiScrubCaseFailures } from '../testing/piiScrubCases.js';
import { virtualClock } from '../testing/virtualClock.js';
import { runGuardChain } from './chain.js';
import { PII_PLACEHOLDERS as P, PiiPatternError } from './piiPatterns.js';
import { createPiiScrubGuard, type PiiScrubCtx } from './piiScrub.js';

const IN: PiiScrubCtx = { locale: indiaLocalePackWithPii };
const token = cancelSource().token;
const guard = createPiiScrubGuard();
const run = (text: string, ctx: PiiScrubCtx = IN) => guard.run(text, ctx, token);

/** 4.2's cases, shared with @edmate/content's test of the real IN pack (task 3.10). */
const CASES = PII_SCRUB_CASES;

describe('createPiiScrubGuard', () => {
  it('is the scrub-phase piiScrub guard', () => {
    expect(guard.name).toBe('piiScrub');
    expect(guard.phase).toBe('scrub');
  });

  it.each(CASES)('$label → rewrite with the span replaced by its placeholder', async (c) => {
    const { result, usage } = await run(c.input);
    expect(result).toEqual({ ok: false, action: 'rewrite', text: c.text, reason: c.reason });
    expect(GuardResultSchema.parse(result)).toEqual(result);
    expect(usage).toEqual([]);
  });

  it.each(CASES)('$label → the reason never contains the matched text', async (c) => {
    const { result } = await run(c.input);
    expect(result.ok).toBe(false);
    const reason = (result as { reason: string }).reason;
    expect(reason).not.toContain(c.pii);
    expect(reason).toMatch(
      /^redacted: (?:card|phone|id|otp|email|name)(?:, (?:card|phone|id|otp|email|name))*$/,
    );
    expect(reason.length).toBeLessThanOrEqual(LIMITS.guardReasonMaxLength);
  });

  it('names every category found, once each, in a fixed order', async () => {
    const { result } = await run(
      "I'm Aarav. aarav.student@example.com, 90000 11111, PAN ABCDE1234F",
    );
    expect(result).toMatchObject({ reason: 'redacted: phone, id, email, name' });
  });

  it.each([
    ['plain question', 'How do I add 1/2 and 1/3?'],
    ['marks', 'mere 3 subjects mein 78, 85 aur 91 marks aaye'],
    ['empty', ''],
  ])('%s → ok, text untouched', async (_label, input) => {
    expect(await run(input)).toEqual({ result: { ok: true }, usage: [] });
  });

  it('reads the locale patterns from ctx.locale: none → locale ids pass', async () => {
    const none: PiiScrubCtx = { locale: { ...demoLocalePack, piiPatterns: [] } };
    expect((await run('my PAN is ABCDE1234F', none)).result).toEqual({ ok: true });
    // The generic patterns run whatever the pack says.
    expect((await run('call 90000 11111', none)).result).toMatchObject({ action: 'rewrite' });
  });

  it('uses the demo pack pattern too', async () => {
    const demo: PiiScrubCtx = { locale: demoLocalePack };
    expect((await run('id 1234 5678 9012', demo)).result).toMatchObject({ text: `id ${P.id}` });
  });

  it('fails closed: a locale pattern that does not compile with gu throws PiiPatternError', async () => {
    const bad: LocalePack = { ...demoLocalePack, piiPatterns: [String.raw`\a`] };
    await expect(run('hello', { locale: bad })).rejects.toBeInstanceOf(PiiPatternError);
    // A second call with the same pack fails again (the failure is never cached as a pass).
    await expect(run('hello', { locale: bad })).rejects.toBeInstanceOf(PiiPatternError);
  });

  it('compiles each pack once (same array, same result)', async () => {
    const pack: LocalePack = {
      ...demoLocalePack,
      piiPatterns: [...indiaLocalePackWithPii.piiPatterns],
    };
    const a = await run('my PAN is ABCDE1234F', { locale: pack });
    const b = await run('my PAN is ABCDE1234F', { locale: pack });
    expect(a).toEqual(b);
  });
});

describe('piiScrubCaseFailures (the shared runner)', () => {
  it('none for the India pack', async () => {
    expect(await piiScrubCaseFailures(IN)).toEqual([]);
  });

  it('names, by label only, each case a pack without the India patterns misses', async () => {
    const none: PiiScrubCtx = { locale: { ...demoLocalePack, piiPatterns: [] } };
    expect(await piiScrubCaseFailures(none)).toEqual([
      'Aadhaar-like (locale)',
      'PAN (locale)',
      'UPI id (locale)',
    ]);
  });
});

describe('piiScrub in the guard chain', () => {
  const opts = () => ({
    phase: 'scrub' as const,
    clock: virtualClock({ start: 0 }),
    timeoutMs: 50,
  });

  it('returns ok on its own output: the verification pass accepts the rewrite', async () => {
    for (const c of CASES) {
      const r = await runGuardChain([guard], c.input, IN, opts());
      expect(r).toMatchObject({ outcome: 'ok', text: c.text });
      expect(r.guards).toEqual([
        { name: 'piiScrub', ok: false, action: 'rewrite' },
        { name: 'piiScrub', ok: true },
      ]);
    }
  });

  it('scrubbing twice equals scrubbing once, and the second pass returns ok', async () => {
    for (const c of CASES) {
      const once = await run(c.input);
      const text = (once.result as { text: string }).text;
      expect(await run(text)).toEqual({ result: { ok: true }, usage: [] });
    }
  });

  it('a bad locale pattern makes the chain fail with the error name only', async () => {
    const bad: LocalePack = { ...demoLocalePack, piiPatterns: ['ok', String.raw`9000011111\a`] };
    const r = await runGuardChain([guard], 'call 90000 11111', { locale: bad }, opts());
    expect(r).toMatchObject({
      outcome: 'failed',
      failure: { name: 'piiScrub', cause: 'error', errorName: 'PiiPatternError' },
    });
    expect(JSON.stringify(r)).not.toContain('90000');
  });

  it('a rewrite past the model-text cap is rejected by the chain (fails closed)', async () => {
    const huge = `my name is Al${' Al'.repeat(2_000)}`;
    const r = await runGuardChain([guard], huge, IN, opts());
    expect(r).toMatchObject({ outcome: 'failed', failure: { cause: 'invalid_result' } });
  });
});
