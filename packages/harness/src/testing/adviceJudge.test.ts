// The non-circular fake advice judge (task 4.8): its verdict follows from the reply it is sent.
import type { ModelChunk, ModelGateway, ModelRequest } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { ADVICE_JUDGE_SYSTEM, adviceJudgeRequest } from '../guardrails/adviceGuard.js';
import {
  ADVICE_VERDICT,
  adviceJudgeGateway,
  CLEAN_ADVICE_VERDICT,
  hasAdviceMarker,
  markerJudge,
  readAdviceJudgeRequest,
} from './adviceJudge.js';
import { virtualClock } from './virtualClock.js';

const judgeReq = (reply: string, studentText = 'Should I?'): ModelRequest => {
  const r = adviceJudgeRequest({ reply, studentText });
  return {
    tier: 'small',
    system: r.system,
    messages: [{ role: 'user', content: r.user }],
    maxOutputTokens: 20,
  };
};

async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const out: ModelChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

function innerGateway(): ModelGateway & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    stream(req) {
      calls.push(`stream:${req.system ?? ''}`);
      return (async function* (): AsyncGenerator<ModelChunk> {
        yield { type: 'text', text: 'inner' };
      })();
    },
    generateObject() {
      calls.push('generateObject');
      return Promise.reject(new Error('inner generateObject'));
    },
    embed(texts) {
      calls.push(`embed:${String(texts.length)}`);
      return Promise.resolve([]);
    },
  } as ModelGateway & { calls: string[] };
}

describe('hasAdviceMarker / markerJudge', () => {
  it('flags personal advice in English, romanised Hindi and Devanagari', () => {
    for (const reply of [
      'You should buy that fund.',
      'Take 500mg now.',
      'As your doctor, rest.',
      'Haan loan le lo.',
      'Yeh clause valid hai.',
      'हां डाल दो।',
      'Haan sue karo.',
      'मुकदमा करो।',
      'Nifty BeES mein daal ke bhool jao.',
    ]) {
      expect(hasAdviceMarker(reply), reply).toBe(true);
    }
  });

  it('passes refusals, referrals and concept teaching', () => {
    for (const reply of [
      "I can't tell you which stock to buy; a qualified adviser can.",
      'Diversification spreads risk across many holdings.',
      'Please talk to a doctor or pharmacist.',
      // A coding instruction in romanised Hindi is not personal advice (4.8 fix round 1).
      'File padhne ke liye with open("notes.txt") as f: likho aur phir f.read() use karo.',
      'मैं फ़ाइल खोलना सिखाता हूँ: पहले कोड रन करो।',
      '',
    ]) {
      expect(hasAdviceMarker(reply), reply).toBe(false);
    }
  });

  it('reads only the reply, never the student’s message', () => {
    expect(
      markerJudge({ studentText: 'you should buy', reply: 'Concepts only.' }, judgeReq('')),
    ).toBe(CLEAN_ADVICE_VERDICT);
    expect(markerJudge({ studentText: '', reply: 'You should sell it.' }, judgeReq(''))).toBe(
      ADVICE_VERDICT,
    );
  });
});

describe('readAdviceJudgeRequest', () => {
  it('reads the student’s message and the reply back from their fenced blocks', () => {
    expect(readAdviceJudgeRequest(judgeReq('The reply.', 'The question?'))).toEqual({
      studentText: 'The question?',
      reply: 'The reply.',
    });
  });

  it('a request with no blocks or no text reads as empty', () => {
    const req: ModelRequest = {
      tier: 'small',
      system: ADVICE_JUDGE_SYSTEM,
      messages: [],
      maxOutputTokens: 20,
    };
    expect(readAdviceJudgeRequest(req)).toEqual({ studentText: '', reply: '' });
  });
});

describe('adviceJudgeGateway', () => {
  it('answers advice judge requests with the verdict and a usage chunk, recording each', async () => {
    const inner = innerGateway();
    const g = adviceJudgeGateway(inner, markerJudge);
    const chunks = await collect(g.stream(judgeReq('You should buy it.')));
    expect(chunks[0]).toEqual({ type: 'text', text: ADVICE_VERDICT });
    expect(chunks[1]?.type).toBe('usage');
    expect(g.adviceJudged).toHaveLength(1);
    expect(inner.calls).toEqual([]);
  });

  it('sends every other request, object call and embedding to the inner gateway', async () => {
    const inner = innerGateway();
    const g = adviceJudgeGateway(inner, markerJudge);
    const other: ModelRequest = {
      tier: 'small',
      system: 'other',
      messages: [],
      maxOutputTokens: 20,
    };
    expect(await collect(g.stream(other))).toEqual([{ type: 'text', text: 'inner' }]);
    await expect(g.generateObject(other, {} as never)).rejects.toThrow('inner generateObject');
    await g.embed(['a', 'b']);
    expect(inner.calls).toEqual(['stream:other', 'generateObject', 'embed:2']);
    expect(g.adviceJudged).toEqual([]);
  });

  it('waits the given delay on the clock before answering', async () => {
    const clock = virtualClock();
    const g = adviceJudgeGateway(innerGateway(), () => CLEAN_ADVICE_VERDICT, {
      clock,
      delayMs: 450,
    });
    const started = clock.now();
    const done = collect(g.stream(judgeReq('Concepts.')));
    await clock.advance(450);
    expect((await done)[0]).toEqual({ type: 'text', text: CLEAN_ADVICE_VERDICT });
    expect(clock.now() - started).toBe(450);
  });
});
