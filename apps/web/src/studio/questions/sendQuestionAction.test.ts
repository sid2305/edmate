// Task 8.9 Phase C: the questions inbox browser client. fetch is always injected (rule 4: no
// real network). Every failure (network, non-2xx, a 2xx with a malformed body) settles to a
// fixed error code, never a rejection (lessons: "a studio page that trusts a 200").
import { describe, expect, it, vi } from 'vitest';
import { answerGroup, dismissQuestion } from './sendQuestionAction';

type Call = [string, RequestInit];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ANSWER_RESULT = {
  answered: 2,
  students: 2,
  threadMessages: 2,
  noteChunkId: 'chk_1',
  evalCaseId: 'eval_1',
};

describe('answerGroup', () => {
  it('POSTs to the answer route and returns the counts', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i: RequestInit) => json(ANSWER_RESULT));
    await expect(
      answerGroup({ questionId: 'q_1', moduleId: 'mod_1', answer: 'It is a part of a whole.' }, fetchImpl),
    ).resolves.toEqual({ ok: true, answered: 2, students: 2 });
    const [url, init] = fetchImpl.mock.calls[0] as Call;
    expect(url).toBe('/api/studio/questions/answer');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      questionId: 'q_1',
      moduleId: 'mod_1',
      answer: 'It is a part of a whole.',
    });
  });

  it('maps a non-2xx to its error code', async () => {
    const fetchImpl = async () => json({ error: { code: 'not_found', message: 'x', retryable: false } }, 404);
    await expect(
      answerGroup({ questionId: 'q_1', moduleId: 'mod_1', answer: 'a' }, fetchImpl),
    ).resolves.toEqual({ ok: false, code: 'not_found', retryable: false });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new Error('offline'))],
    ['a 200 that is not JSON', async () => new Response('<html>', { status: 200 })],
    ['a 200 of the wrong shape', async () => json({ ok: true })],
  ])('%s is a retryable provider_error', async (_name, fetchImpl) => {
    await expect(
      answerGroup({ questionId: 'q_1', moduleId: 'mod_1', answer: 'a' }, fetchImpl),
    ).resolves.toEqual({ ok: false, code: 'provider_error', retryable: true });
  });
});

describe('dismissQuestion', () => {
  it('POSTs to the dismiss route and returns ok on a 204', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i: RequestInit) => new Response(null, { status: 204 }));
    await expect(dismissQuestion('q_1', fetchImpl)).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as Call;
    expect(url).toBe('/api/studio/questions/dismiss');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ questionId: 'q_1' });
  });

  it('maps a non-2xx to its error code', async () => {
    const fetchImpl = async () => json({ error: { code: 'not_found', message: 'x', retryable: false } }, 404);
    await expect(dismissQuestion('q_1', fetchImpl)).resolves.toEqual({
      ok: false,
      code: 'not_found',
      retryable: false,
    });
  });

  it('a network failure is a retryable provider_error', async () => {
    const fetchImpl = async () => Promise.reject(new Error('offline'));
    await expect(dismissQuestion('q_1', fetchImpl)).resolves.toEqual({
      ok: false,
      code: 'provider_error',
      retryable: true,
    });
  });
});
