// Task 9.4 Phase A (widened in 9.5a): what the browser may send for a turn. Strict: ids that the
// server owns (studentId from the session, sessionId from the path) are refused, never merged.
import { LIMITS, TurnInputSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { ClientTurnSchema, StartSessionSchema, toTurnInput } from './clientInput';

const ok = {
  agentId: 'agt_a',
  kind: 'message',
  text: 'What is a fraction?',
  lang: 'en',
  clientTs: '2026-10-20T10:00:00.000Z',
} as const;

describe('ClientTurnSchema', () => {
  it('accepts a message and a hint request', () => {
    expect(ClientTurnSchema.safeParse(ok).success).toBe(true);
    expect(ClientTurnSchema.safeParse({ ...ok, kind: 'hint_request' }).success).toBe(true);
    const noText: Record<string, unknown> = { ...ok };
    delete noText.text;
    expect(ClientTurnSchema.safeParse({ ...noText, kind: 'hint_request' }).success).toBe(true);
  });

  it('accepts a message tagged with a skill, and a check_answer carrying the typed answer', () => {
    expect(ClientTurnSchema.safeParse({ ...ok, skill: 'practice' }).success).toBe(true);
    expect(
      ClientTurnSchema.safeParse({ ...ok, kind: 'check_answer', skill: 'practice', text: '12' })
        .success,
    ).toBe(true);
  });

  it('accepts skill_action only with a skill named, and takes a JSON skillPayload', () => {
    const noText: Record<string, unknown> = { ...ok };
    delete noText.text;
    expect(
      ClientTurnSchema.safeParse({
        ...noText,
        kind: 'skill_action',
        skill: 'mock_interview',
        skillPayload: { persona: 'job-interview' },
      }).success,
    ).toBe(true);
    expect(ClientTurnSchema.safeParse({ ...noText, kind: 'skill_action' }).success).toBe(false);
  });

  it('rejects an oversize skillPayload', () => {
    expect(
      ClientTurnSchema.safeParse({
        ...ok,
        skill: 'practice',
        skillPayload: { big: 'x'.repeat(LIMITS.skillPayloadMaxJsonLength) },
      }).success,
    ).toBe(false);
  });

  it.each([
    ['studentId', { ...ok, studentId: 'stu_2' }],
    ['sessionId', { ...ok, sessionId: 'ses_2a' }],
    ['lang hi', { ...ok, lang: 'hi' }],
    ['empty text', { ...ok, text: '' }],
    ['blank text', { ...ok, text: '   \n ' }],
    ['message without text', { agentId: 'agt_a', kind: 'message', lang: 'en', clientTs: ok.clientTs }],
    ['oversize text', { ...ok, text: 'x'.repeat(LIMITS.turnTextMaxChars + 1) }],
    ['bad agent id', { ...ok, agentId: '../agt' }],
    ['bad clientTs', { ...ok, clientTs: 'yesterday' }],
    ['bad skill', { ...ok, skill: 'not-a-skill' }],
    ['not an object', 'hello'],
    ['null', null],
  ])('rejects %s', (_name, body) => {
    expect(ClientTurnSchema.safeParse(body).success).toBe(false);
  });

  it('accepts text at the contracts limit', () => {
    expect(
      ClientTurnSchema.safeParse({ ...ok, text: 'x'.repeat(LIMITS.turnTextMaxChars) }).success,
    ).toBe(true);
  });
});

describe('toTurnInput', () => {
  it('adds the server-owned ids and passes the contracts schema', () => {
    const input = toTurnInput(ClientTurnSchema.parse(ok), {
      studentId: 'stu_1',
      sessionId: 'ses_1a',
    });
    expect(input).toEqual({ ...ok, studentId: 'stu_1', sessionId: 'ses_1a' });
    expect(TurnInputSchema.safeParse(input).success).toBe(true);
  });

  it('returns null when the server ids fail the contracts schema', () => {
    expect(toTurnInput(ClientTurnSchema.parse(ok), { studentId: '', sessionId: 'x' })).toBeNull();
  });
});

describe('StartSessionSchema', () => {
  it('takes only an agent id', () => {
    expect(StartSessionSchema.safeParse({ agentId: 'agt_a' }).success).toBe(true);
    expect(StartSessionSchema.safeParse({ agentId: 'agt_a', studentId: 'stu_2' }).success).toBe(
      false,
    );
    expect(StartSessionSchema.safeParse({}).success).toBe(false);
  });
});
