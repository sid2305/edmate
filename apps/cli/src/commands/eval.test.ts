import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelRequest } from '@edmate/contracts';
import type { EvalAgent } from '@edmate/evals';
import { manualClock, ScriptedGateway } from '@edmate/harness/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replayJudgeGateway, runEvalCommand, unwiredAgent } from './eval.js';

const CASE = `id: cli-case-001
suite: cli
package: free
reviewed_by: pending
source: synthetic CLI test fixture
turns:
  - student: "What is a fraction?"
    expect:
      must_contain: ["part"]
      judge: ["The reply explains a fraction."]
`;

const agent: EvalAgent = {
  reply: () => Promise.resolve({ text: 'A fraction is part of a whole.' }),
};

function judgeGateway(pass = true): ScriptedGateway {
  return new ScriptedGateway(
    {
      generateObject: [
        {
          match: (req: ModelRequest) =>
            (req.messages[0]?.content ?? '').includes('The reply explains a fraction.'),
          value: { pass, reason: pass ? 'explains it' : 'does not' },
        },
      ],
    },
    manualClock(),
  );
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out,
    err,
  };
}

const ENV = { EDMATE_JUDGE_MODEL: 'anthropic:judge-test-model' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cli-eval-'));
  writeFileSync(join(dir, 'case.yaml'), CASE);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('edmate eval', () => {
  it('records, then replays offline with the unwired agent and no judge (exit 0)', async () => {
    const make = vi.fn(() => Promise.resolve(judgeGateway()));
    const rec = capture();
    expect(
      await runEvalCommand(['.', '--record', '--fixtures', 'fx'], rec.io, {
        agent,
        env: ENV,
        cwd: dir,
        makeJudgeGateway: make,
      }),
    ).toBe(0);
    expect(make).toHaveBeenCalledWith({ provider: 'anthropic', model: 'judge-test-model' }, ENV);
    expect(rec.out.join('')).toBe('1/1 passed\n');

    const replay = capture();
    const noJudge = vi.fn();
    expect(
      await runEvalCommand(['.', '--fixtures', 'fx', '--report', 'out/report.json'], replay.io, {
        agent: unwiredAgent,
        env: {},
        cwd: dir,
        makeJudgeGateway: noJudge,
        now: () => new Date('2026-10-18T12:00:00.000Z'),
      }),
    ).toBe(0);
    expect(noJudge).not.toHaveBeenCalled();
    expect(replay.out.join('')).toBe('1/1 passed\n');
    expect(replay.err).toEqual([]);
    const report = JSON.parse(readFileSync(join(dir, 'out/report.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(report).toMatchObject({
      suite: '.',
      generatedAt: '2026-10-18T12:00:00.000Z',
      total: 1,
      passed: 1,
      failed: 0,
    });
  });

  it('defaults the fixtures directory to evals/fixtures under cwd', async () => {
    const { io } = capture();
    await runEvalCommand(['.', '--record'], io, {
      agent,
      env: ENV,
      cwd: dir,
      makeJudgeGateway: () => Promise.resolve(judgeGateway()),
    });
    expect(
      JSON.parse(readFileSync(join(dir, 'evals/fixtures/cli-case-001/turn-0/agent.json'), 'utf8')),
    ).toEqual({ text: 'A fraction is part of a whole.' });
  });

  it('exits 1 and names the failing case when a check fails', async () => {
    const { io, out } = capture();
    expect(
      await runEvalCommand(['.', '--record', '--fixtures', 'fx'], io, {
        agent,
        env: ENV,
        cwd: dir,
        makeJudgeGateway: () => Promise.resolve(judgeGateway(false)),
      }),
    ).toBe(1);
    expect(out.join('')).toBe('0/1 passed\nFAIL cli-case-001 turn 0 judge[0]: does not\n');
  });

  it('--record without EDMATE_JUDGE_MODEL surfaces the config error and calls nothing', async () => {
    const make = vi.fn();
    const reply = vi.fn(agent.reply);
    const { io, err } = capture();
    expect(
      await runEvalCommand(['.', '--record'], io, {
        agent: { reply },
        env: {},
        cwd: dir,
        makeJudgeGateway: make,
      }),
    ).toBe(1);
    expect(err.join('')).toContain('EDMATE_JUDGE_MODEL is not set');
    expect(make).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('replay with no fixtures fails loudly (exit 1) instead of calling live', async () => {
    const { io, out } = capture();
    expect(
      await runEvalCommand(['.', '--fixtures', 'fx'], io, {
        agent: unwiredAgent,
        env: ENV,
        cwd: dir,
      }),
    ).toBe(1);
    expect(out.join('')).toContain('FAIL cli-case-001 error:');
    expect(out.join('')).toContain('run with --record first');
  });

  it('a second --record lists every fixture it overwrote', async () => {
    const deps = {
      agent,
      env: ENV,
      cwd: dir,
      makeJudgeGateway: () => Promise.resolve(judgeGateway()),
    };
    const first = capture();
    await runEvalCommand(['.', '--record', '--fixtures', 'fx'], first.io, deps);
    expect(first.out.join('')).not.toContain('overwrote');
    const second = capture();
    expect(await runEvalCommand(['.', '--record', '--fixtures', 'fx'], second.io, deps)).toBe(0);
    expect(second.out.join('')).toBe(
      '1/1 passed\noverwrote 2 recorded fixtures:\n' +
        '  cli-case-001/turn-0/agent\n  cli-case-001/turn-0/judge-0\n',
    );
  });

  it('one erroring case does not hide the others (exit 1)', async () => {
    writeFileSync(join(dir, 'z-second.yaml'), CASE.replace('cli-case-001', 'cli-case-002'));
    let calls = 0;
    const flaky: EvalAgent = {
      reply: () =>
        ++calls === 1
          ? Promise.reject(new Error('agent crashed'))
          : Promise.resolve({ text: 'A fraction is part of a whole.' }),
    };
    const { io, out } = capture();
    expect(
      await runEvalCommand(['.', '--record', '--fixtures', 'fx'], io, {
        agent: flaky,
        env: ENV,
        cwd: dir,
        makeJudgeGateway: () => Promise.resolve(judgeGateway()),
      }),
    ).toBe(1);
    expect(out.join('')).toBe('1/2 passed\nFAIL cli-case-001 error: agent crashed\n');
  });

  it('reports a bad case file with its path', async () => {
    writeFileSync(join(dir, 'bad.yaml'), 'id: [oops\n');
    const { io, err } = capture();
    expect(await runEvalCommand(['.'], io, { agent, env: {}, cwd: dir })).toBe(1);
    expect(err.join('')).toContain('bad.yaml');
  });

  it.each([[[]], [['a', 'b']]])('needs exactly one suite directory (%j)', async (args) => {
    const { io, err } = capture();
    expect(await runEvalCommand(args, io, { agent, env: {}, cwd: dir })).toBe(1);
    expect(err.join('')).toContain('expected exactly one suite directory');
  });

  it('rejects an unknown flag with usage', async () => {
    const { io, err } = capture();
    expect(await runEvalCommand(['.', '--recrod'], io, { agent, env: {}, cwd: dir })).toBe(1);
    expect(err.join('')).toContain('Usage: edmate eval');
  });

  it('prints help', async () => {
    const { io, out } = capture();
    expect(await runEvalCommand(['-h'], io, { agent, env: {}, cwd: dir })).toBe(0);
    expect(out.join('')).toContain('--record');
  });
});

describe('replay stand-ins', () => {
  it('the replay judge gateway refuses every call', async () => {
    expect(() => replayJudgeGateway.stream({} as ModelRequest)).toThrow(/replay mode/);
    await expect(
      replayJudgeGateway.generateObject({} as ModelRequest, {} as never),
    ).rejects.toThrow(/replay mode/);
    await expect(replayJudgeGateway.embed([])).rejects.toThrow(/replay mode/);
  });

  it('the unwired agent refuses every call', async () => {
    await expect(
      unwiredAgent.reply({ caseId: 'c', turnIndex: 0, student: 's', priorTurns: [] }),
    ).rejects.toThrow(/no agent under test/);
  });
});
