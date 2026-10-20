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
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { CHAT_USAGE, renderEvent, runChatCommand } from './chat.js';

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
function scriptedChatGateway(turns: number) {
  const scripted = new ScriptedGateway(
    {
      generateObject: Array.from({ length: turns }, () => [
        { match: (req: { system: string }) => req.system.includes('thoughts of suicide or self-harm'), value: { distress: false } },
        { match: (req: { system: string }) => req.system.includes('self_harm (wants to hurt themselves)'), value: { category: 'none' } },
        { match: (req: { system: string }) => req.system.includes('jailbreak_override'), value: { category: 'none' } },
      ]).flat(),
      stream: Array.from({ length: turns }, () => ({
        steps: [say('A variable stores a value so your program can use it later. [1]'), used],
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
  it('streams a free-package reply with sources, then locks a module outside the free package', async () => {
    const rec = capture();
    const code = await runChatCommand(
      ['--package', 'free', '--source', 'teacher_preview'],
      rec.io,
      { env: {}, cwd: '.', gateway: scriptedChatGateway(2) },
      linesStream(['What is a variable?', 'Teach me loops please', 'exit']),
    );
    expect(code).toBe(0);
    const text = rec.out.join('');
    expect(rec.err).toEqual([]);
    expect(text).toContain('A variable stores a value');
    expect(text).toContain('[sources:');
    expect(text).toContain('[locked');
    expect(text).toContain('bye');
  });

  it('skips a blank line and keeps prompting', async () => {
    const rec = capture();
    const code = await runChatCommand(
      [],
      rec.io,
      { env: {}, cwd: '.', gateway: scriptedChatGateway(1) },
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
      { env: {}, cwd: '.', gateway: scriptedChatGateway(1) },
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
