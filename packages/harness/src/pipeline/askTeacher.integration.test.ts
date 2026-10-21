// Task 5.10 acceptance, on memory ports (the Postgres run is packages/db's ask-teacher-loop test):
// an uncovered question goes to the teacher; the teacher's answer becomes a teacher note through
// the CorrectionStore; the next similar question is answered from that note and cites it. The real
// admit, entitle, buildContext, decide and generate steps run over memoryRetrieval, with the
// scripted gateway (no model call). preGuard, route, postGuard, meter and commit are test doubles.
import {
  type EntitlementStore,
  type ModelChunk,
  type TurnConfigStore,
  type TurnEvent,
  TurnEventSchema,
  type TurnInput,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLearnerProfile,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveTurn } from '../testing/driveTurn.js';
import {
  memoryCorrectionStore,
  memoryTeacherQuestionStore,
  memoryTranscriptStore,
} from '../testing/memoryPorts.js';
import { memoryRetrieval, retrievalWorld } from '../testing/memoryRetrieval.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { StreamStep } from '../testing/scriptedGateway.js';
import { testDeps, testSteps } from '../testing/testSteps.js';
import { virtualClock } from '../testing/virtualClock.js';
import { runTurn } from './runner.js';
import { admit } from './steps/admit.js';
import { buildContext } from './steps/buildContext.js';
import { decide } from './steps/decide.js';
import { entitle } from './steps/entitle.js';
import { generate } from './steps/generate.js';
import { teacherNoteSource } from './teacherNote.js';

// Synthetic questions, outside the demo world's material (fractions) and its locked module.
const FIRST = 'Why does the sky look blue at noon?';
const SIMILAR = 'Why does the sky look so blue?';
const ANSWER = 'Air scatters short blue wavelengths more than long red ones.';
const ANSWERED_AT = Date.UTC(2026, 9, 21, 9, 30);
const NOTE_SOURCE = teacherNoteSource('teacher_answer', ANSWERED_AT);

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const reply = (text: string): StreamStep[] => [say(text), used];

function world() {
  const clock = virtualClock();
  const retrieval = memoryRetrieval({ chunks: retrievalWorld() });
  const questions = memoryTeacherQuestionStore();
  const corrections = memoryCorrectionStore({
    retrieval,
    clock: { now: () => ANSWERED_AT },
    moduleOwners: {
      mod_test_01: 'tch_test_01',
      mod_test_02: 'tch_test_01',
      mod_test_04: 'tch_test_01',
      mod_test_09: 'tch_test_02',
    },
  });
  const entitlements: EntitlementStore = {
    resolve: (x) =>
      Promise.resolve(
        x.studentId === demoEntitlementSubscription.studentId &&
          x.agentId === demoEntitlementSubscription.agentId
          ? { ...demoEntitlementSubscription }
          : null,
      ),
  };
  const turnConfig: TurnConfigStore = {
    load: () =>
      Promise.resolve({
        agent: {
          ...demoAgentConfig,
          languages: ['en'],
          promptPackVersion: FIXTURE_PROMPT_PACK_VERSION,
        },
        pkg: demoPackagePaid,
        styleCard: demoStyleCard,
        locale: demoLocalePack,
        helpState: null,
      }),
  };
  const t = testDeps({
    clock,
    script: {
      stream: [
        { steps: reply('That is a good one for your teacher. I have sent it on.') },
        { steps: reply('Air scatters blue light the most [1]. What colour scatters least?') },
      ],
    },
    overrides: {
      entitlements,
      turnConfig,
      retrieval,
      teacherQuestions: questions,
      profiles: {
        get: () => Promise.resolve(demoLearnerProfile),
        applyEvidence: () => Promise.reject(new Error('unused')),
      },
      transcripts: memoryTranscriptStore(),
    },
  });
  const steps = testSteps({ admit, entitle, buildContext, decide, generate });
  const run = async (text: string, n: number) => {
    const input: TurnInput = {
      ...demoTurnInput,
      sessionId: `ses_loop_${n}`,
      text,
      clientTs: `2026-10-21T10:0${n}:00Z`,
    };
    const { events } = await driveTurn(runTurn(input, { deps: t.deps, steps }), clock);
    for (const e of events) expect(TurnEventSchema.safeParse(e).success).toBe(true);
    return { events, decision: steps.commits.at(-1)?.decision };
  };
  return { retrieval, questions, corrections, run };
}

const of = <T extends TurnEvent['type']>(events: TurnEvent[], type: T) =>
  events.filter((e): e is Extract<TurnEvent, { type: T }> => e.type === type);

describe('ask the teacher, end to end on memory ports (5.10 acceptance)', () => {
  it("an uncovered question is answered by the teacher; the next similar one is answered from the teacher's note, citing it", async () => {
    const w = world();

    // 1. Nothing allowed covers the question: ask_teacher, and the question goes to the teacher.
    const first = await w.run(FIRST, 1);
    expect(first.decision?.move).toBe('ask_teacher');
    expect(of(first.events, 'teacher_question')).toEqual([
      { type: 'teacher_question', questionId: 'tq_mem_1' },
    ]);
    expect(first.events.at(-1)?.type).toBe('done');
    expect(w.questions.opened).toHaveLength(1);
    expect(w.questions.opened[0]).toMatchObject({
      teacherId: 'tch_test_01',
      agentId: 'agt_test_01',
      studentId: 'stu_test_01',
      text: FIRST,
    });

    // 2. The teacher answers it into one of their modules in the student's package.
    const note = await w.corrections.addTeacherNote({
      teacherId: 'tch_test_01',
      moduleId: 'mod_test_02',
      question: w.questions.opened[0]?.text ?? '',
      answer: ANSWER,
      origin: 'teacher_answer',
    });
    expect(note).toEqual({ chunkId: 'chk_note_1', evalCaseId: 'evc_mem_1' });
    expect(w.corrections.cases).toHaveLength(1);

    // 3. A similar question is now covered by the note: taught, not sent to the teacher again.
    const second = await w.run(SIMILAR, 2);
    expect(second.decision?.move).not.toBe('ask_teacher');
    expect(second.decision?.move).not.toBe('locked');
    expect(of(second.events, 'teacher_question')).toEqual([]);
    expect(w.questions.opened).toHaveLength(1);
    expect(second.events.at(-1)?.type).toBe('done');

    // The note was retrieved first, and the reply's [1] cites it as the teacher's answer.
    const search = await w.retrieval.search(
      SIMILAR,
      { teacherId: 'tch_test_01', allowedModuleIds: ['mod_test_01', 'mod_test_02', 'mod_test_03'] },
      5,
    );
    expect(search[0]?.id).toBe('chk_note_1');
    expect(search[0]?.score).toBeGreaterThanOrEqual(0.5);
    const [sources] = of(second.events, 'sources');
    expect(sources?.items[0]).toEqual({
      title: "Teacher's answer",
      locator: '2026-10-21',
      kind: 'teacher_note',
    });
    expect(sources?.items[0]).toEqual(NOTE_SOURCE);
    // No student text in the citation.
    expect(JSON.stringify(sources)).not.toContain('sky');
  }, 15_000);

  it("a note filed in a module outside the student's package is never used to teach", async () => {
    const w = world();
    // mod_test_04 is the teacher's, but locked for this package.
    await w.corrections.addTeacherNote({
      teacherId: 'tch_test_01',
      moduleId: 'mod_test_04',
      question: FIRST,
      answer: ANSWER,
      origin: 'teacher_answer',
    });
    const turn = await w.run(SIMILAR, 1);
    expect(turn.decision?.move).toBe('locked');
    expect(JSON.stringify(turn.events)).not.toContain("Teacher's answer");
    expect(JSON.stringify(turn.events)).not.toContain('scatters short');
  }, 15_000);

  it("another teacher's module is refused, and the question still goes to the teacher", async () => {
    const w = world();
    await expect(
      w.corrections.addTeacherNote({
        teacherId: 'tch_test_01',
        moduleId: 'mod_test_09',
        question: FIRST,
        answer: ANSWER,
        origin: 'teacher_answer',
      }),
    ).rejects.toThrow('not_found');
    const first = await w.run(FIRST, 1);
    expect(first.decision?.move).toBe('ask_teacher');
    expect(of(first.events, 'teacher_question')).toHaveLength(1);
  }, 15_000);
});
