// Task 4.2 acceptance: "100% on the seeded PII cases, and the model input the scripted gateway
// captures on every tier contains none of the case's PII (multi-turn split numbers stay reply
// checks)". 49 cases (35 seeded plus 4 from 4.0d plus 4 from 4.2c's hardening plus 6 from 7.2
// Phase E), 48 checked. Every
// case's turns go through the real `runTurn` with the real scrub and commit; the
// other steps are the harness's happy-path doubles plus three test-only probes:
//   - preGuard calls the small tier with `env.input` (as preGuard and route will),
//   - buildContext reads history back from the in-memory transcript store the real commit feeds,
//   - generate calls the main tier with that history plus `env.input`.
// The scripted gateway's `match` hook captures every request. Case text comes only from the YAML
// (3.12's loader); the PII to look for is each case's own `must_not_contain` phrases that occur in
// its input. Test names carry case ids only, never PII.
import { fileURLToPath } from 'node:url';
import type { ModelRequest, TurnInput } from '@edmate/contracts';
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

type ScrubStep = ReturnType<typeof testSteps>['scrub'];

async function runCase(c: EvalCase, scrub: ScrubStep = defaultSteps.scrub) {
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
    scrub,
    // Small-tier probe: what a classifier on `env.input` would send.
    preGuard: async (env) => {
      await env.gateway.generateObject(
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
      const stream = env.gateway.stream({
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
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          draft += chunk.text;
          emit({ type: 'token', text: chunk.text });
        } else if (chunk.type === 'usage') env.usage.record(chunk.usage);
      }
      return { draft };
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

/**
 * The leak detector: how many of the case's PII phrases (either digit script, any case) appear in
 * any captured model request or in stored history. A count, so a failure never prints the PII.
 */
function leakCount(c: EvalCase, run: Awaited<ReturnType<typeof runCase>>): number {
  const seen = [...run.captured.map((x) => textOf(x.req)), ...run.stored].flatMap(norm);
  return piiOf(c).filter((p) => norm(p).some((q) => seen.some((s) => s.includes(q)))).length;
}

describe('seeded PII cases (evals/suites/safety/pii)', () => {
  it('loads all 49 cases and checks 48 (the split spelled number stays a reply check)', () => {
    expect(CASES).toHaveLength(49);
    expect(CASES.map((c) => c.id)).toContain(EXCLUDED);
    expect(CHECKED).toHaveLength(48);
    for (const id of NO_PII) expect(CHECKED.map((c) => c.id)).toContain(id);
  });

  it.each(CHECKED.map((c) => ({ id: c.id, c })))(
    '$id: no PII in any captured model input, on both tiers, on every turn',
    { timeout: 10_000 },
    async ({ c }) => {
      const pii = piiOf(c);
      if (NO_PII.has(c.id)) expect(pii).toEqual([]);
      else expect(pii.length).toBeGreaterThan(0);

      const run = await runCase(c);
      const { captured, ends } = run;
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

      expect(leakCount(c, run), `${c.id}: PII phrases that reached the model or history`).toBe(0);
    },
  );

  it(
    'the leak detector catches a pass-through scrub on every PII case (mutation check)',
    { timeout: 30_000 },
    async () => {
      const passThrough = testSteps().scrub;
      const caught: string[] = [];
      for (const c of CHECKED) {
        const leaks = leakCount(c, await runCase(c, passThrough));
        if (NO_PII.has(c.id)) expect(leaks, c.id).toBe(0);
        else if (leaks > 0) caught.push(c.id);
      }
      expect(caught).toEqual(CHECKED.filter((c) => !NO_PII.has(c.id)).map((c) => c.id));
      expect(caught).toHaveLength(40);
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
