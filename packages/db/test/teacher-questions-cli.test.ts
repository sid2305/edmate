// Task 5.10 Phase D: `db:questions` argument parsing, the answer file read and redacted
// failures. The repository is a fake; the Postgres run is test/ask-teacher-loop.int.test.ts.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTeacherQuestionsCli, type OpenTeacherQuestions } from '../src/cli.js';
import { RepositoryError, type AnswerResult, type TeacherQuestionGroup } from '../src/index.js';

const URL_WITH_PASSWORD = 'postgres://edmate:hunter2-secret@127.0.0.1:5432/edmate';

const GROUPS: TeacherQuestionGroup[] = [
  {
    groupId: 'tq_g1',
    count: 2,
    oldestAt: '2026-10-20T09:00:00.000Z',
    questions: [
      { id: 'tq_1', text: 'Why does the sky look blue?', createdAt: '2026-10-20T09:00:00.000Z' },
      { id: 'tq_2', text: 'Why is the sky so blue?', createdAt: '2026-10-20T09:05:00.000Z' },
    ],
  },
];

const ANSWER_RESULT: AnswerResult = {
  answered: 2,
  students: 2,
  threadMessages: 1,
  noteChunkId: 'chk_1',
  evalCaseId: 'evc_1',
};

function fakeOpen(
  listGroupsForTeacher?: (...a: unknown[]) => Promise<TeacherQuestionGroup[]>,
  answer?: (...a: unknown[]) => Promise<AnswerResult>,
) {
  const close = vi.fn(async () => undefined);
  const teacherQuestions = {
    listGroupsForTeacher: vi.fn(listGroupsForTeacher ?? (async () => GROUPS)),
    answer: vi.fn(answer ?? (async () => ANSWER_RESULT)),
  };
  const open: OpenTeacherQuestions = vi.fn(() => ({ teacherQuestions, close })) as never;
  return { open, teacherQuestions, close };
}

async function run(argv: string[], open: OpenTeacherQuestions, env = { DATABASE_URL: URL_WITH_PASSWORD }) {
  const lines: string[] = [];
  const code = await runTeacherQuestionsCli(argv, env, (l) => lines.push(l), open);
  return { code, out: lines.join('\n') };
}

describe('db:questions', () => {
  describe('list', () => {
    it("prints each group's id, count, oldest and its questions", async () => {
      const f = fakeOpen();
      const { code, out } = await run(['--', 'list', '--teacher', 'tch_1'], f.open);
      expect(code).toBe(0);
      expect(out).toBe(
        [
          'db:questions: group tq_g1 (2) oldest 2026-10-20T09:00:00.000Z',
          'db:questions:   tq_1 Why does the sky look blue?',
          'db:questions:   tq_2 Why is the sky so blue?',
        ].join('\n'),
      );
      expect(f.teacherQuestions.listGroupsForTeacher).toHaveBeenCalledWith(
        { teacherId: 'tch_1' },
        { limit: expect.any(Number) },
      );
    });

    it('prints a plain message when there are no open questions', async () => {
      const f = fakeOpen(async () => []);
      const { code, out } = await run(['list', '--teacher', 'tch_1'], f.open);
      expect(code).toBe(0);
      expect(out).toBe('db:questions: no open questions');
    });
  });

  describe('answer', () => {
    let dir: string;
    let answerFile: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'edmate-tq-'));
      answerFile = join(dir, 'answer.txt');
      await writeFile(answerFile, 'Air scatters blue light more than red light.', 'utf8');
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const GOOD = (file: string) => [
      'answer',
      '--teacher',
      'tch_1',
      '--question',
      'tq_1',
      '--module',
      'mod_1',
      '--answer-file',
      file,
    ];

    it('reads the answer file and prints counts only', async () => {
      const f = fakeOpen();
      const { code, out } = await run(GOOD(answerFile), f.open);
      expect(code).toBe(0);
      expect(out).toBe('db:questions: answered 2 question(s), 2 student(s), 1 message(s) sent');
      expect(f.teacherQuestions.answer).toHaveBeenCalledWith(
        { teacherId: 'tch_1' },
        {
          questionId: 'tq_1',
          moduleId: 'mod_1',
          answer: 'Air scatters blue light more than red light.',
        },
      );
    });

    it('passes --note-question through when given', async () => {
      const f = fakeOpen();
      await run([...GOOD(answerFile), '--note-question', 'Why is the sky blue?'], f.open);
      expect(f.teacherQuestions.answer).toHaveBeenCalledWith(
        { teacherId: 'tch_1' },
        expect.objectContaining({ noteQuestion: 'Why is the sky blue?' }),
      );
    });

    it('exits 1 with a fixed message, never opening the db, when the file cannot be read', async () => {
      const f = fakeOpen();
      const { code, out } = await run(GOOD(join(dir, 'missing.txt')), f.open);
      expect(code).toBe(1);
      expect(out).toBe('db:questions: could not read --answer-file');
      expect(f.open).not.toHaveBeenCalled();
    });

    it('a not_found from the repository is a fixed message, never driver text', async () => {
      const f = fakeOpen(undefined, async () => {
        throw new RepositoryError('not_found', 'teacherQuestions.answer');
      });
      const { code, out } = await run(GOOD(answerFile), f.open);
      expect(code).toBe(1);
      expect(out).toBe('db:questions: not found or already answered');
    });
  });

  it.each([
    ['no arguments', []],
    ['an unknown subcommand', ['dismiss', '--teacher', 'tch_1']],
    ['list with no --teacher', ['list']],
    ['answer missing --module', ['answer', '--teacher', 'tch_1', '--question', 'tq_1', '--answer-file', 'x']],
    ['an unknown flag', ['list', '--teacher', 'tch_1', '--force']],
    ['a positional', ['list', '--teacher', 'tch_1', 'extra']],
  ])('prints usage and exits 1 on %s, without opening the database', async (_l, argv) => {
    const f = fakeOpen();
    const { code, out } = await run(argv, f.open);
    expect(code).toBe(1);
    expect(out).toMatch(/^db:questions: usage: /);
    expect(f.open).not.toHaveBeenCalled();
  });

  it('needs DATABASE_URL', async () => {
    const f = fakeOpen();
    const { code, out } = await run(['list', '--teacher', 'tch_1'], f.open, { DATABASE_URL: '' });
    expect(code).toBe(1);
    expect(out).toBe('db:questions: DATABASE_URL is not set');
    expect(f.open).not.toHaveBeenCalled();
  });

  it('redacts a connection string in a failure and still closes', async () => {
    const f = fakeOpen(async () => {
      throw new Error(`connect failed for ${URL_WITH_PASSWORD}`);
    });
    const { code, out } = await run(['list', '--teacher', 'tch_1'], f.open);
    expect(code).toBe(1);
    expect(out).toBe('db:questions: failed: connect failed for postgres://<redacted>');
    expect(out).not.toContain('hunter2');
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('ignores a failing close', async () => {
    const f = fakeOpen();
    f.close.mockRejectedValueOnce(new Error('already closed'));
    expect((await run(['list', '--teacher', 'tch_1'], f.open)).code).toBe(0);
  });
});
