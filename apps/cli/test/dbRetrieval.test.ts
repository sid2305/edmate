// Unit test for a 3.9f fix-round finding (HIGH, typescript-reviewer): `buildDbRetrieval` must not
// leak the pool `openDatabase` opens when `repos.documents.listForTeacher` (the read) or
// `seedChatChunks` (the seed) throws. Uses the injectable `open` seam added for this test so the
// real `openDatabase`/Postgres pool is never touched (rule 4: no real db call in a unit test --
// the db-backed path already has its own integration coverage in chatDbRetrieval.int.test.ts).
import type { DemoTeacherContent } from '@edmate/content';
import type { Repositories } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/commands/chat/gateway.js';
import { buildDbRetrieval } from '../src/commands/chat/dbRetrieval.js';

function fakeOpen(repos: Partial<Repositories>, close: () => Promise<void>) {
  return (_env: Env) => ({ repos: repos as Repositories, close });
}

const env: Env = {};
const TEACHER_ID = 'teacher_1';
const emptyContent = { course: { modules: [] }, notes: new Map() } as unknown as DemoTeacherContent;

describe('buildDbRetrieval (3.9f fix round)', () => {
  it('closes the pool once and rethrows when the read throws', async () => {
    const close = vi.fn(async () => undefined);
    const readError = new Error('read failed');
    const repos: Partial<Repositories> = {
      documents: {
        listForTeacher: vi.fn(async () => {
          throw readError;
        }),
      } as unknown as Repositories['documents'],
    };

    await expect(
      buildDbRetrieval(env, TEACHER_ID, emptyContent, fakeOpen(repos, close)),
    ).rejects.toBe(readError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the pool once and rethrows when the seed throws', async () => {
    const close = vi.fn(async () => undefined);
    const seedError = new Error('seed failed');
    const content = {
      course: { modules: [{ id: 'm1', title: 'Module 1' }] },
      notes: new Map([['m1', '# Module 1\n\nSome text.']]),
    } as unknown as DemoTeacherContent;
    const repos: Partial<Repositories> = {
      documents: {
        listForTeacher: vi.fn(async () => []),
        create: vi.fn(async () => {
          throw seedError;
        }),
      } as unknown as Repositories['documents'],
    };

    await expect(buildDbRetrieval(env, TEACHER_ID, content, fakeOpen(repos, close))).rejects.toBe(
      seedError,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('swallows a close failure and still rethrows the original error', async () => {
    const closeError = new Error('close failed');
    const close = vi.fn(async () => {
      throw closeError;
    });
    const readError = new Error('read failed');
    const repos: Partial<Repositories> = {
      documents: {
        listForTeacher: vi.fn(async () => {
          throw readError;
        }),
      } as unknown as Repositories['documents'],
    };

    await expect(
      buildDbRetrieval(env, TEACHER_ID, emptyContent, fakeOpen(repos, close)),
    ).rejects.toBe(readError);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
