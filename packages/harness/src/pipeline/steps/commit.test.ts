import { LIMITS, MessageSchema, type EvidenceEvent, type TurnInput } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoPedagogyDecision,
  demoStyleCard,
  demoTurnInput,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../../testing/ids.js';
import {
  memoryProfileStore,
  memorySessionStateStore,
  memoryTeacherQuestionStore,
  memoryTraceSink,
  memoryTranscriptStore,
} from '../../testing/memoryPorts.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import type { CommitRecord, PipelineDeps, StepEnv } from '../types.js';
import { commit } from './commit.js';

const CANARY = 'CANARY-ANSWER-7f3a';

function world(
  o: {
    transcriptsFail?: boolean;
    stateFail?: boolean;
    profilesFail?: boolean;
    teacherQuestionsFail?: boolean;
  } = {},
) {
  const transcripts = memoryTranscriptStore({ fail: o.transcriptsFail === true });
  const sessionState = memorySessionStateStore({ fail: o.stateFail === true });
  const traces = memoryTraceSink();
  const profiles = memoryProfileStore({ fail: o.profilesFail === true });
  const teacherQuestions = memoryTeacherQuestionStore({ fail: o.teacherQuestionsFail === true });
  const deps: PipelineDeps = {
    ...testDeps().deps,
    ids: sequentialIds(),
    transcripts,
    sessionState,
    traces,
    profiles,
    teacherQuestions,
  };
  const env: StepEnv = {
    input: demoTurnInput,
    deps,
    cancel: { cancelled: false, onCancel: () => undefined },
    turnId: 'turn_commit',
    ...stepEnvExtras(),
  };
  return { env, transcripts, sessionState, traces, profiles, teacherQuestions };
}

const evidenceEvent = (o: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
  studentId: demoEntitlementSubscription.studentId,
  teacherId: demoEntitlementSubscription.teacherId,
  topicId: 'top_fractions',
  correct: true,
  source: 'practice',
  weight: 1,
  ts: '2026-10-19T10:00:00.000Z',
  ...o,
});

function record(o: Partial<CommitRecord> = {}): CommitRecord {
  return {
    turnId: 'turn_commit',
    sessionId: 'ses_test_01',
    messageId: 'msg_reply',
    receivedAt: '2026-10-18T10:00:00.000Z',
    createdAt: '2026-10-18T10:00:02.000Z',
    entitled: {
      entitlement: demoEntitlementSubscription,
      agent: demoAgentConfig,
      pkg: demoPackagePaid,
      locale: demoLocalePack,
      styleCard: demoStyleCard,
      helpState: { v: 1, rung: 1, answerKey: [CANARY] },
    },
    input: { ...demoTurnInput, text: 'How do I add [number] and 1/3?' },
    outcome: 'replied',
    intent: 'on_task',
    decision: {
      ...demoPedagogyDecision,
      systemPrompt: `system ${CANARY}`,
      mustNotReveal: [CANARY],
    },
    next: {
      rung: 2,
      help: { stuckTurns: 1, attemptLogged: true, pendingCheck: false, answerKey: [CANARY], lockedStopped: false },
    },
    replyText: 'What do you notice about the denominators?',
    ...o,
  };
}

describe('commit', () => {
  it('appends the scrubbed student message, then the reply, then saves the help state', async () => {
    const w = world();
    await commit(w.env, record());
    expect(w.transcripts.appended).toEqual([
      {
        sessionId: 'ses_test_01',
        message: {
          id: 'message_1',
          role: 'student',
          text: 'How do I add [number] and 1/3?',
          createdAt: '2026-10-18T10:00:00.000Z',
        },
      },
      {
        sessionId: 'ses_test_01',
        message: {
          id: 'msg_reply',
          role: 'agent',
          text: 'What do you notice about the denominators?',
          createdAt: '2026-10-18T10:00:02.000Z',
        },
      },
    ]);
    for (const a of w.transcripts.appended) {
      expect(MessageSchema.parse(a.message)).toEqual(a.message);
    }
    expect(w.sessionState.saved).toEqual([
      {
        sessionId: 'ses_test_01',
        helpState: {
          v: 1,
          rung: 2,
          stuckTurns: 1,
          attemptLogged: true,
          pendingCheck: false,
          answerKey: [CANARY],
          lockedStopped: false,
        },
      },
    ]);
  });

  it('the answer key, system prompt and do-not-say list reach only saveHelpState', async () => {
    const w = world();
    await commit(w.env, record());
    expect(JSON.stringify(w.transcripts.appended)).not.toContain(CANARY);
    expect(JSON.stringify(w.traces.records)).not.toContain(CANARY);
    expect(JSON.stringify(w.sessionState.saved)).toContain(CANARY);
  });

  it('a failed scrub (input null) still appends the reply to the right session', async () => {
    const w = world();
    await commit(
      w.env,
      record({
        input: null,
        outcome: 'escalated',
        sessionId: 'ses_escalated',
        replyText: 'You are not alone. Call 1800.',
      }),
    );
    expect(w.transcripts.appended).toEqual([
      {
        sessionId: 'ses_escalated',
        message: {
          id: 'msg_reply',
          role: 'agent',
          text: 'You are not alone. Call 1800.',
          createdAt: '2026-10-18T10:00:02.000Z',
        },
      },
    ]);
  });

  it('writes no student message without text, no reply without replyText, no state without next', async () => {
    const w = world();
    const rest = record();
    delete rest.replyText;
    delete rest.next;
    const input: TurnInput = { ...demoTurnInput };
    delete input.text;
    await commit(w.env, { ...rest, input, outcome: 'blocked' });
    expect(w.transcripts.appended).toEqual([]);
    expect(w.sessionState.saved).toEqual([]);
  });

  it('a help state over LIMITS.helpStateMaxJsonLength fails the step and is never saved', async () => {
    const w = world();
    const big = 'x'.repeat(LIMITS.helpStateMaxJsonLength);
    await expect(
      commit(
        w.env,
        record({
          next: {
            rung: 0,
            help: { stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [big], lockedStopped: false },
          },
        }),
      ),
    ).rejects.toThrow(RangeError);
    expect(w.sessionState.saved).toEqual([]);
    // The messages are kept: a bad help state is a bug, not a reason to lose the transcript.
    expect(w.transcripts.appended).toHaveLength(2);
  });

  it('a failing transcript or state port fails the step', async () => {
    await expect(commit(world({ transcriptsFail: true }).env, record())).rejects.toThrow('down');
    await expect(commit(world({ stateFail: true }).env, record())).rejects.toThrow('down');
  });

  // Task 3.17: evidence and the TeacherQuestion fallback.
  it('calls applyEvidence only when there is evidence', async () => {
    const w = world();
    await commit(w.env, record());
    expect(w.profiles.applied).toEqual([]);

    const events = [evidenceEvent(), evidenceEvent({ topicId: 'top_other', correct: false })];
    await commit(w.env, record({ evidence: events }));
    expect(w.profiles.applied).toEqual(events);
  });

  it('never calls applyEvidence for an empty evidence array', async () => {
    const w = world();
    await commit(w.env, record({ evidence: [] }));
    expect(w.profiles.applied).toEqual([]);
  });

  it('opens a TeacherQuestion as a fallback only when the move is ask_teacher and no id is set', async () => {
    const w = world();
    await commit(
      w.env,
      record({
        decision: { ...demoPedagogyDecision, move: 'ask_teacher' },
      }),
    );
    expect(w.teacherQuestions.opened).toHaveLength(1);
    expect(w.teacherQuestions.opened[0]).toMatchObject({
      teacherId: demoEntitlementSubscription.teacherId,
      agentId: demoEntitlementSubscription.agentId,
      studentId: demoEntitlementSubscription.studentId,
      text: 'How do I add [number] and 1/3?',
    });
  });

  it('never opens a second question when the live attempt already set teacherQuestionId', async () => {
    const w = world();
    await commit(
      w.env,
      record({
        decision: { ...demoPedagogyDecision, move: 'ask_teacher' },
        teacherQuestionId: 'tq_live_01',
      }),
    );
    expect(w.teacherQuestions.opened).toEqual([]);
  });

  it('opens the fallback question for a turn grounding escalated (4.7), once, never with an id set', async () => {
    const w = world();
    await commit(w.env, record({ decision: demoPedagogyDecision, escalateToTeacher: true }));
    expect(w.teacherQuestions.opened).toHaveLength(1);
    expect(w.teacherQuestions.opened[0]?.text).toBe('How do I add [number] and 1/3?');
    const live = world();
    await commit(
      live.env,
      record({
        decision: demoPedagogyDecision,
        escalateToTeacher: true,
        teacherQuestionId: 'tq_live_01',
      }),
    );
    expect(live.teacherQuestions.opened).toEqual([]);
    const notEscalated = world();
    await commit(
      notEscalated.env,
      record({ decision: demoPedagogyDecision, escalateToTeacher: false }),
    );
    expect(notEscalated.teacherQuestions.opened).toEqual([]);
  });

  it('counts a grounding fallback open only when it succeeds, before saving the help state (fix round 1)', async () => {
    const help = {
      stuckTurns: 0 as const,
      attemptLogged: false,
      pendingCheck: false,
      answerKey: [],
    };
    const w = world();
    await commit(
      w.env,
      record({
        decision: demoPedagogyDecision,
        escalateToTeacher: true,
        next: { rung: 0, help: { ...help, groundingAsks: 1 } },
      }),
    );
    expect(w.sessionState.saved.at(-1)?.helpState).toMatchObject({ groundingAsks: 2 });
    // No help state to save: the open still happens.
    const bare = world();
    const { next: _drop, ...noNext } = record({ escalateToTeacher: true });
    void _drop;
    await commit(bare.env, { ...noNext, decision: demoPedagogyDecision });
    expect(bare.teacherQuestions.opened).toHaveLength(1);
  });

  it('a failed grounding fallback open: everything else saved, count unchanged, then GroundingEscalationLost (fix round 1)', async () => {
    const help = {
      stuckTurns: 0 as const,
      attemptLogged: false,
      pendingCheck: false,
      answerKey: [],
    };
    const w = world({ teacherQuestionsFail: true });
    await expect(
      commit(
        w.env,
        record({
          decision: demoPedagogyDecision,
          escalateToTeacher: true,
          next: { rung: 0, help },
        }),
      ),
    ).rejects.toThrow('grounding escalation lost: no TeacherQuestion opened (Error)');
    expect(w.transcripts.appended).toHaveLength(2);
    expect(w.sessionState.saved).toHaveLength(1);
    expect(w.sessionState.saved[0]?.helpState).not.toHaveProperty('groundingAsks');
  });

  it('never opens a question for any other move, even with no id set', async () => {
    const w = world();
    await commit(w.env, record({ decision: demoPedagogyDecision }));
    expect(w.teacherQuestions.opened).toEqual([]);
  });

  it('opens no question when the turn had no text (ask_teacher with input null)', async () => {
    const w = world();
    await commit(
      w.env,
      record({
        decision: { ...demoPedagogyDecision, move: 'ask_teacher' },
        input: null,
        outcome: 'escalated',
      }),
    );
    expect(w.teacherQuestions.opened).toEqual([]);
  });

  it('a failing applyEvidence or TeacherQuestion open fails the step', async () => {
    await expect(
      commit(world().env, record({ evidence: [evidenceEvent()] })),
    ).resolves.toBeUndefined();
    await expect(
      commit(world({ profilesFail: true }).env, record({ evidence: [evidenceEvent()] })),
    ).rejects.toThrow('down');
    await expect(
      commit(
        world({ teacherQuestionsFail: true }).env,
        record({ decision: { ...demoPedagogyDecision, move: 'ask_teacher' } }),
      ),
    ).rejects.toThrow('down');
  });

  it('the answer key and locked text never reach evidence or the TeacherQuestion', async () => {
    const w = world();
    await commit(
      w.env,
      record({
        decision: { ...demoPedagogyDecision, move: 'ask_teacher', mustNotReveal: [CANARY] },
        evidence: [evidenceEvent()],
      }),
    );
    expect(JSON.stringify(w.profiles.applied)).not.toContain(CANARY);
    expect(JSON.stringify(w.teacherQuestions.opened)).not.toContain(CANARY);
  });
});
