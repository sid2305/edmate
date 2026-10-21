// Task 5.8 Phase A (ADR-0013 §1): the role-play state machine, one test per table row and one
// per clamp. demoPersona has M = 5.
import { demoPersona } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { type HelpState, PERSONA_QUESTIONS_MAX } from './helpState.js';
import {
  ROLEPLAY_PHASE_SECTION,
  ROLEPLAY_PHASES,
  type RolePlayControl,
  rolePlayStep,
  type StoredPersonaPhase,
} from './roleplay.js';

const M = demoPersona.endAfterQuestions;

function stored(
  asked: number | undefined,
  phase?: StoredPersonaPhase,
  personaId: string | null = demoPersona.id,
): Pick<HelpState, 'personaQuestionsAsked' | 'personaId' | 'personaPhase'> {
  return {
    ...(asked === undefined ? {} : { personaQuestionsAsked: asked }),
    ...(personaId === null ? {} : { personaId }),
    ...(phase === undefined ? {} : { personaPhase: phase }),
  };
}

function step(
  help: ReturnType<typeof stored>,
  control?: RolePlayControl,
  persona: { id: string; endAfterQuestions: number } = demoPersona,
) {
  return rolePlayStep({ persona, help, ...(control === undefined ? {} : { control }) });
}

describe('rolePlayStep: the table, first matching row wins (ADR-0013 §1)', () => {
  it('row 1: a start opens question 1 and clears a stored phase', () => {
    for (const phase of [undefined, 'paused', 'ended'] as const) {
      expect(step(stored(3, phase), 'start')).toEqual({
        rolePlay: { phase: 'question', question: 1, total: M },
        asked: 1,
        stored: null,
      });
    }
  });

  it('row 1: a persona switch opens question 1, even while ended', () => {
    const other = { id: 'per_test_02', endAfterQuestions: 4 };
    expect(step(stored(4, 'ended'), undefined, other)).toEqual({
      rolePlay: { phase: 'question', question: 1, total: 4 },
      asked: 1,
      stored: null,
    });
  });

  it('row 1: a blob with no persona id (before 3.11e) starts at question 1', () => {
    expect(step(stored(4, undefined, null))).toEqual({
      rolePlay: { phase: 'question', question: 1, total: M },
      asked: 1,
      stored: null,
    });
  });

  it.each([undefined, 'pause', 'stop'] as const)(
    'row 2: stored ended stays ended (control %s), count unchanged',
    (control) => {
      expect(step(stored(3, 'ended'), control)).toEqual({
        rolePlay: { phase: 'ended' },
        asked: 3,
        stored: 'ended',
      });
    },
  );

  it('row 3: /pause keeps the count and saves paused', () => {
    expect(step(stored(2), 'pause')).toEqual({
      rolePlay: { phase: 'pause', question: 2, total: M },
      asked: 2,
      stored: 'paused',
    });
  });

  it('row 3: /pause while paused pauses again (more coaching)', () => {
    expect(step(stored(2, 'paused'), 'pause')).toEqual({
      rolePlay: { phase: 'pause', question: 2, total: M },
      asked: 2,
      stored: 'paused',
    });
  });

  it('row 4: stop keeps the count, reports before − 1 answered and saves ended', () => {
    expect(step(stored(3), 'stop')).toEqual({
      rolePlay: { phase: 'stopped', answered: 2 },
      asked: 3,
      stored: 'ended',
    });
  });

  it('row 4: stop while paused is a stop', () => {
    expect(step(stored(3, 'paused'), 'stop')).toEqual({
      rolePlay: { phase: 'stopped', answered: 2 },
      asked: 3,
      stored: 'ended',
    });
  });

  it('row 5: the turn after a pause resumes the same question, no count, phase cleared', () => {
    expect(step(stored(2, 'paused'))).toEqual({
      rolePlay: { phase: 'resume', question: 2, total: M },
      asked: 2,
      stored: null,
    });
  });

  it('row 5: a resume at question M resumes it, never debriefs early', () => {
    expect(step(stored(M, 'paused')).rolePlay).toEqual({
      phase: 'resume',
      question: M,
      total: M,
    });
  });

  it('row 6: the answer to question M gives the debrief and saves ended', () => {
    expect(step(stored(M))).toEqual({
      rolePlay: { phase: 'debrief', total: M },
      asked: M,
      stored: 'ended',
    });
  });

  it('row 7: any other turn asks the next question and clears the phase', () => {
    expect(step(stored(2))).toEqual({
      rolePlay: { phase: 'question', question: 3, total: M },
      asked: 3,
      stored: null,
    });
    expect(step(stored(M - 1)).rolePlay).toEqual({ phase: 'question', question: M, total: M });
  });

  it('a whole role-play: start, M − 1 answers, the last answer, then ended', () => {
    let help = stored(undefined, undefined, null);
    const seen: string[] = [];
    const controls: (RolePlayControl | undefined)[] = ['start', ...Array<undefined>(M + 1)];
    for (const c of controls) {
      const r = step(help, c);
      seen.push(
        r.rolePlay.phase === 'question' ? `q${String(r.rolePlay.question)}` : r.rolePlay.phase,
      );
      help = stored(r.asked, r.stored ?? undefined);
    }
    expect(seen).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'debrief', 'ended']);
  });
});

describe('rolePlayStep: clamps (ADR-0013 §1)', () => {
  it('total is max(1, M): M = 0 gives total 1 and debriefs after question 1', () => {
    const zero = { id: demoPersona.id, endAfterQuestions: 0 };
    expect(step(stored(0), undefined, zero).rolePlay).toEqual({
      phase: 'question',
      question: 1,
      total: 1,
    });
    expect(step(stored(1), undefined, zero).rolePlay).toEqual({ phase: 'debrief', total: 1 });
  });

  it('total is capped at PERSONA_QUESTIONS_MAX; the count never passes it', () => {
    const huge = { id: demoPersona.id, endAfterQuestions: PERSONA_QUESTIONS_MAX + 50 };
    expect(step(stored(PERSONA_QUESTIONS_MAX - 1), undefined, huge)).toEqual({
      rolePlay: {
        phase: 'question',
        question: PERSONA_QUESTIONS_MAX,
        total: PERSONA_QUESTIONS_MAX,
      },
      asked: PERSONA_QUESTIONS_MAX,
      stored: null,
    });
    expect(step(stored(PERSONA_QUESTIONS_MAX), undefined, huge).rolePlay).toEqual({
      phase: 'debrief',
      total: PERSONA_QUESTIONS_MAX,
    });
  });

  it('pause with no stored count (id carried alone) shows question 1, never 0', () => {
    expect(step(stored(undefined), 'pause').rolePlay).toEqual({
      phase: 'pause',
      question: 1,
      total: M,
    });
  });

  it('pause with a count past M (a lower M went live) shows question M', () => {
    const r = step(stored(M + 3), 'pause');
    expect(r.rolePlay).toEqual({ phase: 'pause', question: M, total: M });
    expect(r.asked).toBe(M + 3);
  });

  it('resume with no stored count shows question 1', () => {
    expect(step(stored(0, 'paused')).rolePlay).toEqual({ phase: 'resume', question: 1, total: M });
  });

  it('resume with a count past M shows question M', () => {
    expect(step(stored(M + 3, 'paused')).rolePlay).toEqual({
      phase: 'resume',
      question: M,
      total: M,
    });
  });

  it('stop right after the start reports 0 answered', () => {
    expect(step(stored(1), 'stop').rolePlay).toEqual({ phase: 'stopped', answered: 0 });
  });

  it('stop with no stored count reports 0 answered, never −1', () => {
    expect(step(stored(undefined), 'stop').rolePlay).toEqual({ phase: 'stopped', answered: 0 });
  });

  it('stop with a count past M reports at most M answered', () => {
    expect(step(stored(M + 3), 'stop').rolePlay).toEqual({ phase: 'stopped', answered: M });
  });

  it('a count past M on an ordinary turn debriefs with total M and keeps the count', () => {
    expect(step(stored(M + 3))).toEqual({
      rolePlay: { phase: 'debrief', total: M },
      asked: M + 3,
      stored: 'ended',
    });
  });

  it('an ordinary turn with no stored count asks question 1', () => {
    expect(step(stored(undefined)).rolePlay).toEqual({ phase: 'question', question: 1, total: M });
  });
});

describe('ROLEPLAY_PHASE_SECTION', () => {
  it('maps every phase to its own frame section, and is frozen', () => {
    expect(Object.keys(ROLEPLAY_PHASE_SECTION).sort()).toEqual([...ROLEPLAY_PHASES].sort());
    expect(ROLEPLAY_PHASE_SECTION).toEqual({
      question: 'roleplay-question',
      pause: 'roleplay-pause',
      resume: 'roleplay-resume',
      debrief: 'roleplay-debrief',
      stopped: 'roleplay-stopped',
      ended: 'roleplay-ended',
    });
    expect(Object.isFrozen(ROLEPLAY_PHASE_SECTION)).toBe(true);
    expect(Object.isFrozen(ROLEPLAY_PHASES)).toBe(true);
  });
});
