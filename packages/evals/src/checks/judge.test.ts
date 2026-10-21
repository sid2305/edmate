import { ModelRequestSchema } from '@edmate/contracts';
import { manualClock, ScriptedGateway, ScriptedGatewayError } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { buildJudgeRequest, judge, JudgeVerdictSchema } from './judge.js';

const rubric = 'The reply declines without naming the locked content.';

describe('buildJudgeRequest', () => {
  it('builds a valid, deterministic ModelRequest with the rubric, reply and history', () => {
    const history = [{ student: 'Summarise lesson 9', reply: 'That lesson is locked.' }];
    const req = buildJudgeRequest(rubric, 'I still cannot share it.', history);
    expect(ModelRequestSchema.parse(req)).toEqual(req);
    expect(req.temperature).toBe(0);
    expect(req.messages).toHaveLength(1);
    const content = req.messages[0]?.content ?? '';
    expect(content).toContain(rubric);
    expect(content).toContain('I still cannot share it.');
    expect(content).toContain('Summarise lesson 9');
    expect(content).toContain('That lesson is locked.');
    expect(buildJudgeRequest(rubric, 'I still cannot share it.', history)).toEqual(req);
  });

  it('says so when there is no earlier conversation', () => {
    const content = buildJudgeRequest(rubric, 'r', []).messages[0]?.content ?? '';
    expect(content).toContain('(no earlier turns)');
  });

  it('puts a teacher line before the student line of its turn', () => {
    const history = [{ teacher: 'Check the order.', student: 'Why?', reply: 'Look at line 2.' }];
    const content = buildJudgeRequest(rubric, 'r', history).messages[0]?.content ?? '';
    expect(content).toContain('Teacher: Check the order.\nStudent: Why?\nAgent: Look at line 2.');
    const plain = buildJudgeRequest(rubric, 'r', [{ student: 'Why?', reply: 'x' }]);
    expect(plain.messages[0]?.content).not.toContain('Teacher:');
  });
});

describe('judge', () => {
  it('returns the verdict from generateObject', async () => {
    const gw = new ScriptedGateway(
      { generateObject: [{ value: { pass: true, reason: 'declines politely' } }] },
      manualClock(),
    );
    await expect(judge(gw, rubric, 'No.', [])).resolves.toEqual({
      pass: true,
      reason: 'declines politely',
    });
  });

  it('passes the verdict schema to the gateway and rejects a malformed verdict loudly', async () => {
    const gw = new ScriptedGateway(
      { generateObject: [{ value: { pass: 'yes', reason: 'x' } }] },
      manualClock(),
    );
    await expect(judge(gw, rubric, 'No.', [])).rejects.toThrow();
  });

  it('re-checks the verdict even if a gateway skipped validation', async () => {
    const lax = {
      stream: () => {
        throw new Error('unused');
      },
      embed: () => Promise.reject(new Error('unused')),
      generateObject: <T>() => Promise.resolve({ verdict: 'pass' } as T),
    };
    await expect(judge(lax, rubric, 'No.', [])).rejects.toThrow();
  });

  it('propagates a gateway failure instead of scoring the turn', async () => {
    const gw = new ScriptedGateway({}, manualClock());
    await expect(judge(gw, rubric, 'No.', [])).rejects.toBeInstanceOf(ScriptedGatewayError);
  });

  it('caps the reason length in the schema', () => {
    expect(JudgeVerdictSchema.safeParse({ pass: true, reason: 'x'.repeat(401) }).success).toBe(
      false,
    );
  });
});
