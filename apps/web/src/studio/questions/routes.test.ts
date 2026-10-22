// Task 8.9 Phase B: the questions inbox API's handlers over a fake backend (no real database;
// rule 4). The teacher always comes from the session's principal (`ctx.principal.userId`), never
// a body field.
import type { AnswerResult, Outline, TeacherQuestionGroup } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../../auth/guard';
import { StudioUnavailableError, type ServerLog } from '../routes';
import { createQuestionsHandlers, type QuestionsBackend } from './routes';

const ORIGIN = 'http://localhost:8080';
const ASHA: Principal = { userId: 't_asha', role: 'teacher' };

const GROUP: TeacherQuestionGroup = {
  groupId: 'g1',
  count: 2,
  oldestAt: '2026-10-01T00:00:00.000Z',
  questions: [
    { id: 'q1', text: 'How do ratios work?', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'q2', text: 'What is a ratio?', createdAt: '2026-10-02T00:00:00.000Z' },
  ],
};
const OUTLINE: Outline = {
  courseId: 'course_1',
  outlineVersion: 0,
  modules: [{ id: 'm1', title: 'Module 1', order: 0, topics: [] }],
};
const ANSWER_RESULT: AnswerResult = {
  answered: 2,
  students: 2,
  threadMessages: 2,
  noteChunkId: 'chunk_1',
  evalCaseId: 'eval_1',
};

function memoryBackend() {
  const logs: { event: string; fields?: Record<string, string> }[] = [];
  const backend: QuestionsBackend = {
    teacherQuestions: {
      listGroupsForTeacher: vi.fn(async () => [GROUP]),
      answer: vi.fn(async () => ANSWER_RESULT),
      dismiss: vi.fn(async () => undefined),
    },
    modules: {
      getOutline: vi.fn(async () => OUTLINE),
    },
    log: { error: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }) },
  };
  return { backend, logs };
}

function setup() {
  const mem = memoryBackend();
  const h = createQuestionsHandlers(async () => mem.backend, mem.backend.log);
  return { ...mem, h };
}

function ctx(principal: Principal, params: Record<string, string> = {}): RoleContext {
  return { principal, params: Promise.resolve(params) };
}

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }) as unknown as Parameters<ReturnType<typeof createQuestionsHandlers>['list']>[0];
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown> & {
    error?: { code: string; message: string; retryable: boolean };
  };
}

describe('GET /api/studio/questions', () => {
  it('returns the groups and the modules for the picker, scoped to the signed-in teacher', async () => {
    const s = setup();
    const res = await s.h.list(req('GET', '/api/studio/questions'), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ groups: [GROUP], modules: [{ id: 'm1', title: 'Module 1' }] });
    expect(s.backend.teacherQuestions.listGroupsForTeacher).toHaveBeenCalledWith(
      { teacherId: 't_asha' },
      { limit: 100 },
    );
    expect(s.backend.modules.getOutline).toHaveBeenCalledWith({ teacherId: 't_asha' });
  });

  it('a null outline (no course yet) is an empty module list, not a failure', async () => {
    const s = setup();
    vi.mocked(s.backend.modules.getOutline).mockResolvedValueOnce(null);
    const res = await s.h.list(req('GET', '/api/studio/questions'), ctx(ASHA));
    expect(res.status).toBe(200);
    expect((await json(res)).modules).toEqual([]);
  });

  it('a backend that cannot be built is 503, logged by reason only', async () => {
    const h = createQuestionsHandlers(
      async () => {
        throw new StudioUnavailableError('DATABASE_URL');
      },
      { error: vi.fn() } as ServerLog,
    );
    const res = await h.list(req('GET', '/api/studio/questions'), ctx(ASHA));
    expect(res.status).toBe(503);
    expect((await json(res)).error?.code).toBe('provider_error');
  });
});

describe('POST /api/studio/questions/answer', () => {
  it('answers the group by one of its question ids, returning counts only', async () => {
    const s = setup();
    const body = { questionId: 'q1', moduleId: 'm1', answer: 'It compares two quantities.' };
    const res = await s.h.answer(req('POST', '/api/studio/questions/answer', body), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(ANSWER_RESULT);
    expect(s.backend.teacherQuestions.answer).toHaveBeenCalledWith({ teacherId: 't_asha' }, body);
  });

  it('accepts an optional noteQuestion', async () => {
    const s = setup();
    const body = {
      questionId: 'q1',
      moduleId: 'm1',
      answer: 'It compares two quantities.',
      noteQuestion: 'What is a ratio, in general?',
    };
    const res = await s.h.answer(req('POST', '/api/studio/questions/answer', body), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(s.backend.teacherQuestions.answer).toHaveBeenCalledWith({ teacherId: 't_asha' }, body);
  });

  it('a non-matching body shape is 400, nothing written', async () => {
    const s = setup();
    const res = await s.h.answer(
      req('POST', '/api/studio/questions/answer', { questionId: 'q1', moduleId: 'm1' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
    expect(s.backend.teacherQuestions.answer).not.toHaveBeenCalled();
  });

  it('an empty answer is 400', async () => {
    const s = setup();
    const res = await s.h.answer(
      req('POST', '/api/studio/questions/answer', { questionId: 'q1', moduleId: 'm1', answer: '  ' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
  });

  it('an unknown field is 400 (strict body)', async () => {
    const s = setup();
    const res = await s.h.answer(
      req('POST', '/api/studio/questions/answer', {
        questionId: 'q1',
        moduleId: 'm1',
        answer: 'ok',
        studentId: 'leaked',
      }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
  });

  it('a body over the size cap is 413 before parsing', async () => {
    const s = setup();
    const res = await s.h.answer(
      req('POST', '/api/studio/questions/answer', { a: 'x'.repeat(20_000) }, {
        'content-length': String(20_010),
      }),
      ctx(ASHA),
    );
    expect(res.status).toBe(413);
    expect(s.backend.teacherQuestions.answer).not.toHaveBeenCalled();
  });

  it("a repository not_found (another teacher's or a missing question) is 404", async () => {
    const s = setup();
    vi.mocked(s.backend.teacherQuestions.answer).mockRejectedValueOnce(
      new RepositoryError('not_found', 'teacherQuestions.answer'),
    );
    const res = await s.h.answer(
      req('POST', '/api/studio/questions/answer', {
        questionId: 'q1',
        moduleId: 'm1',
        answer: 'ok',
      }),
      ctx(ASHA),
    );
    expect(res.status).toBe(404);
  });

  it('an unknown error is a logged 500, with the error name only (no question/answer text)', async () => {
    const s = setup();
    vi.mocked(s.backend.teacherQuestions.answer).mockRejectedValueOnce(new Error('db exploded'));
    const res = await s.h.answer(
      req('POST', '/api/studio/questions/answer', {
        questionId: 'q1',
        moduleId: 'm1',
        answer: 'a secret-ish answer text',
      }),
      ctx(ASHA),
    );
    expect(res.status).toBe(500);
    expect(s.logs).toEqual([{ event: 'questions.failed', fields: { error: 'Error' } }]);
    expect(JSON.stringify(s.logs)).not.toContain('secret-ish');
  });
});

describe('POST /api/studio/questions/dismiss', () => {
  it('dismisses one question and returns 204, no body', async () => {
    const s = setup();
    const res = await s.h.dismiss(
      req('POST', '/api/studio/questions/dismiss', { questionId: 'q2' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(s.backend.teacherQuestions.dismiss).toHaveBeenCalledWith({ teacherId: 't_asha' }, 'q2');
  });

  it('a non-matching body is 400', async () => {
    const s = setup();
    const res = await s.h.dismiss(req('POST', '/api/studio/questions/dismiss', {}), ctx(ASHA));
    expect(res.status).toBe(400);
    expect(s.backend.teacherQuestions.dismiss).not.toHaveBeenCalled();
  });

  it("a repository not_found (another teacher's, missing, or already-closed question) is 404", async () => {
    const s = setup();
    vi.mocked(s.backend.teacherQuestions.dismiss).mockRejectedValueOnce(
      new RepositoryError('not_found', 'teacherQuestions.dismiss'),
    );
    const res = await s.h.dismiss(
      req('POST', '/api/studio/questions/dismiss', { questionId: 'q1' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(404);
  });
});
