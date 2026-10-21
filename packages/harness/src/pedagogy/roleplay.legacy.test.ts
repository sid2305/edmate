// Task 5.8 Phase A (ADR-0013 §5): under a legacy frame (`questions_asked` and
// `persona_end_after`, no role-play sections) the composer still shows "question N of M" from the
// saved count. Two counts change on purpose under every set: the turn after `/pause` resumes the
// same question (it used to show N + 1), and every turn after a `stop` keeps the count (it used to
// rise towards M). Everything else is as before.
import { demoAgentConfig, demoPersona } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_PROMPT_PACK_VERSION,
  fixturePromptPackSet,
} from '../testing/promptPackFixtures.js';
import { composeSystemPrompt } from './compose.js';
import { INITIAL_HELP_STATE, copyHelp } from './helpState.js';
import { decidePolicy } from './policy.js';
import { rolePlayControl } from './skills.js';
import { ctxWith, turnOf } from './testing.js';

const M = demoPersona.endAfterQuestions;
const agent = { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION };
const ctx = ctxWith({ agent, persona: demoPersona, entitlement: { skills: ['mock_interview'] } });

/** Each turn's shown "N/M" and phase; turn 0 is the start button. */
function replay(texts: readonly string[]): string[] {
  let help = copyHelp(INITIAL_HELP_STATE);
  return texts.map((text, n) => {
    const kind = n === 0 ? 'skill_action' : 'message';
    const control = rolePlayControl({ kind, text });
    const p = decidePolicy({
      ctx,
      turn: turnOf(kind, 'mock_interview'),
      help,
      ...(control === undefined ? {} : { control }),
    });
    const prompt = composeSystemPrompt({ ctx, policy: p, lang: 'en', set: fixturePromptPackSet });
    const m = /This is question (\d+) of (\d+)/.exec(prompt.systemPrompt);
    help = p.next.help;
    return `${m?.[1] ?? '?'}/${m?.[2] ?? '?'} ${p.rolePlay?.phase ?? 'none'}`;
  });
}

describe('legacy-frame counts (ADR-0013 §5)', () => {
  it('start, answer, stop, message: the turn after stop keeps question 2 (was 3)', () => {
    expect(replay(['', 'my answer', 'stop', 'and another thing'])).toEqual([
      '1/5 question',
      '2/5 question',
      '2/5 stopped',
      '2/5 ended',
    ]);
  });

  it('start, answer, /pause, message: the resume shows question 2 again (was 3)', () => {
    expect(replay(['', 'my answer', '/pause help me', 'ok, my answer'])).toEqual([
      '1/5 question',
      '2/5 question',
      '2/5 pause',
      '2/5 resume',
    ]);
  });

  it('all asked: the debrief and the turns after it show M of M, as before', () => {
    const answers = Array.from({ length: M + 1 }, (_, n) => `answer ${String(n)}`);
    expect(replay(['', ...answers])).toEqual([
      '1/5 question',
      '2/5 question',
      '3/5 question',
      '4/5 question',
      '5/5 question',
      '5/5 debrief',
      '5/5 ended',
    ]);
  });
});
