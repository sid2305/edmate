// Task 3.8 / ADR-0005 on Postgres: sessionStateStoreFor writes only the scope's own open session,
// refuses an oversized help state before writing, and the answer key reaches sessions.help_state
// and no other column (the real harness `commit` step runs on the db adapters). See test/pg.ts.
import { LIMITS } from '@edmate/contracts';
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { cancelSource, type CommitRecord, defaultSteps } from '@edmate/harness';
import { testDeps } from '@edmate/harness/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  sessionStateStoreFor,
  traceSinkFor,
  transcriptStoreFor,
} from '../src/index.js';
import { DATA_MODEL_TABLES } from './helpers.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('session state store tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const own = { studentId: studentId('1'), teacherId: teacherId('A') };
const CANARY = 'CANARY-ANSWER-KEY-91c2';

async function helpStateOf(sessionId: string): Promise<unknown> {
  const r = await raw.query<{ h: unknown }>('select help_state as h from sessions where id = $1', [
    sessionId,
  ]);
  return r.rows[0]?.h;
}

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

describe.skipIf(!up)(`sessionStateStoreFor on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  it('saves the scope’s own open session; last write wins', async () => {
    const store = sessionStateStoreFor(repos, own);
    await store.saveHelpState(ids.session('1A'), { v: 1, rung: 1 });
    await store.saveHelpState(ids.session('1A'), { v: 1, rung: 2 });
    expect(await helpStateOf(ids.session('1A'))).toEqual({ v: 1, rung: 2 });
  });

  it('another student’s, another teacher’s, a missing or an ended session is not_found', async () => {
    const store = sessionStateStoreFor(repos, own);
    const before = await helpStateOf(ids.session('2A'));
    expect(await kind(store.saveHelpState(ids.session('2A'), { v: 1 }))).toBe('not_found');
    expect(await kind(store.saveHelpState(ids.session('1B'), { v: 1 }))).toBe('not_found');
    expect(await kind(store.saveHelpState('ses_nowhere', { v: 1 }))).toBe('not_found');
    expect(await helpStateOf(ids.session('2A'))).toEqual(before);

    const { id } = await repos.sessions.create(own, {
      agentId: ids.agent('A'),
      agentVersion: 1,
      packageId: ids.pkg('A'),
      packageVersion: 1,
    });
    await raw.query('update sessions set ended_at = now() where id = $1', [id]);
    expect(await kind(store.saveHelpState(id, { v: 1 }))).toBe('not_found');
    expect(await helpStateOf(id)).toEqual({});
  });

  it('a value over LIMITS.helpStateMaxJsonLength is refused before any write', async () => {
    const store = sessionStateStoreFor(repos, own);
    await store.saveHelpState(ids.session('1A'), { v: 1, keep: true });
    const atCap = { a: 'x'.repeat(LIMITS.helpStateMaxJsonLength - '{"a":""}'.length) };
    expect(JSON.stringify(atCap)).toHaveLength(LIMITS.helpStateMaxJsonLength);
    await store.saveHelpState(ids.session('1A'), atCap);
    expect(await helpStateOf(ids.session('1A'))).toEqual(atCap);
    const over = { a: `${atCap.a}x` };
    expect(await kind(store.saveHelpState(ids.session('1A'), over))).toBe('invalid');
    expect(await helpStateOf(ids.session('1A'))).toEqual(atCap);
  });

  it('a bad scope is refused when the store is built', () => {
    expect(() => sessionStateStoreFor(repos, { studentId: '', teacherId: 'tch_a' })).toThrow(
      RepositoryError,
    );
  });

  it('commit on the db adapters: the answer key is in help_state and nowhere else', async () => {
    const t = testDeps({
      overrides: {
        transcripts: transcriptStoreFor(repos, own),
        sessionState: sessionStateStoreFor(repos, own),
      },
    });
    const sessionId = ids.session('1A');
    const record: CommitRecord = {
      turnId: 'trn_canary',
      sessionId,
      messageId: 'msg_canary_reply',
      receivedAt: '2026-10-18T10:00:00.000Z',
      createdAt: '2026-10-18T10:00:02.000Z',
      entitled: {} as CommitRecord['entitled'],
      input: { ...demoTurnInput, sessionId, text: 'what is 1/2 + 1/3?' },
      outcome: 'replied',
      next: {
        rung: 2,
        help: { stuckTurns: 1, attemptLogged: true, pendingCheck: false, answerKey: [CANARY] },
      },
      replyText: 'What do you notice about the denominators?',
    };
    await defaultSteps.commit(
      { input: demoTurnInput, deps: t.deps, cancel: cancelSource().token, turnId: 'trn_canary' },
      record,
    );
    await traceSinkFor(repos, own).record({
      turnId: 'trn_canary',
      sessionId,
      agentVersion: 1,
      packageVersion: 1,
      steps: [{ name: 'commit', ms: 0, outcome: 'ok' }],
      intent: 'on_task',
      move: 'hint',
      guards: [],
      usage: [],
    });
    const history = await repos.messages.history(own, sessionId, 200);
    expect(history.map((m) => m.id)).toContain('msg_canary_reply');

    const hits: string[] = [];
    for (const table of DATA_MODEL_TABLES) {
      const r = await raw.query<{ n: string }>(
        `select count(*)::text as n from "${table}" x where x::text like $1`,
        [`%${CANARY}%`],
      );
      if (r.rows[0]?.n !== '0') hits.push(table);
    }
    expect(hits).toEqual(['sessions']);
    expect(JSON.stringify(await helpStateOf(sessionId))).toContain(CANARY);
  });
});
