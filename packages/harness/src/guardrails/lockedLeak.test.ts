// Task 4.6: the lockedLeak guard, the check closure every call site uses, and the locked reply.
// Material is synthetic (retrievalWorld); no real teacher content here.
import { GuardResultSchema, type RetrievalIndex } from '@edmate/contracts';
import { demoPedagogyDecision, demoTurnContext } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { memoryRetrieval, retrievalWorld } from '../testing/memoryRetrieval.js';
import { virtualClock } from '../testing/virtualClock.js';
import type { PostGuardCtx } from './answerLeak.js';
import { runGuardChain } from './chain.js';
import {
  createLockedCheck,
  createLockedLeakGuard,
  LOCKED_CHECK_TIMEOUT_MS,
  LockedCheckFailed,
  LockedLeakDetected,
  lockedReplyText,
} from './lockedLeak.js';
import { postGuards } from './postGuards.js';

const LOCKED = 'Integration by parts: choose u and dv, then integrate.';
const CLEAN = 'Fractions name equal parts of a whole, and a common denominator helps.';
const SCOPE = { teacherId: 'tch_test_01', allowedModuleIds: ['mod_test_01', 'mod_test_02'] };
const REPLY = lockedReplyText('Free');
const token = cancelSource().token;

function checkWith(retrieval: Pick<RetrievalIndex, 'leakCheck'>, studentText?: string) {
  const clock = virtualClock();
  const check = createLockedCheck({
    retrieval,
    teacherId: SCOPE.teacherId,
    allowedModuleIds: SCOPE.allowedModuleIds,
    clock,
    ...(studentText === undefined ? {} : { studentText }),
  });
  return { clock, check, run: (texts: string[]) => clock.drive(check(texts)) };
}

const ctxWith = (lockedCheck: PostGuardCtx['lockedCheck']): PostGuardCtx => ({
  ctx: demoTurnContext,
  decision: demoPedagogyDecision,
  lockedCheck,
  lockedReply: REPLY,
});

describe('createLockedCheck: the one way the harness asks the index', () => {
  it('asks leakCheck with the folded candidates and the allowed-module scope', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const { run } = checkWith(r);
    expect(await run([`Here: ${LOCKED}`])).toBe(true);
    expect(await run([CLEAN])).toBe(false);
    expect(r.leakChecks).toEqual([
      { candidates: 1, scope: SCOPE },
      { candidates: 1, scope: SCOPE },
    ]);
  }, 5_000);

  it('makes no call when no text has 8 tokens (nothing could match)', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    expect(await checkWith(r).run(['Integration by parts.', ''])).toBe(false);
    expect(await checkWith(r).run([])).toBe(false);
    expect(r.leakChecks).toEqual([]);
  }, 5_000);

  it('does not count the student’s own words, quoted back', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const { run } = checkWith(r, `My friend's notes say "${LOCKED}" What is dv?`);
    expect(await run([`You quoted: "${LOCKED}"`])).toBe(false);
  }, 5_000);

  it('sends a copy of the scope, so the index can’t change the entitlement', async () => {
    const seen: string[][] = [];
    const { run } = checkWith({
      leakCheck: (_c, s) => {
        seen.push(s.allowedModuleIds);
        s.allowedModuleIds.push('mod_x');
        return Promise.resolve({ hit: false });
      },
    });
    await run([LOCKED]);
    await run([LOCKED]);
    expect(seen.map((s) => s.length)).toEqual([3, 3]);
  }, 5_000);

  it('rejects (fails closed) on a timeout, an error, a throw or a bad result; no text', async () => {
    const cases: [Pick<RetrievalIndex, 'leakCheck'>, string][] = [
      [{ leakCheck: () => new Promise(() => undefined) }, 'timeout'],
      [{ leakCheck: () => Promise.reject(new TypeError(`boom ${LOCKED}`)) }, 'error'],
      [
        {
          leakCheck: () => {
            throw new RangeError('sync');
          },
        },
        'error',
      ],
      [{ leakCheck: () => Promise.resolve({ hit: 'yes' } as never) }, 'invalid'],
      [{ leakCheck: () => Promise.resolve({ hit: true, score: 1 } as never) }, 'invalid'],
      [{ leakCheck: () => Promise.resolve(null as never) }, 'invalid'],
    ];
    for (const [retrieval, cause] of cases) {
      const { run } = checkWith(retrieval);
      const e = await run([LOCKED]).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LockedCheckFailed);
      expect((e as LockedCheckFailed).reason).toBe(cause);
      expect((e as Error).message).not.toContain('Integration');
    }
    const e = (await checkWith({ leakCheck: () => Promise.reject(new TypeError('x')) })
      .run([LOCKED])
      .catch((x: unknown) => x)) as LockedCheckFailed;
    expect(e.errorName).toBe('TypeError');
    expect(e.message).toBe('locked check failed: error (TypeError)');
  }, 5_000);

  it('times out after LOCKED_CHECK_TIMEOUT_MS on the injected clock', async () => {
    expect(LOCKED_CHECK_TIMEOUT_MS).toBe(150);
    const { clock, run } = checkWith({ leakCheck: () => new Promise(() => undefined) });
    const started = clock.now();
    await run([LOCKED]).catch(() => undefined);
    expect(clock.now() - started).toBe(LOCKED_CHECK_TIMEOUT_MS);
  }, 5_000);
});

describe('lockedLeak guard', () => {
  const guard = createLockedLeakGuard();

  it('is the registered post guard, ahead of answerLeak', () => {
    expect(guard.name).toBe('lockedLeak');
    expect(guard.phase).toBe('post');
    expect(postGuards.ordered().map((g) => g.name)).toEqual(['lockedLeak', 'answerLeak']);
  }, 5_000);

  it('a clean reply is ok, with no usage', async () => {
    const out = await guard.run(
      CLEAN,
      ctxWith(() => Promise.resolve(false)),
      token,
    );
    expect(out).toEqual({ result: { ok: true }, usage: [] });
  }, 5_000);

  it('a hit replaces the whole reply with the locked reply (no surgical strip)', async () => {
    const seen: (readonly string[])[] = [];
    const x = ctxWith((texts) => {
      seen.push(texts);
      return Promise.resolve(true);
    });
    const out = await guard.run(`Good question. ${LOCKED} Hope that helps.`, x, token);
    expect(out).toEqual({
      result: { ok: false, action: 'rewrite', text: REPLY, reason: 'locked' },
      usage: [],
    });
    expect(GuardResultSchema.safeParse(out.result).success).toBe(true);
    expect(seen).toEqual([[`Good question. ${LOCKED} Hope that helps.`]]);
  }, 5_000);

  it('is idempotent by construction: the locked reply passes without asking the index', async () => {
    let calls = 0;
    const x = ctxWith(() => {
      calls++;
      return Promise.resolve(true);
    });
    expect(await guard.run(REPLY, x, token)).toEqual({ result: { ok: true }, usage: [] });
    expect(calls).toBe(0);
  }, 5_000);

  it('a failed check throws, so the chain fails closed', async () => {
    const x = ctxWith(() => Promise.reject(new LockedCheckFailed('timeout')));
    await expect(guard.run(LOCKED, x, token)).rejects.toBeInstanceOf(LockedCheckFailed);
    const chain = await runGuardChain([guard], LOCKED, x, {
      phase: 'post',
      clock: virtualClock(),
      timeoutMs: 100,
    });
    expect(chain.outcome).toBe('failed');
  }, 5_000);

  it('in the chain, a hit rewrites and the verification pass accepts the locked reply', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const { check, clock } = checkWith(r);
    const out = await clock.drive(
      runGuardChain(postGuards.ordered(), `Sure. ${LOCKED}`, ctxWith(check), {
        phase: 'post',
        clock,
        timeoutMs: 400,
      }),
    );
    expect(out).toMatchObject({ outcome: 'ok', text: REPLY });
    expect(out.guards).toEqual([
      { name: 'lockedLeak', ok: false, action: 'rewrite' },
      { name: 'answerLeak', ok: true },
      { name: 'lockedLeak', ok: true },
      { name: 'answerLeak', ok: true },
    ]);
  }, 5_000);
});

describe('lockedReplyText', () => {
  it('names only the student’s own package when given one, else stays generic', () => {
    expect(lockedReplyText('Free starter')).toContain('Free starter');
    expect(lockedReplyText()).not.toMatch(/,\s*,/);
    expect(lockedReplyText()).toContain('your current package');
    for (const t of [lockedReplyText(), lockedReplyText('Free starter')]) {
      expect(t.length).toBeGreaterThan(0);
      expect(t).not.toMatch(/\d/);
    }
  }, 5_000);
});

describe('reports carry no text', () => {
  it('LockedLeakDetected names the site only', () => {
    const e = new LockedLeakDetected('stream');
    expect(e.name).toBe('LockedLeakDetected');
    expect(e.site).toBe('stream');
    expect(e.message).toBe('locked material withheld (stream)');
  }, 5_000);

  it('LockedCheckFailed names the cause and, at most, an error name', () => {
    const e = new LockedCheckFailed('invalid');
    expect(e.name).toBe('LockedCheckFailed');
    expect(e.message).toBe('locked check failed: invalid');
    expect(e.errorName).toBeUndefined();
  }, 5_000);
});
