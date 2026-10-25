// `edmate chat` (task 3.9 Phase B): the REPL surface over Phase A's composition root
// (`buildChatDeps`). No real model call (rule 4): every multi-turn test injects the scripted
// gateway via `ChatCommandDeps.gateway`, which skips `createChatGateway`/`ANTHROPIC_API_KEY`
// entirely. The missing-key test never supplies a gateway, so it exercises the real key-loading
// error path, and asserts the message never echoes an environment value.
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { TurnEvent } from '@edmate/contracts';
import {
  adviceJudgeGateway,
  CLEAN_ADVICE_VERDICT,
  GROUNDED_VERDICT,
  judgeGateway,
  ScriptedGateway,
  spyGateway,
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { CHAT_USAGE, chatTurnInput, renderEvent, runChatCommand, type ChatMode } from './chat.js';
import { buildChatDeps, slackClock, type ChatDepsOptions } from './chat/deps.js';

// Task 3.9b: on a loaded CI runner the cold first turn overran preGuard's 400 ms budget on the real
// clock and ended in an `error` event. Tests widen every step budget 10x; production is unchanged.
const slackBuildDeps = (opts: ChatDepsOptions) =>
  buildChatDeps({ ...opts, clock: slackClock(10) });

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out,
    err,
  };
}

function linesStream(lines: readonly string[]): Readable {
  return Readable.from(lines.map((l) => `${l}\n`));
}

const say = (text: string) => ({ type: 'text' as const, text });
const used = {
  type: 'usage' as const,
  usage: { model: 'claude-haiku-4-5', tier: 'main' as const, inputTokens: 10, outputTokens: 10, costMicroUsd: 1 },
};

/** Scripted enough for several turns: one classifier match per turn (never consumed twice). */
function scriptedChatGateway(
  turns: number,
  reply = 'A variable stores a value so your program can use it later. [1]',
) {
  const scripted = new ScriptedGateway(
    {
      generateObject: Array.from({ length: turns }, () => [
        { match: (req: { system: string }) => req.system.includes('thoughts of suicide or self-harm'), value: { distress: false } },
        { match: (req: { system: string }) => req.system.includes('self_harm (wants to hurt themselves)'), value: { category: 'none' } },
        { match: (req: { system: string }) => req.system.includes('jailbreak_override'), value: { category: 'none' } },
      ]).flat(),
      stream: Array.from({ length: turns }, () => ({
        steps: [say(reply), used],
      })),
    },
    { sleep: () => Promise.resolve() },
  );
  const judged = judgeGateway(scripted, () => GROUNDED_VERDICT);
  return adviceJudgeGateway(judged, () => CLEAN_ADVICE_VERDICT);
}

describe('edmate chat --help', () => {
  it('prints usage and exits 0', async () => {
    const rec = capture();
    const code = await runChatCommand(['--help'], rec.io, { env: {}, cwd: '.' }, linesStream([]));
    expect(code).toBe(0);
    expect(rec.out.join('')).toBe(CHAT_USAGE);
  });
});

describe('edmate chat bad input', () => {
  it('rejects an unknown flag', async () => {
    const rec = capture();
    const code = await runChatCommand(['--nope'], rec.io, { env: {}, cwd: '.' }, linesStream([]));
    expect(code).toBe(1);
    expect(rec.err.join('')).toContain('edmate chat:');
  });

  it('rejects an unknown --package value', async () => {
    const rec = capture();
    const code = await runChatCommand(['--package', 'bogus'], rec.io, { env: {}, cwd: '.' }, linesStream([]));
    expect(code).toBe(1);
    expect(rec.err.join('')).toContain("--package must be 'free' or 'paid'");
  });

  it('rejects an unknown --source value', async () => {
    const rec = capture();
    const code = await runChatCommand(['--source', 'bogus'], rec.io, { env: {}, cwd: '.' }, linesStream([]));
    expect(code).toBe(1);
    expect(rec.err.join('')).toContain("--source must be");
  });

  it('rejects an unknown --agent id (this demo has exactly one agent)', async () => {
    const rec = capture();
    const code = await runChatCommand(['--agent', 'someone-else'], rec.io, { env: {}, cwd: '.' }, linesStream([]));
    expect(code).toBe(1);
    expect(rec.err.join('')).toContain('unknown agent');
  });
});

describe('edmate chat: missing key', () => {
  it('fails with a message naming the variable, never an environment value', async () => {
    const nonce = randomBytes(16).toString('hex');
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      { env: { SOME_UNRELATED_SECRET: nonce }, cwd: '.' },
      linesStream([]),
    );
    expect(code).toBe(1);
    const message = rec.err.join('');
    expect(message).toContain('ANTHROPIC_API_KEY');
    expect(message).not.toContain(nonce);
  });
});

describe('edmate chat: a scripted multi-turn session', () => {
  it(
    'streams a free-package reply with sources, then locks a module outside the free package',
    // Real demo-teacher content + a full harness turn; on CI the first-import cost of the
    // harness (mathjs, access) can eat most of the default 5000ms budget. See 5.5a follow-up.
    async () => {
      const rec = capture();
      const code = await runChatCommand(
        ['--package', 'free', '--source', 'teacher_preview'],
        rec.io,
        { env: {}, cwd: '.', gateway: scriptedChatGateway(2), buildDeps: slackBuildDeps },
        linesStream(['What is a variable?', 'Teach me loops please', 'exit']),
      );
      expect(code).toBe(0);
      const text = rec.out.join('');
      expect(rec.err).toEqual([]);
      expect(text).toContain('A variable stores a value');
      expect(text).toContain('[sources:');
      expect(text).toContain('[locked');
      expect(text).toContain('bye');
    },
    20000,
  );

  it('skips a blank line and keeps prompting', async () => {
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      { env: {}, cwd: '.', gateway: scriptedChatGateway(1), buildDeps: slackBuildDeps },
      linesStream(['', 'What is a variable?', 'exit']),
    );
    expect(code).toBe(0);
    expect(rec.out.join('')).toContain('A variable stores a value');
  });

  it('ends cleanly when stdin closes without "exit"', async () => {
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      { env: {}, cwd: '.', gateway: scriptedChatGateway(1), buildDeps: slackBuildDeps },
      linesStream(['What is a variable?']),
    );
    expect(code).toBe(0);
    expect(rec.out.join('')).toContain('bye');
  });
});

describe('renderEvent', () => {
  function render(e: TurnEvent): string {
    const out: string[] = [];
    renderEvent(e, { stdout: (s) => out.push(s) });
    return out.join('');
  }

  it('renders every event type without throwing', () => {
    expect(render({ type: 'token', text: 'hi' })).toBe('hi');
    expect(render({ type: 'sources', items: [{ title: 'Notes', locator: '¶1', kind: 'material' }] })).toContain('Notes');
    expect(render({ type: 'hint_rung', rung: 2 })).toContain('2');
    expect(render({ type: 'locked', packageName: 'Paid plan' })).toContain('Paid plan');
    expect(render({ type: 'locked' })).toContain('locked');
    expect(render({ type: 'teacher_question', questionId: 'tq_1' })).toContain('tq_1');
    expect(render({ type: 'skill', skill: 'coach', payload: {} })).toContain('coach');
    expect(render({ type: 'safety', level: 'alert' })).toContain('alert');
    expect(render({ type: 'replace', text: '' })).toContain('withdrawn');
    expect(render({ type: 'replace', text: 'new text' })).toContain('new text');
    expect(render({ type: 'error', code: 'provider_error', retryable: true })).toContain('provider_error');
    expect(render({ type: 'done', messageId: 'm_1', usage: [] })).toBe('\n');
  });
});

describe('chatTurnInput (5.8a role-play mode)', () => {
  const IDS = { agentId: 'demo-agent', sessionId: 'demo-session', studentId: 'demo-teacher' };
  const TS = '2026-10-21T00:00:00.000Z';
  const now = () => TS;
  const NORMAL: ChatMode = { mode: 'normal' };
  const ROLEPLAY: ChatMode = { mode: 'roleplay', persona: 'job-interview' };
  const base = { ...IDS, lang: 'en', clientTs: TS };

  it('a start sends only the bare persona id, with no text, and enters role-play mode', () => {
    const out = chatTurnInput(NORMAL, '/roleplay job-interview', IDS, now);
    expect(out.input).toStrictEqual({
      ...base,
      kind: 'skill_action',
      skill: 'mock_interview',
      skillPayload: { persona: 'job-interview' },
    });
    expect(out.input).not.toHaveProperty('text');
    expect(out.state).toEqual(ROLEPLAY);
    expect(out.notice).toBeUndefined();
  });

  it.each(['/roleplay', '/roleplay   ', '/roleplay a b', '/roleplay job-interview@1.0.0', '/roleplay ../x'])(
    'refuses %j locally with a usage line and sends no turn',
    (line) => {
      for (const state of [NORMAL, ROLEPLAY]) {
        const out = chatTurnInput(state, line, IDS, now);
        expect(out.input).toBeUndefined();
        expect(out.state).toEqual(state);
        expect(out.notice).toMatch(/usage: \/roleplay <persona-id>/u);
      }
    },
  );

  it.each(['A variable names a value.', '/pause need help', 'stop', 'I would use a list.'])(
    'in role-play mode sends %j as a mock_interview message',
    (line) => {
      const out = chatTurnInput(ROLEPLAY, line, IDS, now);
      expect(out.input).toStrictEqual({ ...base, kind: 'message', skill: 'mock_interview', text: line });
      expect(out.state).toEqual(ROLEPLAY);
    },
  );

  it('/leave sends no turn and later lines carry no skill', () => {
    const left = chatTurnInput(ROLEPLAY, '/leave', IDS, now);
    expect(left.input).toBeUndefined();
    expect(left.state).toEqual(NORMAL);
    expect(left.notice).toMatch(/left the role-play/u);
    const next = chatTurnInput(left.state, 'What is a loop?', IDS, now);
    expect(next.input).toStrictEqual({ ...base, kind: 'message', text: 'What is a loop?' });
  });

  it('/leave now (trailing words) still leaves the role-play, matching on the first word', () => {
    const out = chatTurnInput(ROLEPLAY, '/leave now', IDS, now);
    expect(out).toEqual({ state: { mode: 'normal' }, notice: 'left the role-play; back to normal chat' });
  });

  it('/leave outside role-play only says so', () => {
    const out = chatTurnInput(NORMAL, '/leave', IDS, now);
    expect(out.input).toBeUndefined();
    expect(out.state).toEqual(NORMAL);
    expect(out.notice).toMatch(/not in a role-play/u);
  });

  it('a plain session never sends a skill, even for /pause or stop', () => {
    for (const line of ['hello', '/pause', 'stop']) {
      const out = chatTurnInput(NORMAL, line, IDS, now);
      expect(out.input).toStrictEqual({ ...base, kind: 'message', text: line });
    }
  });
});

describe('edmate chat: a scripted role-play session (5.8a)', () => {
  it(
    'sends every role-play line with the mock_interview skill until /leave',
    async () => {
      // No citation: a role-play start retrieves no material, so a cited reply would be rewritten.
      const spy = spyGateway(scriptedChatGateway(5, 'Welcome. First question: what does a variable hold?'));
      const rec = capture();
      const code = await runChatCommand(
        ['--package', 'paid'],
        rec.io,
        { env: {}, cwd: '.', gateway: spy, buildDeps: slackBuildDeps },
        linesStream([
          '/roleplay job-interview@1.0.0',
          '/roleplay job-interview',
          'A variable names a value.',
          '/pause need help',
          'stop',
          '/leave',
          'What is a variable?',
          'exit',
        ]),
      );
      expect(code).toBe(0);
      expect(rec.err).toEqual([]);
      const text = rec.out.join('');
      expect(text).toContain('/roleplay <persona-id>');
      expect(text).toContain('usage: /roleplay <persona-id>');
      const mains = spy.requests.filter((r) => r.tier === 'main').map((r) => r.system);
      expect(mains).toHaveLength(5);
      for (const system of mains.slice(0, 4)) {
        expect(system).toContain('Skill: mock interview');
        expect(system).toContain('[[PERSONA]]');
      }
      expect(mains[4]).not.toContain('Skill: mock interview');
    },
    30000,
  );

  it('says role-play is unavailable when no personas loaded', async () => {
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      {
        env: {},
        cwd: '.',
        gateway: scriptedChatGateway(1),
        buildDeps: async (opts) => {
          const setup = await slackBuildDeps(opts);
          return { ...setup, personasSource: 'none' };
        },
      },
      linesStream(['exit']),
    );
    expect(code).toBe(0);
    expect(rec.out.join('')).toContain('Role-play is unavailable');
  });

  it('names the load failure reason in the banner when no personas loaded', async () => {
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      {
        env: {},
        cwd: '.',
        gateway: scriptedChatGateway(1),
        buildDeps: async (opts) => {
          const setup = await slackBuildDeps(opts);
          return { ...setup, personasSource: 'none', personasReason: '/no/such/dir: no such persona-template directory' };
        },
      },
      linesStream(['exit']),
    );
    expect(code).toBe(0);
    expect(rec.out.join('')).toContain('/no/such/dir: no such persona-template directory');
  });
});

describe('edmate chat: banner names the prompt-pack source (5.8e)', () => {
  it('shows "signed set" for the default (real) build', async () => {
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      { env: {}, cwd: '.', gateway: scriptedChatGateway(1), buildDeps: slackBuildDeps },
      linesStream(['exit']),
    );
    expect(code).toBe(0);
    expect(rec.out.join('')).toContain('signed set');
  });

  it('shows "fixture fallback" when the prompt-pack source is the fixture', async () => {
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      {
        env: {},
        cwd: '.',
        gateway: scriptedChatGateway(1),
        buildDeps: async (opts) => {
          const setup = await slackBuildDeps(opts);
          return { ...setup, promptPackSource: 'fixture' };
        },
      },
      linesStream(['exit']),
    );
    expect(code).toBe(0);
    expect(rec.out.join('')).toContain('fixture fallback');
  });
});
