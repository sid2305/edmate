// Task 8.7 Phase C: the live gate composition fails closed with a reason before any model call,
// and builds a gate input from the repo's content and suites when everything is in place. The key
// below is a placeholder: nothing here calls a model (the gate itself is never run).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GateRunRow, Repositories } from '@edmate/db';
import { GATE_CONCURRENCY } from '@edmate/evals';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT,
  AGENT_VERSION,
  fakeRepos,
  freePkg,
  paidPkg,
  TEACHER,
} from '../../test/gate/testkit.js';
import type { LogLine } from '../log.js';
import { GateUnavailableError, type GateBasis } from './input.js';
import {
  gateConcurrencyFromEnv,
  gateContentDir,
  gateSuitesDir,
  livePrepareGate,
} from './workers.js';

const REPO = resolve(import.meta.dirname, '../../../..');
const CONTENT = join(REPO, 'content');
const SUITES = join(REPO, 'evals/suites');
const MODELS = {
  EDMATE_ANTHROPIC_API_KEY: 'test-only-not-a-key',
  EDMATE_JUDGE_MODEL: 'anthropic:claude-sonnet-5',
};
const READY = { ...MODELS, EDMATE_CONTENT_DIR: CONTENT, EDMATE_EVAL_SUITES_DIR: SUITES };

const basis: GateBasis = {
  teacherId: TEACHER,
  agentId: AGENT,
  agentVersion: AGENT_VERSION,
  packageVersions: [
    { packageId: freePkg.id, version: freePkg.version },
    { packageId: paidPkg.id, version: paidPkg.version },
  ],
};

function run(over: Partial<GateRunRow> = {}): GateRunRow {
  return {
    id: '0b6c7c2e-8a7c-4c55-9a1e-3f1f5b0a9d21',
    agentId: AGENT,
    agentVersion: AGENT_VERSION,
    status: 'running',
    changes: ['material'],
    judgeModel: 'claude-sonnet-5',
    basis: {
      agentVersion: AGENT_VERSION,
      courseId: 'crs_x',
      styleCardId: 'sty_x',
      promptPackVersion: '1.0.0',
      modelPolicy: { tiers: {} } as never,
      materialRevision: 1,
      packageVersions: { [freePkg.id]: freePkg.version, [paidPkg.id]: paidPkg.version },
    },
    passRate: null,
    summary: null,
    scorecard: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    finishedAt: null,
    publishedAt: null,
    ...over,
  };
}

async function reason(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => new Error('resolved'),
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(GateUnavailableError);
  return (e as GateUnavailableError).reason;
}

const quiet = () => undefined;

describe('gate settings from the environment', () => {
  it('GATE_CONCURRENCY: default, a valid value, and an invalid one (logged, default used)', () => {
    const lines: LogLine[] = [];
    const log = (l: LogLine) => lines.push(l);
    expect(gateConcurrencyFromEnv({}, log)).toBe(GATE_CONCURRENCY);
    expect(gateConcurrencyFromEnv({ GATE_CONCURRENCY: ' ' }, log)).toBe(GATE_CONCURRENCY);
    expect(gateConcurrencyFromEnv({ GATE_CONCURRENCY: '8' }, log)).toBe(8);
    expect(lines).toEqual([]);
    for (const bad of ['0', '33', '2.5', 'four']) {
      expect(gateConcurrencyFromEnv({ GATE_CONCURRENCY: bad }, log)).toBe(GATE_CONCURRENCY);
    }
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({
      level: 'warn',
      event: 'gate.concurrency_invalid',
      fallback: GATE_CONCURRENCY,
    });
  });

  it('content and suites dirs come from the environment, else the repo layout', () => {
    expect(gateContentDir({ EDMATE_CONTENT_DIR: '/app/content' })).toBe('/app/content');
    expect(gateSuitesDir({ EDMATE_EVAL_SUITES_DIR: '/app/evals/suites' })).toBe('/app/evals/suites');
    expect(gateContentDir({})).toBe(resolve(process.cwd(), '../../content'));
    expect(gateSuitesDir({ EDMATE_EVAL_SUITES_DIR: '' })).toBe(
      resolve(process.cwd(), '../../evals/suites'),
    );
  });
});

describe('livePrepareGate fails closed before any model call', () => {
  let empty: string;
  beforeEach(() => {
    empty = mkdtempSync(join(tmpdir(), 'gate-workers-'));
  });
  afterEach(() => rmSync(empty, { recursive: true, force: true }));

  const prepare = (env: Record<string, string>, repos = fakeRepos().repos) =>
    livePrepareGate({ env, repos, log: quiet });

  it('no models: the models reason', async () => {
    expect(await reason(prepare({})(run(), basis))).toBe('judge_model');
    expect(await reason(prepare({ ...READY, EDMATE_DEV_MODEL: 'scripted' })(run(), basis))).toBe(
      'dev_model',
    );
  });

  it('a run pinned to another judge model', async () => {
    expect(await reason(prepare(READY)(run({ judgeModel: 'claude-other' }), basis))).toBe(
      'judge_model',
    );
  });

  it('content missing: no dir, no locale pack for the market, or an unreadable library', async () => {
    const at = (dir: string, extra: Record<string, string> = {}) =>
      prepare({ ...READY, EDMATE_CONTENT_DIR: dir, ...extra })(run(), basis);
    expect(await reason(at(join(empty, 'nope')))).toBe('content_missing');
    expect(await reason(at(CONTENT, { EDMATE_MARKET: 'XX' }))).toBe('content_missing');
    mkdirSync(join(empty, 'locales'));
    expect(await reason(at(empty))).toBe('content_missing');
  });

  it('a basis with no packages', async () => {
    expect(await reason(prepare(READY)(run(), { ...basis, packageVersions: [] }))).toBe(
      'no_packages',
    );
  });

  it('a missing suites dir', async () => {
    const env = { ...READY, EDMATE_EVAL_SUITES_DIR: join(empty, 'nope') };
    expect(await reason(prepare(env)(run(), basis))).toBe('suites_missing');
  });
});

describe('livePrepareGate with everything in place', () => {
  it('builds the gate input from the repo content and suites, with an empty usage meter', async () => {
    const f = fakeRepos();
    const prep = await livePrepareGate({
      env: { ...READY, GATE_CONCURRENCY: '2' },
      repos: f.repos as Repositories,
      log: quiet,
    })(run({ judgeModel: 'anthropic:claude-sonnet-5' }), basis);
    expect(prep.input.changes).toEqual(['material']);
    expect(prep.input.platformCases.length).toBeGreaterThan(0);
    expect(prep.input.perAgent.packages.map((p) => p.id).sort()).toEqual(
      [freePkg.id, paidPkg.id].sort(),
    );
    expect(prep.input.concurrency).toBe(2);
    expect(prep.input.styleSampleSeed).toBe('sty_x');
    expect(prep.usage()).toEqual({ calls: 0, costMicroUsd: 0, unmetered: 0, unmeteredReasons: [] });
    expect(f.forbidden).toEqual([]);
  });
});
