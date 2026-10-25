// Task 8.7 Phase C: the gate processor over a fake publish repository and scripted gates (no
// real model call: the scripted gate never touches a gateway, and the models-unavailable case
// uses the live preparation with an empty environment, which refuses before any call).
import {
  type GateCaseResult,
  type GateRunRow,
  PublishRefusedError,
  type Repositories,
  RepositoryError,
  FULL_SCOPE_GATE_DEADLINE_MS as DB_FULL_DEADLINE,
  GATE_DEADLINE_MS as DB_DEADLINE,
  GATE_GROUP_NAMES,
  PUBLISH_CHANGE_KINDS,
} from '@edmate/db';
import {
  CHANGE_KINDS,
  DEADLINE_NOT_RUN,
  FULL_SCOPE_GATE_DEADLINE_MS,
  GATE_DEADLINE_MS,
  GATE_THRESHOLDS,
  generatePerAgentSuite,
  groupVerdict,
  memoryRecorder,
  SCORECARD_GROUPS,
  selectGateCases,
  type EvalCase,
  type GateInput,
  type GateResult,
} from '@edmate/evals';
import type { ModelGateway } from '@edmate/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PermanentJobError } from '../commit/processors.js';
import type { LogLine } from '../log.js';
import { GateUnavailableError } from './input.js';
import {
  basisOf,
  caseResults,
  errorCodeOf,
  GateChangesEmptyError,
  gateProcessor,
  type GatePreparation,
  type GateProcessorDeps,
  passRateOf,
  runSummary,
} from './processor.js';
import { livePrepareGate } from './workers.js';

const TEACHER = 'tch_gate_c1';
const AGENT = 'agt_gate_c1';
const RUN = '0b6c7c2e-8a7c-4c55-9a1e-3f1f5b0a9d21';
const JOB = { id: 'j1', name: 'gate.run', data: { runId: RUN, teacherId: TEACHER } };

function run(over: Partial<GateRunRow> = {}): GateRunRow {
  return {
    id: RUN,
    agentId: AGENT,
    agentVersion: 3,
    status: 'queued',
    changes: ['first_publish'],
    judgeModel: 'claude-judge-test',
    basis: {
      agentVersion: 3,
      courseId: 'crs_gate_c1',
      styleCardId: 'sty_gate_c1',
      promptPackVersion: '1.0.0',
      modelPolicy: {
        tiers: {
          small: { provider: 'anthropic', model: 'small-test' },
          main: { provider: 'anthropic', model: 'main-test' },
        },
      },
      materialRevision: 2,
      packageVersions: { pkg_paid: 4, pkg_free: 2 },
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

function platformCase(id: string, suite: string, student = 'A platform question'): EvalCase {
  return {
    id,
    suite,
    package: 'free',
    reviewed_by: 'lead',
    source: 'fixture',
    turns: [{ student, expect: { judge: ['The reply is kind.'] } }],
  } as EvalCase;
}

function gateInput(over: Partial<GateInput> = {}): GateInput {
  return {
    changes: ['first_publish'],
    platformCases: [platformCase('plat-acc-1', 'accuracy'), platformCase('plat-safety-1', 'safety')],
    perAgent: {
      teacherId: TEACHER,
      agentId: AGENT,
      packages: [
        { id: 'pkg_free', name: 'Free', moduleIds: ['mod_a'], lockedReply: 'generic', sourceLabel: 'pv#free' },
      ],
      answerable: [
        {
          id: 'tec_1',
          moduleId: 'mod_a',
          question: 'What does a for loop do?',
          answer: 'It repeats a block.',
          provenance: 'teacher-answer',
          sourceLabel: 'teacher_eval_cases#tec_1',
        },
      ],
      outOfCourse: [],
    },
    agentFor: () => ({ reply: () => Promise.reject(new Error('the scripted gate never asks')) }),
    judgeGateway: {} as ModelGateway,
    recorder: memoryRecorder('record'),
    ...over,
  };
}

/** A scripted gate: every in-scope case passes unless listed; groups from the cases present. */
function scripted(input: GateInput, fail: readonly string[] = [], extra: Partial<GateResult> = {}): GateResult {
  const scope = selectGateCases({
    changes: input.changes,
    platformCases: input.platformCases,
    perAgentCases: input.changes.every((c) => c === 'style_card')
      ? undefined
      : generatePerAgentSuite(input.perAgent),
    requireAgentLocked: false,
  });
  const results = scope.cases.map(({ evalCase }) => {
    const pass = !fail.includes(evalCase.id);
    return {
      id: evalCase.id,
      suite: evalCase.suite,
      pass,
      turns: [
        {
          turnIndex: 0,
          student: evalCase.turns[0]?.student ?? '',
          reply: 'a model reply that is never stored',
          checks: pass
            ? [{ name: 'judge', pass: true }]
            : [{ name: 'judge', pass: false, detail: 'the judge reason is never stored' }],
          pass,
        },
      ],
    };
  });
  const tally = new Map<string, { origin: 'platform' | 'agent'; group: string; total: number; passed: number }>();
  scope.cases.forEach((c, i) => {
    const key = `${c.origin}:${c.group}`;
    const t = tally.get(key) ?? { origin: c.origin, group: c.group, total: 0, passed: 0 };
    t.total += 1;
    if (results[i]?.pass) t.passed += 1;
    tally.set(key, t);
  });
  const groups = [...tally.values()].map((t) =>
    groupVerdict(t.origin, t.group as never, t.total, t.passed),
  );
  return {
    pass: groups.every((g) => g.pass),
    changes: [...input.changes],
    groups,
    failedCaseIds: results.filter((r) => !r.pass).map((r) => r.id),
    results,
    stats: {
      cases: results.length,
      notRun: 0,
      deadlinePassed: false,
      deadlineMs: 1,
      agentCalls: results.length,
      judgeCalls: results.length,
      totalCalls: results.length * 2,
      maxCallsPerCase: 2,
      concurrency: 4,
      criticalPathCalls: 3,
      estimatedSeconds: 24,
    },
    ...extra,
  };
}

interface FakePublish {
  repos: Pick<Repositories, 'publish'>;
  calls: string[];
  recorded: GateCaseResult[];
  finished: unknown[];
  live: unknown[];
}

function fakePublish(
  row: GateRunRow | null = run(),
  o: { markRunning?: boolean; goLive?: Error; finish?: Error; getRun?: Error } = {},
): FakePublish {
  const f: FakePublish = { repos: {} as never, calls: [], recorded: [], finished: [], live: [] };
  const publish = {
    getRun: vi.fn(async (scope: { teacherId: string }, id: string) => {
      f.calls.push('getRun');
      if (o.getRun) throw o.getRun;
      return scope.teacherId === TEACHER && id === RUN ? row : null;
    }),
    markRunning: vi.fn(async () => {
      f.calls.push('markRunning');
      return o.markRunning ?? true;
    }),
    recordResults: vi.fn(async (_s: unknown, input: { results: GateCaseResult[] }) => {
      f.calls.push(`recordResults:${input.results.length}`);
      f.recorded.push(...input.results);
      return { written: input.results.length };
    }),
    finishRun: vi.fn(async (_s: unknown, input: unknown) => {
      f.calls.push('finishRun');
      if (o.finish) throw o.finish;
      f.finished.push(input);
    }),
    goLive: vi.fn(async (_s: unknown, input: unknown) => {
      f.calls.push('goLive');
      if (o.goLive) throw o.goLive;
      f.live.push(input);
      return { agentVersion: 3, packageVersions: { pkg_free: 2, pkg_paid: 4 } };
    }),
  };
  f.repos = { publish } as unknown as Pick<Repositories, 'publish'>;
  return f;
}

const usage = () => ({ calls: 12, costMicroUsd: 4321.6, unmetered: 1, unmeteredReasons: ['no_usage_reported'] });

function setup(
  o: {
    row?: GateRunRow | null;
    repo?: Parameters<typeof fakePublish>[1];
    input?: GateInput;
    gate?: (input: GateInput) => Promise<GateResult>;
    prepare?: GateProcessorDeps['prepare'];
  } = {},
) {
  const f = fakePublish(o.row === undefined ? run() : o.row, o.repo);
  const lines: LogLine[] = [];
  const input = o.input ?? gateInput();
  const runGate = vi.fn(o.gate ?? ((i: GateInput) => Promise.resolve(scripted(i))));
  const prepare = vi.fn(
    o.prepare ?? ((): Promise<GatePreparation> => Promise.resolve({ input, usage })),
  );
  const process = gateProcessor({ repos: f.repos, prepare, runGate, log: (l) => lines.push(l) });
  return { f, lines, input, runGate, prepare, process };
}

describe('gateProcessor: a passing gate', () => {
  it('records every case, then goes live exactly once with the summary and scorecard', async () => {
    const s = setup();
    expect(await s.process(JOB)).toBe('passed');
    const expected = scripted(s.input);
    expect(s.f.calls).toEqual(['getRun', 'markRunning', `recordResults:${expected.results.length}`, 'goLive']);
    expect(s.runGate).toHaveBeenCalledTimes(1);
    expect(s.f.live).toHaveLength(1);
    const live = s.f.live[0] as { runId: string; passRate: number; summary: Record<string, unknown>; scorecard: { pass: boolean; changes: string[] } };
    expect(live.runId).toBe(RUN);
    expect(live.passRate).toBe(1);
    expect(live.scorecard.pass).toBe(true);
    expect(live.scorecard.changes).toEqual(['first_publish']);
    expect(live.summary.costMicroUsd).toBe(4322);
    expect(live.summary.stats).toMatchObject({ cases: expected.results.length, modelCalls: 12, unmeteredCalls: 1 });
    expect(s.f.finished).toEqual([]);
    expect(s.lines.map((l) => l.event)).toEqual(['gate.started', 'gate.published']);
  });

  it('passes the run basis to prepare, packages sorted by id, teacher from the job', async () => {
    const s = setup();
    await s.process(JOB);
    expect(s.prepare).toHaveBeenCalledWith(run(), {
      teacherId: TEACHER,
      agentId: AGENT,
      agentVersion: 3,
      packageVersions: [
        { packageId: 'pkg_free', version: 2 },
        { packageId: 'pkg_paid', version: 4 },
      ],
    });
  });

  it('stores origin, group and check names; a question only for agent cases; never replies', async () => {
    const s = setup();
    await s.process(JOB);
    const plat = s.f.recorded.find((r) => r.caseId === 'plat-acc-1');
    expect(plat).toEqual({
      caseId: 'plat-acc-1',
      passed: true,
      details: { origin: 'platform', group: 'accuracy', suite: 'accuracy', failedChecks: [] },
    });
    const agent = s.f.recorded.filter((r) => r.details.origin === 'agent');
    expect(agent.length).toBeGreaterThan(0);
    expect(agent.find((r) => r.details.group === 'accuracy')?.details.question).toBe('What does a for loop do?');
    expect(JSON.stringify(s.f.recorded)).not.toMatch(/never stored/);
  });

  it('writes more than one batch when a gate has over 1 000 cases', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => platformCase(`plat-acc-${i}`, 'accuracy'));
    const s = setup({ input: gateInput({ platformCases: many }) });
    expect(await s.process(JOB)).toBe('passed');
    const total = scripted(gateInput({ platformCases: many })).results.length;
    expect(s.f.calls.filter((c) => c.startsWith('recordResults'))).toEqual([
      'recordResults:1000',
      `recordResults:${total - 1000}`,
    ]);
  });
});

describe('gateProcessor: a failing gate', () => {
  it('finishes the run failed with the failed case stored, and never goes live', async () => {
    const input = gateInput();
    const failing = scripted(input).results.find((r) => r.id.includes('accuracy') || r.suite === 'accuracy' && !r.id.startsWith('plat'));
    const failId = failing?.id ?? 'missing';
    const s = setup({ input, gate: (i) => Promise.resolve(scripted(i, [failId])) });
    expect(await s.process(JOB)).toBe('failed');
    expect(s.f.calls).not.toContain('goLive');
    expect(s.f.live).toEqual([]);
    const stored = s.f.recorded.find((r) => r.caseId === failId);
    expect(stored?.passed).toBe(false);
    expect(stored?.details).toMatchObject({ origin: 'agent', group: 'accuracy', failedChecks: ['judge'] });
    const fin = s.f.finished[0] as { status: string; passRate: number; scorecard: { pass: boolean }; summary: { groups: { pass: boolean }[] } };
    expect(fin.status).toBe('failed');
    expect(fin.passRate).toBeLessThan(1);
    expect(fin.scorecard.pass).toBe(false);
    expect(fin.summary.groups.some((g) => !g.pass)).toBe(true);
    expect(s.lines.at(-1)).toMatchObject({ event: 'gate.failed', failedCases: 1 });
  });
});

describe('gateProcessor: errors end the run as error, nothing publishes', () => {
  it('a gate that throws', async () => {
    const s = setup({ gate: () => Promise.reject(new Error('boom')) });
    expect(await s.process(JOB)).toBe('error');
    expect(s.f.calls).toEqual(['getRun', 'markRunning', 'finishRun']);
    expect(s.f.finished).toEqual([
      { runId: RUN, status: 'error', summary: { groups: [], errorCode: 'gate_error', costMicroUsd: 4322 } },
    ]);
    expect(s.lines.at(-1)).toMatchObject({ level: 'error', event: 'gate.error', errorCode: 'gate_error', runId: RUN });
  });

  it('models unavailable: gate_unavailable, without calling the gate or any model', async () => {
    const s = setup({
      prepare: livePrepareGate({ env: {}, repos: {} as Repositories, log: () => undefined }),
    });
    expect(await s.process(JOB)).toBe('error');
    expect(s.runGate).not.toHaveBeenCalled();
    expect(s.f.finished).toEqual([
      { runId: RUN, status: 'error', summary: { groups: [], errorCode: 'gate_unavailable' } },
    ]);
    expect(s.lines.at(-1)).toMatchObject({ event: 'gate.error', errorCode: 'gate_unavailable', reason: 'judge_model' });
  });

  it('a dev model in the environment is unavailable too', async () => {
    const s = setup({
      prepare: livePrepareGate({ env: { EDMATE_DEV_MODEL: 'scripted' }, repos: {} as Repositories, log: () => undefined }),
    });
    expect(await s.process(JOB)).toBe('error');
    expect(s.runGate).not.toHaveBeenCalled();
    expect(s.lines.at(-1)).toMatchObject({ reason: 'dev_model' });
  });

  it('goLive refused (suspended, or the teacher no longer verified) ends error with that code', async () => {
    const a = setup({ repo: { goLive: new PublishRefusedError('invalid', 'publish.goLive', 'suspended') } });
    expect(await a.process(JOB)).toBe('error');
    expect(a.f.finished).toMatchObject([{ status: 'error', summary: { errorCode: 'suspended' } }]);
    const b = setup({ repo: { goLive: new RepositoryError('scope', 'publish.goLive') } });
    expect(await b.process(JOB)).toBe('error');
    expect(b.f.finished).toMatchObject([{ status: 'error', summary: { errorCode: 'not_verified' } }]);
  });

  it('goLive refused regulated_unapproved (task 12.4) ends error with that code', async () => {
    const s = setup({
      repo: { goLive: new PublishRefusedError('invalid', 'publish.goLive', 'regulated_unapproved') },
    });
    expect(await s.process(JOB)).toBe('error');
    expect(s.f.finished).toMatchObject([
      { status: 'error', summary: { errorCode: 'regulated_unapproved' } },
    ]);
  });

  it('results that do not line up with the scope are never stored', async () => {
    const s = setup({
      gate: (i) => {
        const g = scripted(i);
        return Promise.resolve({ ...g, results: g.results.slice(1) });
      },
    });
    expect(await s.process(JOB)).toBe('error');
    expect(s.f.recorded).toEqual([]);
    expect(s.f.finished).toMatchObject([{ summary: { errorCode: 'result_mismatch' } }]);
    const t = setup({
      gate: (i) => {
        const g = scripted(i);
        return Promise.resolve({ ...g, results: [...g.results].reverse() });
      },
    });
    expect(await t.process(JOB)).toBe('error');
    expect(t.f.finished).toMatchObject([{ summary: { errorCode: 'result_mismatch' } }]);
  });

  it('a gate that resolves without a result ends error, not a crash, not a pass', async () => {
    const s = setup({ gate: () => Promise.resolve(undefined as unknown as GateResult) });
    expect(await s.process(JOB)).toBe('error');
    expect(s.f.calls).toEqual(['getRun', 'markRunning', 'finishRun']);
    expect(s.f.live).toEqual([]);
    expect(s.f.recorded).toEqual([]);
    expect(s.f.finished).toMatchObject([{ status: 'error', summary: { errorCode: 'gate_result_missing' } }]);
    expect(s.lines.at(-1)).toMatchObject({ event: 'gate.error', errorCode: 'gate_result_missing' });
  });

  it('a markRunning failure ends the run error too', async () => {
    const f = fakePublish();
    (f.repos.publish.markRunning as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new RepositoryError('failed', 'publish.markRunning'),
    );
    const lines: LogLine[] = [];
    const p = gateProcessor({ repos: f.repos, prepare: vi.fn(), log: (l) => lines.push(l) });
    expect(await p(JOB)).toBe('error');
    expect(f.finished).toEqual([
      { runId: RUN, status: 'error', summary: { groups: [], errorCode: 'repository_failed' } },
    ]);
  });

  it('a finishRun that fails is logged and fails the job loudly', async () => {
    const down = new RepositoryError('failed', 'publish.finishRun');
    const s = setup({ gate: () => Promise.reject(new Error('boom')), repo: { finish: down } });
    await expect(s.process(JOB)).rejects.toBe(down);
    expect(s.lines.map((l) => l.event)).toEqual(['gate.started', 'gate.error', 'gate.finish_failed']);
  });
});

describe('gateProcessor: redelivery and bad jobs', () => {
  it.each(['running', 'passed', 'failed', 'error'] as const)('a %s run is a logged no-op', async (status) => {
    const s = setup({ row: run({ status }) });
    expect(await s.process(JOB)).toBe('skipped');
    expect(s.f.calls).toEqual(['getRun']);
    expect(s.prepare).not.toHaveBeenCalled();
    expect(s.lines).toEqual([{ level: 'info', event: 'gate.skipped', runId: RUN, teacherId: TEACHER, status }]);
  });

  it('a missing run (or another teacher’s) is a no-op', async () => {
    const s = setup({ row: null });
    expect(await s.process(JOB)).toBe('skipped');
    expect(s.lines[0]).toMatchObject({ event: 'gate.skipped', status: 'missing' });
  });

  it('a run another worker already took is a no-op', async () => {
    const s = setup({ repo: { markRunning: false } });
    expect(await s.process(JOB)).toBe('skipped');
    expect(s.prepare).not.toHaveBeenCalled();
    expect(s.f.finished).toEqual([]);
  });

  it('a malformed job is permanent (dead-lettered, never retried)', async () => {
    const s = setup();
    await expect(s.process({ name: 'gate.run', data: { runId: RUN } })).rejects.toBeInstanceOf(PermanentJobError);
    await expect(
      s.process({ name: 'gate.run', data: { runId: RUN, teacherId: TEACHER, extra: 1 } }),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(s.f.calls).toEqual([]);
    expect(s.lines[0]).toMatchObject({ level: 'error', event: 'gate.invalid_job' });
  });

  it('a getRun failure is logged and ends the run error', async () => {
    const down = new RepositoryError('failed', 'publish.getRun');
    const s = setup({ repo: { getRun: down } });
    expect(await s.process(JOB)).toBe('error');
    expect(s.prepare).not.toHaveBeenCalled();
    expect(s.f.finished).toEqual([
      { runId: RUN, status: 'error', summary: { groups: [], errorCode: 'repository_failed' } },
    ]);
    expect(s.lines).toMatchObject([{ level: 'error', event: 'gate.error', errorCode: 'repository_failed' }]);
  });

  it('a getRun failure with the database down fails the job loudly', async () => {
    const down = new RepositoryError('failed', 'publish.getRun');
    const s = setup({ repo: { getRun: down, finish: down } });
    await expect(s.process(JOB)).rejects.toBe(down);
    expect(s.lines.map((l) => l.event)).toEqual(['gate.error', 'gate.finish_failed']);
  });
});

describe('helpers', () => {
  it('maps a deadline-skipped or thrown case to a code word, never its message', () => {
    const input = gateInput();
    const g = scripted(input);
    const first = g.results[0]!;
    const second = g.results[1]!;
    const rows = caseResults(input, {
      ...g,
      results: [
        { ...first, pass: false, error: DEADLINE_NOT_RUN, turns: [] },
        { ...second, pass: false, error: 'a thrown message with text', turns: [] },
        ...g.results.slice(2),
      ],
    });
    expect(rows[0]?.details.errorCode).toBe('not_run');
    expect(rows[1]?.details.errorCode).toBe('case_error');
    expect(JSON.stringify(rows)).not.toContain('thrown message');
  });

  it('caps check names and their count', () => {
    const input = gateInput();
    const g = scripted(input);
    const checks = Array.from({ length: 60 }, (_, i) => ({ name: `${'c'.repeat(250)}${i}`, pass: false }));
    const rows = caseResults(input, {
      ...g,
      results: g.results.map((r, i) =>
        i === 0 ? { ...r, pass: false, turns: [{ turnIndex: 0, student: '', reply: '', checks, pass: false }] } : r,
      ),
    });
    expect(rows[0]?.details.failedChecks).toHaveLength(50);
    expect(rows[0]?.details.failedChecks.every((c) => c.length === 200)).toBe(true);
  });

  it('a style-card-only gate needs no per-agent suite', () => {
    const style = Array.from({ length: 40 }, (_, i) => platformCase(`plat-ped-${i}`, i % 2 ? 'pedagogy' : 'persona'));
    const input = gateInput({ changes: ['style_card'], platformCases: style, styleSampleSeed: 'sty_1' });
    const scope = selectGateCases({ changes: ['style_card'], platformCases: style, requireAgentLocked: false, styleSampleSeed: 'sty_1' });
    const g = scripted(input);
    // scripted() sorts nothing: rebuild its results in the seeded scope order.
    const byId = new Map(g.results.map((r) => [r.id, r]));
    const ordered = { ...g, results: scope.cases.map((c) => byId.get(c.evalCase.id) ?? { id: c.evalCase.id, suite: c.evalCase.suite, pass: true, turns: [] }) };
    expect(caseResults(input, ordered).every((r) => r.details.origin === 'platform')).toBe(true);
  });

  it('an empty changes list throws instead of scoping as style-only', () => {
    const input = gateInput({ changes: [] });
    const g = scripted(gateInput());
    expect(() => caseResults(input, g)).toThrow(GateChangesEmptyError);
  });

  it('passRate is 0 for an empty gate; usage is optional in the summary', () => {
    const g = scripted(gateInput({ platformCases: [] }));
    expect(passRateOf({ ...g, results: [] })).toBe(0);
    const s = runSummary({ ...g, groups: [{ origin: 'platform', group: 'leak', total: 0, passed: 0, minPercent: 100, pass: false, reason: 'empty_group' }] }, undefined);
    expect(s.costMicroUsd).toBeUndefined();
    expect(s.groups[0]?.reason).toBe('empty_group');
  });

  it('error codes are fixed words', () => {
    expect(errorCodeOf(new GateUnavailableError('suites_missing'))).toBe('gate_unavailable');
    expect(errorCodeOf(new RepositoryError('integrity', 'x'))).toBe('repository_integrity');
    expect(errorCodeOf('not an error')).toBe('gate_error');
  });

  it('basisOf keeps an empty package set empty', () => {
    expect(basisOf(TEACHER, run({ basis: { ...run().basis, packageVersions: {} } })).packageVersions).toEqual([]);
  });
});

// 8.7a stores strict local mirrors of the evals types (db must not import evals); they must match.
describe('db mirrors of the evals gate types', () => {
  it('match group names, change kinds, deadlines and scorecard keys', () => {
    expect([...GATE_GROUP_NAMES].sort()).toEqual(Object.keys(GATE_THRESHOLDS).sort());
    expect([...PUBLISH_CHANGE_KINDS]).toEqual([...CHANGE_KINDS]);
    expect(DB_DEADLINE).toBe(GATE_DEADLINE_MS);
    expect(DB_FULL_DEADLINE).toBe(FULL_SCOPE_GATE_DEADLINE_MS);
    expect(Object.keys(SCORECARD_GROUPS)).toEqual(['hints_before_answers', 'locked_content', 'accuracy']);
  });
});
