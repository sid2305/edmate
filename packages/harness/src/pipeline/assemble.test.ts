// 5.6c (5.6a typescript-review MEDIUM): `assemble` builds the TurnContext from an allow-list of
// TurnContextSchema's keys, so a new runner-only BuiltContext field can never push a turn to the
// fallback context, and the help state never enters the TurnContext.
import { TurnContextSchema } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunk,
  demoEntitlementSubscription,
  demoLearnerProfile,
  demoLocalePack,
  demoPackagePaid,
  demoPersona,
  demoStyleCard,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import { testDeps, testSteps } from '../testing/testSteps.js';
import { assemble, TURN_CONTEXT_KEYS } from './assemble.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { BuiltContext, Entitled } from './types.js';

const HELD_KEY = 'HELP_STATE_KEY_77a1';
const HISTORY = {
  id: 'msg_test_01',
  role: 'student',
  text: 'HISTORYMARKER earlier question',
  createdAt: '2026-10-20T10:00:00.000Z',
} as const;

const entitled: Entitled = {
  entitlement: demoEntitlementSubscription,
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  locale: demoLocalePack,
  styleCard: demoStyleCard,
  helpState: { v: 1, rung: 2, answerKey: [HELD_KEY] },
};

/** Every BuiltContext field set, the optional ones included. */
function fullBuilt(o: Partial<BuiltContext> = {}): Required<BuiltContext> {
  return {
    profile: demoLearnerProfile,
    history: [HISTORY],
    retrieved: [demoChunk],
    lockedHit: false,
    persona: demoPersona,
    helpRung: 1,
    helpState: { ...INITIAL_HELP_STATE, answerKey: [HELD_KEY], practiceCarriedKey: [HELD_KEY] },
    helpStateUnreadable: true,
    answerKeyDropped: 3,
    ...o,
  } as Required<BuiltContext>;
}

describe('assemble: an allow-list of TurnContextSchema keys (5.6c)', () => {
  it('the allow-list is exactly TurnContextSchema’s keys', () => {
    expect([...TURN_CONTEXT_KEYS].sort()).toEqual(Object.keys(TurnContextSchema.shape).sort());
  });

  it('a BuiltContext with every optional field set assembles to the real context', () => {
    const b: BuiltContext = fullBuilt();
    delete b.helpStateUnreadable;
    const ctx = assemble(entitled, b, 'on_task', 'none');
    expect(ctx).not.toBeNull();
    expect(ctx?.history).toEqual(b.history);
    expect(ctx?.retrieved).toEqual([demoChunk]);
    expect(ctx?.persona).toEqual(demoPersona);
    expect(ctx?.helpRung).toBe(1);
    expect(Object.keys(ctx ?? {}).sort()).toEqual([...TURN_CONTEXT_KEYS].sort());
  });

  it('runner-only fields and the help state never enter the TurnContext', () => {
    const ctx = assemble(entitled, fullBuilt(), 'on_task', 'none');
    expect(ctx).not.toBeNull();
    for (const k of ['helpState', 'helpStateUnreadable', 'answerKeyDropped']) {
      expect(ctx).not.toHaveProperty(k);
    }
    expect(JSON.stringify(ctx)).not.toContain(HELD_KEY);
  });

  it('an unreadable help state assembles with no retrieved material (fail closed)', () => {
    const ctx = assemble(entitled, fullBuilt(), 'on_task', 'none');
    expect(ctx?.retrieved).toEqual([]);
    expect(ctx?.history).toEqual(fullBuilt().history);
  });

  it('a context the schema refuses still gives null (a chunk from another teacher)', () => {
    const b = fullBuilt({ retrieved: [{ ...demoChunk, teacherId: 'tch_other' }] });
    delete (b as Partial<BuiltContext>).helpStateUnreadable;
    expect(assemble(entitled, b, 'on_task', 'none')).toBeNull();
  });
});

describe('runner: an unreadable help state (5.6c, Q7)', () => {
  it('gets the real context with no material, holds the whole reply and saves no state', async () => {
    const TWO = ['One two three four five six seven eight. ', 'Nine ten eleven twelve. '];
    const t = testDeps({
      script: {
        stream: [
          {
            match: (r) => r.tier === 'main',
            steps: [
              { type: 'text', text: TWO[0] ?? '' },
              { type: 'text', text: TWO[1] ?? '' },
              { type: 'usage', usage: usageMain },
            ],
          },
        ],
      },
      judge: 'grounded',
    });
    const steps = testSteps({
      entitle: () =>
        Promise.resolve({
          ...entitled,
          agent: { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION },
        }),
      generate: defaultSteps.generate,
      buildContext: () =>
        Promise.resolve({
          profile: demoLearnerProfile,
          history: [HISTORY],
          retrieved: [],
          lockedHit: false,
          helpRung: 0,
          helpState: { ...INITIAL_HELP_STATE, answerKey: [] },
          helpStateUnreadable: true,
          answerKeyDropped: 1,
        }),
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    // The real context (its history), not fallbackContext's empty one.
    expect(steps.commits[0]?.context?.history).toEqual([HISTORY]);
    expect(result.trace?.steps.find((s) => s.name === 'buildContext')?.outcome).toBe('ok');
    // One token event: the whole reply at the clean end.
    expect(events.filter((e) => e.type === 'token')).toEqual([
      { type: 'token', text: TWO.join('') },
    ]);
    expect(steps.commits[0]?.context?.retrieved).toEqual([]);
    expect(steps.commits[0]?.next).toBeUndefined();
  });
});
