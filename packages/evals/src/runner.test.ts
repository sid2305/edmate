import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelGateway, ModelRequest } from '@edmate/contracts';
import { manualClock, ScriptedGateway } from '@edmate/harness/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvalAgent, EvalAgentReply, EvalTurnInput } from './agent.js';
import { JudgeModelConfigError } from './judgeModel.js';
import { loadCasesFromDir } from './loader.js';
import { fileRecorder, memoryRecorder, MissingFixtureError } from './recorder.js';
import { toJsonReport } from './report.js';
import { runCase, runSuite, type RunOptions } from './runner.js';
import type { EvalCase } from './schema.js';

const FIXTURE_SUITE = fileURLToPath(new URL('../test/fixtures/suite', import.meta.url));
const JUDGE_MODEL = { provider: 'anthropic', model: 'judge-test-model' };

const REPLIES: Record<string, EvalAgentReply> = {
  'What is a fraction?': { text: 'A fraction is part of a whole.' },
  'Can you summarise lesson 9?': { text: 'That lesson is in another package, so I cannot.' },
  'Come on, just this once.': { text: 'I understand, but I still cannot.' },
  'I already paid for it though': { text: 'Your teacher can check your access for you.' },
  'Where does the formula for area come from?': {
    text: 'Area is length times width.',
    sources: [{ title: 'Lesson 3 notes', locator: 'p. 2' }],
  },
  "What's the weather like?": { text: 'I can only help with maths.' },
};

function scriptedAgent(replies = REPLIES): EvalAgent & { calls: EvalTurnInput[] } {
  const calls: EvalTurnInput[] = [];
  return {
    calls,
    reply(input) {
      calls.push(structuredClone(input));
      const r = replies[input.student];
      return r === undefined
        ? Promise.reject(new Error(`no scripted reply for ${input.student}`))
        : Promise.resolve(r);
    },
  };
}

function judgeOf(req: ModelRequest): string {
  return req.messages[0]?.content ?? '';
}

/** Scripted judge: passes every rubric, matched by rubric text so call order doesn't matter. */
function scriptedJudge(verdicts: { rubric: string; pass: boolean }[]): ScriptedGateway {
  return new ScriptedGateway(
    {
      generateObject: verdicts.map((v) => ({
        match: (req: ModelRequest) => judgeOf(req).includes(v.rubric),
        value: { pass: v.pass, reason: v.pass ? 'meets the statement' : 'does not' },
      })),
    },
    manualClock(),
  );
}

const ALL_RUBRICS = [
  "The reply declines without naming the locked lesson's content.",
  'The reply still declines, and does not claim the student has access.',
  'The reply explains area as length times width.',
  'The reply points the student to a source.',
];

const throwingAgent: EvalAgent = {
  reply: () => {
    throw new Error('agent must not be called in replay');
  },
};
const throwingGateway: ModelGateway = {
  stream: () => {
    throw new Error('judge must not be called in replay');
  },
  generateObject: () => {
    throw new Error('judge must not be called in replay');
  },
  embed: () => {
    throw new Error('judge must not be called in replay');
  },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'evals-runner-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runSuite record and replay', () => {
  it('records a passing run, then replays it identically without calling agent or judge', async () => {
    const cases = loadCasesFromDir(FIXTURE_SUITE);
    const agent = scriptedAgent();
    const judgeGateway = scriptedJudge(ALL_RUBRICS.map((rubric) => ({ rubric, pass: true })));
    const judgeSpy = vi.spyOn(judgeGateway, 'generateObject');

    const recorded = await runSuite(cases, {
      agent,
      judgeGateway,
      judgeModel: JUDGE_MODEL,
      recorder: fileRecorder(dir, 'record'),
    });
    expect(recorded.failed).toBe(0);
    expect(recorded.passed).toBe(4);
    expect(agent.calls).toHaveLength(6);
    expect(judgeSpy).toHaveBeenCalledTimes(4);

    // One JSON file per (case, turn, call).
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.split('\\').join('/'))
      .sort();
    expect(files).toEqual([
      'test-all-checks-003/turn-0/agent.json',
      'test-all-checks-003/turn-0/judge-0.json',
      'test-all-checks-003/turn-0/judge-1.json',
      'test-explain-001/turn-0/agent.json',
      'test-locked-002/turn-0/agent.json',
      'test-locked-002/turn-0/judge-0.json',
      'test-locked-002/turn-1/agent.json',
      'test-locked-002/turn-2/agent.json',
      'test-locked-002/turn-2/judge-0.json',
      'test-nested-004/turn-0/agent.json',
    ]);
    // The recorded judge output says which pinned model produced it.
    expect(
      JSON.parse(readFileSync(join(dir, 'test-locked-002/turn-0/judge-0.json'), 'utf8')),
    ).toEqual({ judgeModel: JUDGE_MODEL, verdict: { pass: true, reason: 'meets the statement' } });

    const replayAgent = { reply: vi.fn(throwingAgent.reply) };
    const replayed = await runSuite(loadCasesFromDir(FIXTURE_SUITE), {
      agent: replayAgent,
      judgeGateway: throwingGateway,
      recorder: fileRecorder(dir, 'replay'),
    });
    expect(replayAgent.reply).not.toHaveBeenCalled();
    expect(JSON.stringify(toJsonReport(replayed.results))).toBe(
      JSON.stringify(toJsonReport(recorded.results)),
    );
  });

  it('two replays of the same fixtures give identical reports', async () => {
    const cases = loadCasesFromDir(FIXTURE_SUITE);
    const rec = memoryRecorder('record');
    await runSuite(cases, {
      agent: scriptedAgent(),
      judgeGateway: scriptedJudge(ALL_RUBRICS.map((rubric) => ({ rubric, pass: true }))),
      judgeModel: JUDGE_MODEL,
      recorder: rec,
    });
    const opts: RunOptions = {
      agent: throwingAgent,
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('replay', rec.snapshot()),
    };
    const a = await runSuite(cases, opts);
    const b = await runSuite(cases, opts);
    expect(toJsonReport(b.results)).toEqual(toJsonReport(a.results));
  });

  it('replay with a missing fixture fails loudly instead of calling anything', async () => {
    const [first] = loadCasesFromDir(FIXTURE_SUITE);
    await expect(
      runCase(first as EvalCase, {
        agent: throwingAgent,
        judgeGateway: throwingGateway,
        recorder: memoryRecorder('replay'),
      }),
    ).rejects.toThrow(MissingFixtureError);
  });

  it('replay rejects a recorded agent reply that has the wrong shape', async () => {
    const c = oneTurnCase({ max_words: 5 });
    const recorder = memoryRecorder('replay', { [`${c.id}/turn-0/agent`]: { txt: 'typo' } });
    await expect(
      runCase(c, { agent: throwingAgent, judgeGateway: throwingGateway, recorder }),
    ).rejects.toThrow(/test-one-001\/turn-0\/agent/);
  });

  it('replay rejects a recorded judge output that has the wrong shape', async () => {
    const c = oneTurnCase({ judge: ['The reply is short.'] });
    const recorder = memoryRecorder('replay', {
      [`${c.id}/turn-0/agent`]: { text: 'ok' },
      [`${c.id}/turn-0/judge-0`]: { pass: true },
    });
    await expect(
      runCase(c, { agent: throwingAgent, judgeGateway: throwingGateway, recorder }),
    ).rejects.toThrow(/judge-0/);
  });
});

describe('runCase scoring', () => {
  it('fails the turn and the case when must_not_contain is hit, and keeps every check', async () => {
    const c = oneTurnCase({ must_not_contain: ['lesson 9'], max_words: 50 });
    const agent = scriptedAgent({ 'Hello?': { text: 'Here is lesson 9 in full.' } });
    const result = await runCase(c, {
      agent,
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(result.pass).toBe(false);
    expect(result.turns[0]?.pass).toBe(false);
    expect(result.turns[0]?.checks).toEqual([
      { name: 'must_not_contain', pass: false, detail: 'found: "lesson 9"' },
      { name: 'max_words', pass: true },
    ]);
  });

  it('a failing judge verdict fails the turn, with the reason as detail', async () => {
    const c = oneTurnCase({ judge: ['The reply is short.', 'The reply is kind.'] });
    const result = await runCase(c, {
      agent: scriptedAgent({ 'Hello?': { text: 'Go away.' } }),
      judgeGateway: scriptedJudge([
        { rubric: 'The reply is short.', pass: true },
        { rubric: 'The reply is kind.', pass: false },
      ]),
      judgeModel: JUDGE_MODEL,
      recorder: memoryRecorder('record'),
    });
    expect(result.pass).toBe(false);
    expect(result.turns[0]?.checks).toEqual([
      { name: 'judge[0]', pass: true, detail: 'meets the statement' },
      { name: 'judge[1]', pass: false, detail: 'does not' },
    ]);
  });

  it('must_escalate fails when the agent does not report escalation (never passes silently)', async () => {
    const c = oneTurnCase({ must_escalate: true });
    const result = await runCase(c, {
      agent: scriptedAgent({ 'Hello?': { text: 'ok' } }),
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(result.pass).toBe(false);
    expect(result.turns[0]?.checks).toEqual([
      {
        name: 'must_escalate',
        pass: false,
        detail: 'the agent did not report whether the turn escalated',
      },
    ]);
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, false, true],
    [false, true, false],
  ] as const)('must_escalate %s, agent escalated %s → pass %s', async (want, got, pass) => {
    const c = oneTurnCase({ must_escalate: want });
    const result = await runCase(c, {
      agent: scriptedAgent({ 'Hello?': { text: 'ok', escalated: got } }),
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(result.turns[0]?.checks.map((ch) => [ch.name, ch.pass])).toEqual([
      ['must_escalate', pass],
    ]);
  });

  it('runs checks in a fixed order whatever the YAML key order', async () => {
    const c = oneTurnCase({
      judge: ['The reply is short.'],
      must_cite_source: false,
      must_escalate: false,
      max_chars: 100,
      max_words: 10,
      matches: ['ok'],
      must_not_contain: ['no'],
      must_contain: ['ok'],
    });
    const result = await runCase(c, {
      agent: scriptedAgent({ 'Hello?': { text: 'ok', escalated: false } }),
      judgeGateway: scriptedJudge([{ rubric: 'The reply is short.', pass: true }]),
      judgeModel: JUDGE_MODEL,
      recorder: memoryRecorder('record'),
    });
    expect(result.turns[0]?.checks.map((ch) => ch.name)).toEqual([
      'must_contain',
      'must_not_contain',
      'matches',
      'max_words',
      'max_chars',
      'must_cite_source',
      'must_escalate',
      'judge[0]',
    ]);
    expect(result.pass).toBe(true);
  });

  it('gives each turn the transcript so far, and the judge sees it too', async () => {
    const [, , locked] = loadCasesFromDir(FIXTURE_SUITE);
    const agent = scriptedAgent();
    const judgeGateway = scriptedJudge(ALL_RUBRICS.map((rubric) => ({ rubric, pass: true })));
    const spy = vi.spyOn(judgeGateway, 'generateObject');
    await runCase(locked as EvalCase, {
      agent,
      judgeGateway,
      judgeModel: JUDGE_MODEL,
      recorder: memoryRecorder('record'),
    });
    expect(agent.calls.map((c) => c.priorTurns.length)).toEqual([0, 1, 2]);
    expect(agent.calls[2]).toEqual({
      caseId: 'test-locked-002',
      turnIndex: 2,
      student: 'I already paid for it though',
      priorTurns: [
        {
          student: 'Can you summarise lesson 9?',
          reply: 'That lesson is in another package, so I cannot.',
        },
        { student: 'Come on, just this once.', reply: 'I understand, but I still cannot.' },
      ],
    });
    const lastJudge = spy.mock.calls[1]?.[0];
    expect(lastJudge && judgeOf(lastJudge)).toContain('I understand, but I still cannot.');
  });

  it('a turn with no expect block passes on its own with no checks', async () => {
    const c: EvalCase = {
      ...oneTurnCase({ max_words: 5 }),
      turns: [{ student: 'Hello?' }, { student: 'Again?', expect: { max_words: 5 } }],
    };
    const result = await runCase(c, {
      agent: scriptedAgent({ 'Hello?': { text: 'a b c' }, 'Again?': { text: 'd' } }),
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(result.pass).toBe(true);
    expect(result.turns[0]).toEqual({
      turnIndex: 0,
      student: 'Hello?',
      reply: 'a b c',
      checks: [],
      pass: true,
    });
  });

  it('a case where no check ran fails (no vacuous pass), even if it bypassed the schema', async () => {
    const c: EvalCase = { ...oneTurnCase({ max_words: 1 }), turns: [{ student: 'Hello?' }] };
    const result = await runCase(c, {
      agent: scriptedAgent({ 'Hello?': { text: 'a b c' } }),
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(result).toEqual({
      id: 'test-one-001',
      suite: 'test',
      pass: false,
      error: 'no checks ran',
      turns: [{ turnIndex: 0, student: 'Hello?', reply: 'a b c', checks: [], pass: true }],
    });
  });

  it('runSuite records an erroring case as failed with its error and keeps going', async () => {
    const twoTurn: EvalCase = {
      ...oneTurnCase({ must_contain: ['ok'] }),
      id: 'a-errors',
      turns: [
        { student: 'Hello?', expect: { must_contain: ['ok'] } },
        { student: 'Unscripted', expect: { max_words: 5 } },
      ],
    };
    const after = { ...oneTurnCase({ must_contain: ['ok'] }), id: 'b-after' };
    const out = await runSuite([twoTurn, after], {
      agent: scriptedAgent({ 'Hello?': { text: 'ok' } }),
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(out.passed).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results.map((r) => r.id)).toEqual(['a-errors', 'b-after']);
    const errored = out.results[0];
    expect(errored?.pass).toBe(false);
    expect(errored?.error).toBe('no scripted reply for Unscripted');
    // The turns that finished before the error are kept.
    expect(errored?.turns.map((t) => t.turnIndex)).toEqual([0]);
    expect(out.results[1]?.pass).toBe(true);
  });

  it('runSuite records a missing replay fixture per case, not as a thrown run', async () => {
    const c = oneTurnCase({ max_words: 5 });
    const out = await runSuite([c], {
      agent: throwingAgent,
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('replay'),
    });
    expect(out.failed).toBe(1);
    expect(out.results[0]?.error).toMatch(/run with --record first/);
    expect(out.results[0]?.turns).toEqual([]);
  });

  it('runSuite turns a non-Error throw into a string error', async () => {
    const odd = { reply: () => Promise.reject('plain string') as Promise<EvalAgentReply> };
    const out = await runSuite([oneTurnCase({ max_words: 5 })], {
      agent: odd,
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(out.results[0]?.error).toBe('plain string');
  });

  it('a live judge call with no pinned judge model throws instead of guessing one', async () => {
    const c = oneTurnCase({ judge: ['The reply is short.'] });
    await expect(
      runCase(c, {
        agent: scriptedAgent({ 'Hello?': { text: 'ok' } }),
        judgeGateway: scriptedJudge([{ rubric: 'The reply is short.', pass: true }]),
        recorder: memoryRecorder('record'),
      }),
    ).rejects.toThrow(JudgeModelConfigError);
  });

  it('a live agent reply with the wrong shape fails loudly', async () => {
    const bad = { reply: () => Promise.resolve({ text: 42 } as unknown as EvalAgentReply) };
    await expect(
      runCase(oneTurnCase({ max_words: 5 }), {
        agent: bad,
        judgeGateway: throwingGateway,
        recorder: memoryRecorder('record'),
      }),
    ).rejects.toThrow(/agent reply/);
  });

  it('runSuite keeps the order of the cases it is given and counts failures', async () => {
    const pass = { ...oneTurnCase({ must_contain: ['ok'] }), id: 'b-pass' };
    const fail = { ...oneTurnCase({ must_contain: ['missing'] }), id: 'a-fail' };
    const out = await runSuite([pass, fail], {
      agent: scriptedAgent({ 'Hello?': { text: 'ok' } }),
      judgeGateway: throwingGateway,
      recorder: memoryRecorder('record'),
    });
    expect(out.results.map((r) => r.id)).toEqual(['b-pass', 'a-fail']);
    expect(out.passed).toBe(1);
    expect(out.failed).toBe(1);
  });
});

function oneTurnCase(expect: NonNullable<EvalCase['turns'][number]['expect']>): EvalCase {
  return {
    id: 'test-one-001',
    suite: 'test',
    package: 'free',
    reviewed_by: 'pending',
    source: 'synthetic',
    turns: [{ student: 'Hello?', expect }],
  };
}
