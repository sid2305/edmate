import { LIMITS, MessageSchema, type TurnInput } from '@edmate/contracts';
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
  memorySessionStateStore,
  memoryTraceSink,
  memoryTranscriptStore,
} from '../../testing/memoryPorts.js';
import { testDeps } from '../../testing/testSteps.js';
import type { CommitRecord, PipelineDeps, StepEnv } from '../types.js';
import { commit } from './commit.js';

const CANARY = 'CANARY-ANSWER-7f3a';

function world(o: { transcriptsFail?: boolean; stateFail?: boolean } = {}) {
  const transcripts = memoryTranscriptStore({ fail: o.transcriptsFail === true });
  const sessionState = memorySessionStateStore({ fail: o.stateFail === true });
  const traces = memoryTraceSink();
  const deps: PipelineDeps = {
    ...testDeps().deps,
    ids: sequentialIds(),
    transcripts,
    sessionState,
    traces,
  };
  const env: StepEnv = {
    input: demoTurnInput,
    deps,
    cancel: { cancelled: false, onCancel: () => undefined },
    turnId: 'turn_commit',
  };
  return { env, transcripts, sessionState, traces };
}

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
      help: { stuckTurns: 1, attemptLogged: true, pendingCheck: false, answerKey: [CANARY] },
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
            help: { stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [big] },
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
});
