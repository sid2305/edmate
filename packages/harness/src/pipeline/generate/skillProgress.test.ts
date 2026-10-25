// Task 13.skillpresent: the harness-computed `skill` progress events for feedback and
// mock-interview, built from state the policy already derived, never a tool's `present()`.
import { LIMITS, type Skill } from '@edmate/contracts';
import { turnContextFull } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import type { RolePlay } from '../../pedagogy/roleplay.js';
import { feedbackSkillEvent, rolePlaySkillEvent } from './skillProgress.js';

const notEntitled = {
  ...turnContextFull,
  entitlement: { ...turnContextFull.entitlement, skills: [] as Skill[] },
};

describe('rolePlaySkillEvent', () => {
  it('no role-play this turn gives no event', () => {
    expect(rolePlaySkillEvent(undefined, turnContextFull)).toBeUndefined();
  });

  it.each<RolePlay>([
    { phase: 'question', question: 3, total: 6 },
    { phase: 'pause', question: 3, total: 6 },
    { phase: 'resume', question: 3, total: 6 },
    { phase: 'debrief', total: 6 },
    { phase: 'stopped', answered: 2 },
    { phase: 'ended' },
  ])('an entitled student gets the %o phase as its payload', (rolePlay) => {
    const ctx = {
      ...turnContextFull,
      entitlement: { ...turnContextFull.entitlement, skills: ['mock_interview'] as Skill[] },
    };
    expect(rolePlaySkillEvent(rolePlay, ctx)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: rolePlay,
    });
  });

  it('an un-entitled student (skill dropped mid-session) gets no event, never a throw', () => {
    const rolePlay: RolePlay = { phase: 'question', question: 1, total: 5 };
    expect(() => rolePlaySkillEvent(rolePlay, notEntitled)).not.toThrow();
    expect(rolePlaySkillEvent(rolePlay, notEntitled)).toBeUndefined();
  });

  it('an oversized payload is dropped, never a throw (mirrors skillEvent.test.ts)', () => {
    const ctx = {
      ...turnContextFull,
      entitlement: { ...turnContextFull.entitlement, skills: ['mock_interview'] as Skill[] },
    };
    const huge = 'x'.repeat(LIMITS.skillPayloadMaxJsonLength + 10);
    // RolePlay's real shape never carries free text, but the helper must still fail closed on
    // whatever `jsonSafe` is handed (defence in depth, same posture as skillEvent.ts).
    const oversized = { phase: 'ended', note: huge } as unknown as RolePlay;
    expect(() => rolePlaySkillEvent(oversized, ctx)).not.toThrow();
    expect(rolePlaySkillEvent(oversized, ctx)).toBeUndefined();
  });
});

describe('feedbackSkillEvent', () => {
  it('skill !== feedback gives no event', () => {
    expect(feedbackSkillEvent('coach', 'hint', turnContextFull)).toBeUndefined();
  });

  it('move !== hint gives no event, even on the feedback skill', () => {
    expect(feedbackSkillEvent('feedback', 'ask', turnContextFull)).toBeUndefined();
  });

  it('feedback + hint, entitled: a confirmed marker, no score, no text', () => {
    expect(feedbackSkillEvent('feedback', 'hint', turnContextFull)).toEqual({
      type: 'skill',
      skill: 'feedback',
      payload: { given: true },
    });
  });

  it('an un-entitled student gets no event, never a throw', () => {
    expect(() => feedbackSkillEvent('feedback', 'hint', notEntitled)).not.toThrow();
    expect(feedbackSkillEvent('feedback', 'hint', notEntitled)).toBeUndefined();
  });

  it('skill null or undefined gives no event', () => {
    expect(feedbackSkillEvent(null, 'hint', turnContextFull)).toBeUndefined();
    expect(feedbackSkillEvent(undefined, 'hint', turnContextFull)).toBeUndefined();
  });
});
