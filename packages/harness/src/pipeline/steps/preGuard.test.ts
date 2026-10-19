// preGuard (task 4.3): runs the `pre` guard chain on the scrubbed text and maps its outcome.
// ok / escalate / block pass through; a `failed` chain throws (no text in the error), so the
// runner's own distress keyword check still runs (lead answer 11).
import type { Message, TranscriptStore } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoSafetyAlert,
  demoStyleCard,
  demoTurnInput,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { GuardRegistry } from '../../guardrails/registry.js';
import type { PreGuardCtx } from '../../guardrails/preGuardCtx.js';
import { fakeGuard } from '../../testing/guardFixtures.js';
import { memoryTranscriptStore } from '../../testing/memoryPorts.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import { cancelSource } from '../clock.js';
import type { Entitled, PipelineDeps, StepEnv } from '../types.js';
import {
  createPreGuardStep,
  HISTORY_TIMEOUT_MS,
  PreGuardChainFailedError,
  preGuard,
  recentStudentTurns,
} from './preGuard.js';

const entitled: Entitled = {
  entitlement: demoEntitlementSubscription,
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  locale: demoLocalePack,
  styleCard: demoStyleCard,
};

function envWith(text: string | undefined, overrides: Partial<PipelineDeps> = {}) {
  const t = testDeps({ overrides });
  const input = { ...demoTurnInput };
  if (text === undefined) delete (input as { text?: string }).text;
  else input.text = text;
  const reported: unknown[] = [];
  const env: StepEnv = {
    input,
    deps: t.deps,
    cancel: cancelSource().token,
    turnId: 'turn_1',
    ...stepEnvExtras(reported),
    gateway: t.gateway,
  };
  return { env, t, reported };
}

function msg(id: string, role: Message['role'], text: string): Message {
  return { id, role, text, createdAt: '2026-10-17T09:00:00.000Z' };
}

describe('preGuard (default registry: distressDetect)', () => {
  it('hard keyword → escalate with the guard alert; no model call', async () => {
    const { env } = envWith('i want to kill myself', { transcripts: memoryTranscriptStore() });
    const r = await preGuard(env, entitled);
    expect(r).toMatchObject({
      result: 'escalate',
      alert: { kind: 'distress', sessionId: demoTurnInput.sessionId },
      guards: [{ name: 'distressDetect', ok: false, action: 'escalate' }],
      usage: [],
    });
  }, 1_000);

  it('classifier false → ok', async () => {
    const t = testDeps({
      script: { generateObject: [{ value: { distress: false } }] },
      overrides: { transcripts: memoryTranscriptStore() },
    });
    const env: StepEnv = {
      input: demoTurnInput,
      deps: t.deps,
      cancel: cancelSource().token,
      turnId: 'turn_1',
      ...stepEnvExtras(),
      gateway: t.gateway,
    };
    const r = await preGuard(env, entitled);
    expect(r).toEqual({ result: 'ok', guards: [{ name: 'distressDetect', ok: true }], usage: [] });
  }, 1_000);

  it('no keyword + classifier throws → PreGuardChainFailedError without the text', async () => {
    const secret = 'how do i reverse a list SECRET-TEXT';
    const { env } = envWith(secret, { transcripts: memoryTranscriptStore() });
    const err = await preGuard(env, entitled).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PreGuardChainFailedError);
    expect(String((err as Error).message)).not.toContain('SECRET');
    expect((err as PreGuardChainFailedError).failure).toEqual({
      name: 'distressDetect',
      cause: 'error',
      errorName: 'ScriptedGatewayError',
    });
  }, 1_000);
});

describe('createPreGuardStep: outcome mapping', () => {
  const reg = (...guards: Parameters<GuardRegistry<PreGuardCtx>['register']>[0][]) => {
    const r = new GuardRegistry<PreGuardCtx>('pre');
    for (const g of guards) r.register(g);
    return r;
  };

  it('a block verdict maps to result "block" (not a framework failure)', async () => {
    const step = createPreGuardStep(
      reg(fakeGuard('moderationIn', 'pre', { ok: false, action: 'block', reason: 'r' })),
    );
    const { env } = envWith('hello', { transcripts: memoryTranscriptStore() });
    expect(await step(env, entitled)).toEqual({
      result: 'block',
      guards: [{ name: 'moderationIn', ok: false, action: 'block' }],
      usage: [],
    });
  }, 1_000);

  it('escalate from any pre guard passes its alert through', async () => {
    const step = createPreGuardStep(
      reg(fakeGuard('jailbreak', 'pre', { ok: false, action: 'escalate', alert: demoSafetyAlert })),
    );
    const { env } = envWith('hello', { transcripts: memoryTranscriptStore() });
    expect(await step(env, entitled)).toMatchObject({ result: 'escalate', alert: demoSafetyAlert });
  }, 1_000);

  it('an empty registry fails closed (throws)', async () => {
    const step = createPreGuardStep(reg());
    const { env } = envWith('hello', { transcripts: memoryTranscriptStore() });
    await expect(step(env, entitled)).rejects.toThrow(
      'preGuard: guard chain failed ((empty chain): empty)',
    );
  }, 1_000);

  it('the guards get the ctx: entitlement, session, lang, locale, earlier student turns', async () => {
    const seen: PreGuardCtx[] = [];
    const step = createPreGuardStep(
      reg(
        fakeGuard<PreGuardCtx>('distressDetect', 'pre', (_t, ctx) => {
          seen.push(ctx);
          return { ok: true };
        }),
      ),
    );
    const transcripts = memoryTranscriptStore();
    await transcripts.append(demoTurnInput.sessionId, msg('m1', 'student', 'first'));
    await transcripts.append(demoTurnInput.sessionId, msg('m2', 'agent', 'reply'));
    await transcripts.append(demoTurnInput.sessionId, msg('m3', 'student', 'second'));
    const { env } = envWith(undefined, { transcripts });
    await step(env, entitled);
    expect(seen[0]).toMatchObject({
      entitlement: demoEntitlementSubscription,
      sessionId: demoTurnInput.sessionId,
      lang: demoTurnInput.lang,
      locale: demoLocalePack,
    });
    // Started before the chain, not awaited by preGuard itself.
    expect(seen[0]?.recentStudentTurns).toBeInstanceOf(Promise);
    expect(await seen[0]?.recentStudentTurns).toEqual(['first', 'second']);
  }, 1_000);
});

describe('recentStudentTurns', () => {
  it('keeps only student messages, the last 3, oldest first', async () => {
    const transcripts = memoryTranscriptStore();
    for (let i = 1; i <= 5; i++) {
      await transcripts.append(demoTurnInput.sessionId, msg(`s${i}`, 'student', `s${i}`));
      await transcripts.append(demoTurnInput.sessionId, msg(`a${i}`, 'agent', `a${i}`));
    }
    const { env } = envWith('x', { transcripts });
    expect(await recentStudentTurns(env)).toEqual(['s3', 's4', 's5']);
  }, 1_000);

  it('a failing history read → [] (the classifier still runs) and is reported without text', async () => {
    const failing: TranscriptStore = {
      history: () => Promise.reject(new TypeError('db down SECRET-TEXT')),
      append: () => Promise.resolve(),
    };
    const { env, reported } = envWith('x', { transcripts: failing });
    expect(await recentStudentTurns(env)).toEqual([]);
    expect(reported.map((e) => (e as Error).message)).toEqual([
      'preGuard: earlier student messages unavailable (TypeError)',
    ]);
  }, 1_000);

  it('a malformed history result → [] and reported', async () => {
    const odd = {
      history: () => Promise.resolve('nope' as unknown as Message[]),
      append: () => Promise.resolve(),
    };
    const { env, reported } = envWith('x', { transcripts: odd });
    expect(await recentStudentTurns(env)).toEqual([]);
    expect(reported.map((e) => (e as Error).message)).toEqual([
      'preGuard: earlier student messages unavailable (malformed)',
    ]);
  }, 1_000);

  it(`a history read slower than ${HISTORY_TIMEOUT_MS} ms → [] and reported`, async () => {
    const t = testDeps();
    const reported: unknown[] = [];
    const slow: TranscriptStore = {
      history: async () => {
        await t.clock.sleep(HISTORY_TIMEOUT_MS + 1);
        return [msg('s1', 'student', 'late')];
      },
      append: () => Promise.resolve(),
    };
    const env: StepEnv = {
      input: demoTurnInput,
      deps: { ...t.deps, transcripts: slow },
      cancel: cancelSource().token,
      turnId: 'turn_1',
      ...stepEnvExtras(reported),
    };
    expect(await t.clock.drive(recentStudentTurns(env))).toEqual([]);
    expect(reported.map((e) => (e as Error).message)).toEqual([
      'preGuard: earlier student messages unavailable (timeout)',
    ]);
  }, 1_000);
});
