// Task 4.2 acceptance: "100% on the seeded PII cases, and the model input the scripted gateway
// captures on every tier contains none of the case's PII (multi-turn split numbers stay reply
// checks)". Every case's turns go through the real `runTurn` with the real scrub and commit; the
// other steps are the harness's happy-path doubles plus three test-only probes:
//   - preGuard calls the small tier with `env.input` (as preGuard and route will),
//   - buildContext reads history back from the in-memory transcript store the real commit feeds,
//   - generate calls the main tier with that history plus `env.input`.
// The scripted gateway's `match` hook captures every request. Case text comes only from the YAML
// (3.12's loader); the PII to look for is each case's own `must_not_contain` phrases that occur in
// its input. Test names carry case ids only, never PII.
import { fileURLToPath } from 'node:url';
import type { ModelRequest, TurnInput, Usage } from '@edmate/contracts';
import { defaultSteps, runTurn } from '@edmate/harness';
import {
  demoTurnInput,
  driveTurn,
  indiaLocalePackWithPii,
  memorySessionStateStore,
  memoryTranscriptStore,
  scriptedStreamText,
  testDeps,
  testSteps,
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadCasesFromDir } from './loader.js';
import type { EvalCase } from './schema.js';

const PII_DIR = fileURLToPath(new URL('../../../evals/suites/safety/pii/', import.meta.url));
const CASES = loadCasesFromDir(PII_DIR);

/** A number split across turns and spelled in words: regex can't link it (stays a reply check). */
const EXCLUDED = 'safety-pii-phone-split-spelled-hi-latin';
/** Cases whose input holds no in-scope PII: the model must get the input byte for byte. */
const NO_PII = new Set([
  'safety-pii-address-fstring-en',
  'safety-pii-address-note-hi-latin',
  'safety-pii-address-print-deva',
  'safety-pii-nearmiss-marks-average-hi-latin',
  'safety-pii-nearmiss-ten-digit-int-en',
  'safety-pii-nearmiss-test-marks-deva',
  'safety-pii-nearmiss-year-scores-en',
  'safety-pii-teacher-contact-en',
]);
const CHECKED = CASES.filter((c) => c.id !== EXCLUDED);

/** Devanagari digits to ASCII, written independently of the guard's own folding. */
const foldDeva = (s: string): string =>
  s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
const norm = (s: string): string[] => [s.toLowerCase(), foldDeva(s).toLowerCase()];

/** The case's own `must_not_contain` phrases that occur in its input (in either digit script). */
function piiOf(c: EvalCase): string[] {
  const input = norm(c.turns.map((t) => t.student).join('\n'));
  const phrases = c.turns.flatMap((t) => t.expect?.must_not_contain ?? []);
  return [...new Set(phrases)].filter((p) => norm(p).some((q) => input.some((i) => i.includes(q))));
}

interface Captured {
  turn: number;
  req: ModelRequest;
}

const textOf = (req: ModelRequest): string =>
  [req.system, ...req.messages.map((m) => m.content)].join('\n');
const userText = (req: ModelRequest): string | undefined => req.messages.at(-1)?.content;

async function runCase(c: EvalCase) {
  const captured: Captured[] = [];
  let turn = 0;
  const capture = (req: ModelRequest): boolean => {
    captured.push({ turn, req });
    return true;
  };
  const transcripts = memoryTranscriptStore();
  const t = testDeps({
    script: {
      stream: c.turns.map(() => ({ match: capture, steps: scriptedStreamText.steps })),
      generateObject: c.turns.map(() => ({ match: capture, value: { safe: true } })),
    },
    overrides: { transcripts, sessionState: memorySessionStateStore() },
  });
  const happy = testSteps();
  const steps = testSteps({
    entitle: async (env) => ({ ...(await happy.entitle(env)), locale: indiaLocalePackWithPii }),
    scrub: defaultSteps.scrub,
    // Small-tier probe: what a classifier on `env.input` would send.
    preGuard: async (env) => {
      await env.deps.gateway.generateObject(
        {
          tier: 'small',
          system: 'Classify the student message.',
          messages: [{ role: 'user', content: env.input.text ?? '' }],
          maxOutputTokens: 16,
        },
        z.object({ safe: z.boolean() }),
      );
      return { result: 'ok', guards: [], usage: [] };
    },
    // History comes back from what the real commit stored (CommitRecord.input).
    buildContext: async (env, e) => ({
      ...(await happy.buildContext(env, e)),
      history: await env.deps.transcripts.history(env.input.sessionId, 20),
    }),
    // Main-tier probe: history plus the current (scrubbed) input.
    async generate(env, { ctx, decision }, emit) {
      let draft = '';
      const stream = env.deps.gateway.stream({
        tier: 'main',
        system: decision.systemPrompt,
        messages: [
          ...ctx.history.map((m) => ({
            role: m.role === 'student' ? ('user' as const) : ('assistant' as const),
            content: m.text,
          })),
          { role: 'user', content: env.input.text ?? '' },
        ],
        maxOutputTokens: decision.maxOutputTokens,
      });
      const usage: Usage[] = [];
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          draft += chunk.text;
          emit({ type: 'token', text: chunk.text });
        } else if (chunk.type === 'usage') usage.push(chunk.usage);
      }
      return { draft, usage };
    },
    commit: defaultSteps.commit,
  });

  const lang = c.id.endsWith('-en') ? 'en' : 'hi';
  const ends: string[] = [];
  for (const [i, { student }] of c.turns.entries()) {
    turn = i;
    const input: TurnInput = { ...demoTurnInput, text: student, lang };
    const { events } = await driveTurn(runTurn(input, { deps: t.deps, steps }), t.clock);
    ends.push(events.at(-1)?.type ?? 'none');
  }
  return { captured, ends, stored: transcripts.appended.map((a) => a.message.text) };
}

describe('seeded PII cases (evals/suites/safety/pii)', () => {
  it('loads all 35 cases and checks 34 (the split spelled number stays a reply check)', () => {
    expect(CASES).toHaveLength(35);
    expect(CASES.map((c) => c.id)).toContain(EXCLUDED);
    expect(CHECKED).toHaveLength(34);
    for (const id of NO_PII) expect(CHECKED.map((c) => c.id)).toContain(id);
  });

  it.each(CHECKED.map((c) => ({ id: c.id, c })))(
    '$id: no PII in any captured model input, on both tiers, on every turn',
    { timeout: 10_000 },
    async ({ c }) => {
      const pii = piiOf(c);
      if (NO_PII.has(c.id)) expect(pii).toEqual([]);
      else expect(pii.length).toBeGreaterThan(0);

      const { captured, ends, stored } = await runCase(c);
      expect(ends).toEqual(c.turns.map(() => 'done'));

      for (const [i, { student }] of c.turns.entries()) {
        const mine = captured.filter((x) => x.turn === i);
        expect(mine.map((x) => x.req.tier).sort()).toEqual(['main', 'small']);
        if (NO_PII.has(c.id)) {
          // Shaped, not "any number": the input reaches the model unchanged.
          for (const x of mine) expect(userText(x.req)).toBe(student);
        }
        if (i > 0) {
          // History really is in the request: earlier turns (scrubbed) plus the replies.
          const main = mine.find((x) => x.req.tier === 'main');
          expect(main?.req.messages.length).toBe(2 * i + 1);
        }
      }

      const seen = [...captured.map((x) => textOf(x.req)), ...stored].flatMap(norm);
      for (const p of pii) {
        for (const q of norm(p)) {
          expect(
            seen.some((s) => s.includes(q)),
            `${c.id}: a must_not_contain phrase reached the model or history`,
          ).toBe(false);
        }
      }
    },
  );

  it('the multi-turn cases carry turn 1 (scrubbed) into turn 2', { timeout: 10_000 }, async () => {
    const multi = CHECKED.filter((c) => c.turns.length > 1);
    expect(multi.map((c) => c.id).sort()).toEqual([
      'safety-pii-pan-recall-hi-latin',
      'safety-pii-recall-later-en',
    ]);
    for (const c of multi) {
      const { captured } = await runCase(c);
      const turn2 = captured.find((x) => x.turn === 1 && x.req.tier === 'main');
      const first = turn2?.req.messages[0]?.content ?? '';
      expect(first).not.toBe(c.turns[0]?.student);
      expect(first).toMatch(/\[(?:phone|id)\]/);
    }
  });
});
