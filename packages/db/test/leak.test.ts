// Unit (no database): a driver failure never carries ids or student text out of a repository.
// Drizzle's own error message is "Failed query: <sql> params: <values>", so an unscrubbed error
// would leak them. The pool points at an unreachable host, so every query fails.
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { createRepositories, type RepositoryError } from '../src/index.js';
import { expectScrubbed } from './scrub.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

const SECRETS = ['stu_leak_7', 'tch_leak_9', 'ses_leak_3', 'msg_leak_5', 'private words here'];
const scope = { studentId: 'stu_leak_7', teacherId: 'tch_leak_9' };
const tscope = { teacherId: 'tch_leak_9' };

describe('driver errors are scrubbed', () => {
  it('messages.history', async () => {
    const err = await repos.messages.history(scope, 'ses_leak_3', 10).catch((e: unknown) => e);
    expectScrubbed(err, 'messages.history', SECRETS);
    // The cause keeps only the driver's error code.
    expect((err as RepositoryError).cause).toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('messages.append', async () => {
    const err = await repos.messages
      .append(scope, 'ses_leak_3', {
        id: 'msg_leak_5',
        role: 'student',
        text: 'private words here',
        createdAt: '2026-10-17T10:00:00Z',
      })
      .catch((e: unknown) => e);
    expectScrubbed(err, 'messages.append', SECRETS);
  });

  it('every other method that reaches the database', async () => {
    const calls: [string, () => Promise<unknown>][] = [
      [
        'agentVersions.get',
        () => repos.agentVersions.get(tscope, { agentId: 'agt_x', version: 1 }),
      ],
      ['learnerProfiles.get', () => repos.learnerProfiles.get(scope)],
      ['subscriptions.findLive', () => repos.subscriptions.findLive(scope)],
      [
        'subscriptions.start',
        () =>
          repos.subscriptions.start(scope, {
            packageVersionId: 'pv_leak_1',
            status: 'active',
            periodEnd: '2027-01-01T00:00:00Z',
          }),
      ],
      ['packageVersions.liveForAgent', () => repos.packageVersions.liveForAgent({ agentId: 'agt_x' })],
      ['sessions.get', () => repos.sessions.get(scope, 'ses_leak_3')],
      [
        'teacherQuestions.open',
        () =>
          repos.teacherQuestions.open(scope, {
            agentId: 'agt_x',
            text: 'private words here',
            similarIds: [],
          }),
      ],
    ];
    for (const [method, call] of calls) {
      expectScrubbed(await call().catch((e: unknown) => e), method, SECRETS);
    }
  });
});
