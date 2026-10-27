// Task 3.9f acceptance: `edmate chat` retrieves from the db-backed index when a database is
// configured. Seeds a throwaway Postgres database with real `documents`/`chunks` rows (through
// `seedChatChunks`, `dbRetrieval.ts`'s exported helper) under the world's own fixed teacher id
// (`CHAT_IDS.teacher`: `buildChatWorld` hard-codes it for the in-memory `AccessWorld` parts, so
// seeding under any other id would make the db's scope never match the session), then runs the
// same three same-topic turns `sameTopic.test.ts` uses and checks the help rung climbs above 0
// with no `locked`/`error` events -- on the scripted gateway only (rule 4: no real model call).
//
// Postgres reachability + the throwaway database are copied inline, the way
// `apps/worker/test/ingest.int.test.ts` already does (its own header comment explains why:
// `packages/db/test/pg.ts` is an internal test-only file of `packages/db`, not published, so
// every other package's integration test duplicates the same small helper instead of importing
// it).
import { randomBytes } from 'node:crypto';
import { defaultSteps, runTurn, type PipelineDeps } from '@edmate/harness';
import {
  adviceJudgeGateway,
  CLEAN_ADVICE_VERDICT,
  GROUNDED_VERDICT,
  judgeGateway,
  ScriptedGateway,
} from '@edmate/harness/testing';
import { createRepositories, migrateDatabase } from '@edmate/db';
import { createDb, type DbHandle } from '@edmate/db/internal';
import * as s from '@edmate/db/internal';
import type { TurnEvent, TurnInput } from '@edmate/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChatDeps, slackClock } from '../src/commands/chat/deps.js';
import { seedChatChunks } from '../src/commands/chat/dbRetrieval.js';
import { CHAT_IDS, loadChatContent } from '../src/commands/chat/world.js';

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';

async function reachable(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const SKIP_REASON =
  'SKIPPED: no Postgres at TEST_DATABASE_URL (default 127.0.0.1:55432); the shared dev Postgres is expected to already be running';

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function throwawayName(): string {
  return `edmate_test_${randomBytes(6).toString('hex')}`;
}

function urlFor(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

async function createDatabase(name: string): Promise<void> {
  await admin((c) => c.query(`create database "${name}"`));
}

async function dropDatabase(name: string): Promise<void> {
  await admin((c) => c.query(`drop database if exists "${name}" with (force)`));
}

const up = await reachable(ADMIN_URL);
if (!up && process.env.CI === 'true') {
  throw new Error('CI=true but no Postgres is reachable at TEST_DATABASE_URL');
}
if (!up) process.stderr.write(`[@edmate/cli] chatDbRetrieval.int ${SKIP_REASON}\n`);

const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const TEACHER = CHAT_IDS.teacher;

const say = (text: string) => ({ type: 'text' as const, text });
const used = {
  type: 'usage' as const,
  usage: {
    model: 'claude-haiku-4-5',
    tier: 'main' as const,
    inputTokens: 10,
    outputTokens: 10,
    costMicroUsd: 1,
  },
};

/** `n` copies of a predicate entry: route's classifiers run once per turn, so one entry per turn
 * is not enough across a multi-turn conversation (same helper as sameTopic.test.ts). */
function repeat<T>(n: number, entry: T): T[] {
  return Array.from({ length: n }, () => entry);
}

function scriptedChatGateway(replies: string[]) {
  const scripted = new ScriptedGateway(
    {
      generateObject: [
        ...repeat(replies.length, {
          match: (req: { system: string }) =>
            req.system.includes('thoughts of suicide or self-harm'),
          value: { distress: false },
        }),
        ...repeat(replies.length, {
          match: (req: { system: string }) =>
            req.system.includes('self_harm (wants to hurt themselves)'),
          value: { category: 'none' },
        }),
        ...repeat(replies.length, {
          match: (req: { system: string }) => req.system.includes('jailbreak_override'),
          value: { category: 'none' },
        }),
        ...repeat(replies.length, {
          match: (req: { system: string }) =>
            req.system.includes('You sort messages a student sent to an AI tutor'),
          value: { intent: 'on_task' },
        }),
      ],
      stream: replies.map((text) => ({ steps: [say(text), used] })),
    },
    { sleep: () => Promise.resolve() },
  );
  const judged = judgeGateway(scripted, () => GROUNDED_VERDICT);
  return adviceJudgeGateway(judged, () => CLEAN_ADVICE_VERDICT);
}

async function collect(events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

async function runOneTurn(
  deps: PipelineDeps,
  setup: { agentId: string; sessionId: string; studentId: string },
  text: string,
) {
  const input: TurnInput = {
    agentId: setup.agentId,
    sessionId: setup.sessionId,
    studentId: setup.studentId,
    kind: 'message',
    text,
    lang: 'en',
    clientTs: new Date().toISOString(),
  };
  const run = runTurn(input, { deps, steps: defaultSteps });
  const events = await collect(run.events);
  const result = await run.finished;
  return { events, result };
}

describe.skipIf(!up)(
  'edmate chat retrieves from the db-backed index when configured (3.9f)',
  () => {
    let handle: DbHandle;

    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      const { db } = handle;
      await db.insert(s.users).values({
        id: TEACHER,
        name: 'Demo teacher',
        locale: 'en',
        market: 'test',
        role: 'teacher',
      });
      const content = loadChatContent();
      const course = content.course;
      await db
        .insert(s.courses)
        .values({ id: course.id, teacherId: TEACHER, title: course.title, order: 0 });
      await db.insert(s.modules).values(
        course.modules.map((m, order) => ({
          id: m.id,
          teacherId: TEACHER,
          courseId: course.id,
          title: m.title,
          order,
        })),
      );
      const repos = createRepositories(db);
      await seedChatChunks(repos, content, TEACHER);
    });

    afterAll(async () => {
      await handle?.close();
      await dropDatabase(dbName);
    });

    it('three same-topic allowed turns on the db-backed index: no error/locked, and the saved help rung climbs above 0', async () => {
      const allowedTurns = [
        'What is a variable?',
        'Is a variable a name for a value?',
        'So is a variable just a name for a value?',
      ];
      const replies = [
        'A variable is a name that refers to a value.',
        'Yes, a variable names a value so your program can use it again.',
        "That's right: a variable is a name for a value.",
      ];
      const gateway = scriptedChatGateway(replies);
      const setup = await buildChatDeps({
        env: { DATABASE_URL: TEST_URL },
        market: 'global',
        packageId: 'free',
        source: 'teacher_preview',
        gateway,
        clock: slackClock(10),
      });
      expect(typeof setup.close).toBe('function');
      try {
        let sawRungAboveZero = false;
        for (const text of allowedTurns) {
          const { events, result } = await runOneTurn(setup.deps, setup, text);
          expect(
            events.filter((e) => e.type === 'error'),
            JSON.stringify(result.trace?.steps),
          ).toEqual([]);
          expect(events.some((e) => e.type === 'locked')).toBe(false);
          expect(events.at(-1)?.type).toBe('done');
          const rung = events.find((e) => e.type === 'hint_rung');
          if (rung !== undefined && rung.type === 'hint_rung' && rung.rung > 0) {
            sawRungAboveZero = true;
          }
        }
        const saved = (
          setup.deps.sessionState as unknown as {
            saved: { sessionId: string; helpState: unknown }[];
          }
        ).saved;
        const last = saved.at(-1);
        expect(last).toBeDefined();
        const lastHelpState = last?.helpState as { rung?: number } | undefined;
        expect((lastHelpState?.rung ?? 0) > 0 || sawRungAboveZero).toBe(true);
      } finally {
        await setup.close?.();
      }
    }, 20000);
  },
);

describe.skipIf(up)('edmate chat retrieves from the db-backed index when configured', () => {
  it.skip(SKIP_REASON, () => undefined);
});
