import { type Message, ModelRequestSchema } from '@edmate/contracts';
import { demoPedagogyDecision, messageAgent, messageStudent } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { fixturePromptPackSet as set } from '../testing/promptPackFixtures.js';
import { buildModelRequest, promptCacheKey } from './modelRequest.js';
import { ctxWith } from './testing.js';

const messageTeacher: Message = {
  id: 'msg_test_03',
  role: 'teacher',
  text: 'Good question. Try listing multiples of 2 and 3.',
  createdAt: '2026-10-17T11:00:00Z',
};

describe('buildModelRequest', () => {
  const ctx = ctxWith({ history: [messageStudent, messageAgent, messageTeacher] });

  it('uses the decision prompt and budget, maps history and ends with the student input', () => {
    const r = buildModelRequest({
      ctx,
      decision: demoPedagogyDecision,
      input: { kind: 'message', text: 'And 1/4?' },
      set,
    });
    expect(ModelRequestSchema.parse(r)).toEqual(r);
    expect(r).toEqual({
      tier: 'main',
      system: demoPedagogyDecision.systemPrompt,
      messages: [
        { role: 'user', content: messageStudent.text },
        { role: 'assistant', content: messageAgent.text },
        { role: 'assistant', content: `${set.frame['teacher-label']}\n${messageTeacher.text}` },
        { role: 'user', content: 'And 1/4?' },
      ],
      maxOutputTokens: demoPedagogyDecision.maxOutputTokens,
      cacheKey: 'agt_test_01:3:pkg_test_paid:2:1.0.0:1',
    });
  });

  it('a turn with no text (a hint request) gets the frame empty-turn line', () => {
    for (const text of [undefined, '  ']) {
      const r = buildModelRequest({
        ctx,
        decision: demoPedagogyDecision,
        input: text === undefined ? { kind: 'hint_request' } : { kind: 'hint_request', text },
        set,
      });
      expect(r.messages.at(-1)).toEqual({
        role: 'user',
        content: '[[EMPTY-TURN]] The student sent a hint_request with no text.',
      });
    }
  });

  it('the cache key changes with the package version and holds no student id', () => {
    const a = promptCacheKey(ctx);
    const b = promptCacheKey(ctxWith({ pkg: { version: 3 }, entitlement: { packageVersion: 3 } }));
    expect(a).not.toBe(b);
    expect(a).not.toContain(ctx.entitlement.studentId);
    expect(a).not.toContain(ctx.profile.studentId);
  });
});
