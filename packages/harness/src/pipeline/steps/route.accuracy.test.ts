// route's accuracy gate (task 3.3, Phase B): ≥ 90% overall and ≥ 90% on the English-only subset
// of `labelledTurns` (200 turns, reviewed_by: lead — see labelledTurns.ts). Drives the real
// `route.run` with the scripted gateway standing in for the model fallback (rule 4: no real model
// calls); the fallback is scripted to answer with the turn's own label, so this test measures
// whether the rules (and the fallback wiring) land on the right `RouteResult`, not the quality of
// a real model's guess, which nothing here can measure without one.
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
  demoTurnInput,
} from '@edmate/contracts/fixtures';
import type { TurnInput } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { labelledTurns, type LabelledTurn } from '../../routing/labelledTurns.js';
import { ScriptedGateway } from '../../testing/scriptedGateway.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import { cancelSource } from '../clock.js';
import type { Entitled, StepEnv } from '../types.js';
import { route } from './route.js';

const MIN_ACCURACY = 0.9;

/** For the record in CI output on a failure (the harness has no DOM or Node types). */
const logMisses = (m: string): void =>
  (globalThis as unknown as { console: { error(s: string): void } }).console.error(m);

const helpState = (answerKey: readonly string[]) => ({
  v: 1,
  rung: 1,
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  answerKey,
});

function buildInput(turn: LabelledTurn): TurnInput {
  const base: Record<string, unknown> = {
    ...demoTurnInput,
    kind: turn.kind,
    lang: turn.english ? 'en' : 'hi',
  };
  if (turn.text === undefined) delete base.text;
  else base.text = turn.text;
  if (turn.skill === undefined) delete base.skill;
  else base.skill = turn.skill;
  return base as TurnInput;
}

function buildEntitled(turn: LabelledTurn): Entitled {
  return {
    entitlement: demoEntitlementSubscription,
    agent: demoAgentConfig,
    pkg: demoPackagePaid,
    locale: demoLocalePack,
    styleCard: demoStyleCard,
    ...(turn.answerKey === undefined ? {} : { helpState: helpState(turn.answerKey) }),
  };
}

function buildEnv(turn: LabelledTurn): StepEnv {
  const t = testDeps({});
  // One scripted answer, equal to the turn's own label: the fallback is never asked to guess, it
  // only has to be reached (and only when the rules are inconclusive) and plumbed through.
  const gateway = new ScriptedGateway(
    { generateObject: [{ value: { intent: turn.intent } }] },
    t.clock,
  );
  return {
    input: buildInput(turn),
    deps: t.deps,
    cancel: cancelSource().token,
    turnId: `turn_${turn.id}`,
    ...stepEnvExtras(),
    gateway,
  };
}

interface Miss {
  id: string;
  text: string;
  english: boolean;
  expected: { intent: string; attempt: string };
  actual: { intent: string; attempt: string };
}

describe('route.accuracy', () => {
  it(`is ≥ ${MIN_ACCURACY * 100}% overall and ≥ ${MIN_ACCURACY * 100}% on the English subset`, async () => {
    const misses: Miss[] = [];
    let correct = 0;
    let englishTotal = 0;
    let englishCorrect = 0;

    for (const turn of labelledTurns) {
      const env = buildEnv(turn);
      const s = buildEntitled(turn);
      // eslint-disable-next-line no-await-in-loop -- 200 small, independent, in-process calls.
      const result = await route.run(env, s);
      const ok = result.intent === turn.intent && result.attempt === turn.attempt;
      if (turn.english) englishTotal += 1;
      if (ok) {
        correct += 1;
        if (turn.english) englishCorrect += 1;
      } else {
        misses.push({
          id: turn.id,
          text: turn.text ?? '',
          english: turn.english,
          expected: { intent: turn.intent, attempt: turn.attempt },
          actual: { intent: result.intent, attempt: result.attempt },
        });
      }
    }

    const overall = correct / labelledTurns.length;
    const english = englishTotal === 0 ? 1 : englishCorrect / englishTotal;

    // Grouped by (expected intent -> actual intent) and separately by attempt, so a pattern (not
    // just a count) is visible in a failure message or in CI output.
    const intentPatterns = new Map<string, string[]>();
    const attemptPatterns = new Map<string, string[]>();
    for (const m of misses) {
      if (m.expected.intent !== m.actual.intent) {
        const k = `${m.expected.intent} -> ${m.actual.intent}`;
        intentPatterns.set(k, [...(intentPatterns.get(k) ?? []), m.id]);
      }
      if (m.expected.attempt !== m.actual.attempt) {
        const k = `${m.expected.attempt} -> ${m.actual.attempt}`;
        attemptPatterns.set(k, [...(attemptPatterns.get(k) ?? []), m.id]);
      }
    }
    const report = {
      overall: `${(overall * 100).toFixed(1)}%`,
      english: `${(english * 100).toFixed(1)}%`,
      missCount: misses.length,
      intentPatterns: Object.fromEntries(intentPatterns),
      attemptPatterns: Object.fromEntries(attemptPatterns),
      misses,
    };
    if (misses.length > 0) {
      logMisses(`route.accuracy misses: ${JSON.stringify(report, null, 2)}`);
    }

    expect(overall, JSON.stringify(report, null, 2)).toBeGreaterThanOrEqual(MIN_ACCURACY);
    expect(english, JSON.stringify(report, null, 2)).toBeGreaterThanOrEqual(MIN_ACCURACY);
  });
});
