// The web's turn composition (task 9.4): the real ports over stub repositories and fake queues.
import type { Repositories } from '@edmate/db';
import type { ModelPolicy } from '@edmate/contracts';
import { loadBundledPrices } from '@edmate/gateway';
import { createTurnLimits, type TurnGatewaySpec } from '@edmate/harness';
import { describe, expect, it, vi } from 'vitest';
import { processPorts, systemClock, systemIds, turnDepsFor, type TurnProcess } from './deps';
import { cancelSource } from '@edmate/harness';

const repos = {} as Repositories;

function fakeQueue() {
  const added: { name: string; data: unknown }[] = [];
  return { added, add: async (name: string, data: unknown) => void added.push({ name, data }) };
}

function turnProcess(log = vi.fn()): TurnProcess {
  const clock = systemClock();
  const ports = processPorts(repos, {
    studentMarket: async () => 'global',
    packMarket: () => 'global',
    locales: () => null,
    learnerClear: async () => true,
  });
  return {
    repos,
    queues: { meter: fakeQueue(), commit: fakeQueue(), alert: fakeQueue(), safetyEvent: fakeQueue() },
    limits: createTurnLimits(clock),
    // Built eagerly by createRouter; never called here (no model call in tests).
    factories: { anthropic: () => ({ capabilities: {} }) as never },
    prices: loadBundledPrices(),
    promptPacks: { get: () => undefined } as unknown as TurnProcess['promptPacks'],
    personas: new Map() as TurnProcess['personas'],
    ...ports,
    clock,
    ids: systemIds(),
    log: { error: log },
  };
}

describe('systemClock', () => {
  it('reads the real time and sleeps', async () => {
    const clock = systemClock();
    const before = clock.now();
    await clock.sleep(5);
    expect(clock.now()).toBeGreaterThanOrEqual(before);
  });

  it('a cancelled sleep resolves at once', async () => {
    const c = cancelSource();
    const started = Date.now();
    const slept = systemClock().sleep(10_000, c.token);
    c.cancel();
    await slept;
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('systemIds', () => {
  it('prefixes a fresh uuid with the kind', () => {
    const ids = systemIds();
    const a = ids.next('turn');
    expect(a).toMatch(/^turn_[0-9a-f-]{36}$/);
    expect(ids.next('turn')).not.toBe(a);
  });
});

describe('turnDepsFor', () => {
  const scope = { studentId: 'stu_1', teacherId: 'tch_a' } as Parameters<typeof turnDepsFor>[1];

  it('binds the process ports and a metered gateway for the turn', () => {
    const p = turnProcess();
    const deps = turnDepsFor(p, scope);
    expect(deps.entitlements).toBe(p.entitlements);
    expect(deps.turnConfig).toBe(p.turnConfig);
    expect(deps.retrieval).toBe(p.retrieval);
    expect(deps.limits).toBe(p.limits);
    expect(deps.entitlementSource).toBe('subscription');
    const target = { provider: 'anthropic', model: 'claude-haiku-4-5' } as const;
    const policy = { tiers: { small: target, main: target, strong: target } } as unknown as ModelPolicy;
    const tg = deps.gatewayFor({
      policy,
      billing: { studentId: 'stu_1', teacherId: 'tch_a' } as unknown as TurnGatewaySpec['billing'],
    });
    expect(tg.metered).toBe(true);
    expect(typeof tg.gateway.stream).toBe('function');
  });

  it('passes the process persona library through as deps.personas (5.8a)', () => {
    const p = turnProcess();
    expect(turnDepsFor(p, scope).personas).toBe(p.personas);
  });

  it('prices usage from the bundled table', () => {
    const deps = turnDepsFor(turnProcess(), scope);
    const cost = deps.priceUsage({
      model: 'claude-haiku-4-5',
      tier: 'main',
      inputTokens: 1_000,
      outputTokens: 1_000,
      costMicroUsd: 0,
    });
    expect(cost).toBeGreaterThan(0);
  });

  it('logs a background failure by task, error name and turn id only', () => {
    const log = vi.fn();
    const deps = turnDepsFor(turnProcess(log), scope);
    deps.log.backgroundFailure({ task: 'commit', errorName: 'TypeError', turnId: 'turn_1' } as never);
    deps.log.backgroundFailure({ task: 'meter', errorName: 'Error' } as never);
    expect(log).toHaveBeenNthCalledWith(1, 'turn.background_failed', {
      task: 'commit',
      error: 'TypeError',
      turnId: 'turn_1',
    });
    expect(log).toHaveBeenNthCalledWith(2, 'turn.background_failed', { task: 'meter', error: 'Error', turnId: '' });
  });

  it('checks distress keywords and has the fallback replies', () => {
    const deps = turnDepsFor(turnProcess(), scope);
    expect(deps.distressCheck('I want to kill myself', 'en')).toBe(true);
    expect(deps.distressCheck('What is a fraction?', 'en')).toBe(false);
    expect(deps.fallbackReplies).toBeDefined();
  });
});
