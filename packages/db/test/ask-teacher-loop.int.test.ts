// Task 5.10 acceptance, on a real Postgres 16 + pgvector: an uncovered question from one student
// gives ask_teacher and opens a teacher_question; a similarly worded question from a second
// student joins the same group; the teacher answers once through the CLI, with a module, and both
// students get one teacher message in their open session plus one notification, a teacher_note
// document and chunk exist with one teacher_eval_cases row, and the material revision went up; a
// third, differently but similarly worded turn is no longer ask_teacher, opens no new question, and is answered
// from the note, citing it. The real admit, entitle, buildContext, decide and generate steps run
// over the db ports (retrievalIndexFor, teacherQuestionStoreFor, entitlementStoreFor,
// turnConfigStoreFor), with the scripted gateway (no model call). See test/pg.ts to start one.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EntitlementStore,
  ModelChunk,
  ProfileStore,
  TeacherQuestionStore,
  TranscriptStore,
  TurnEvent,
  TurnInput,
} from '@edmate/contracts';
import { demoTurnInput, usageMain } from '@edmate/contracts/fixtures';
import { createPromptPackLibrary, defaultSteps, parsePromptPackSet, runTurn, teacherNoteSource } from '@edmate/harness';
import {
  fixturePromptPackRaw,
  testDeps,
  testSteps,
  type StreamStep,
  type VirtualClock,
} from '@edmate/harness/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  entitlementStoreFor,
  profileStoreFor,
  type Repositories,
  retrievalIndexFor,
  teacherQuestionStoreFor,
  transcriptStoreFor,
  turnConfigStoreFor,
} from '../src/index.js';
import { runTeacherQuestionsCli } from '../src/cli.js';
import { queryTerms } from '../src/repositories/retrieval.js';
import {
  bestGroup,
  QUESTION_GROUP_MIN,
  questionSimilarity,
} from '../src/repositories/question-similarity.js';
import { ids, seed, teacherId } from './isolation-seed.js';
import { learnerClear, locales, packMarket } from './access-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('ask the teacher acceptance tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;
let dir: string;

const tA = teacherId('A');
const agentA = ids.agent('A');
const moduleA = ids.module('A', 1);

// Each turn is honestly worded differently (fix round 1): Q2 swaps "does ... look" for "makes"
// (term sets {sky, look, blue, noon, clear, day} vs {make, sky, blue, clear, day, around, noon}:
// Jaccard 5/8, five shared terms, so it still groups), and turn 3 drops "look" and "day" and the
// rest is reordered. No shared marker prefix: the database is a throwaway one per run, so none is needed, and a
// marker would inflate the compared term sets.
const Q1 = 'Why does the sky look blue at noon on a clear day?';
const Q2 = 'What makes the sky blue on a clear day around noon?';
const Q3 = 'Why is a clear sky blue at noon?';
const ANSWER = 'The sky scatters shorter blue wavelengths more than red ones.';

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const reply = (text: string): StreamStep[] => [say(text), used];

const of = <T extends TurnEvent['type']>(events: TurnEvent[], type: T) =>
  events.filter((e): e is Extract<TurnEvent, { type: T }> => e.type === type);

// isolation-seed.ts's agentConfig keeps `demoAgentConfig.promptPackVersion` ('1.0.0'); the
// testing library's fixture packs are pinned to a different version ('0.1.0-fixture'), so a real
// decide step over the seeded agent needs its own library pinned to the seed's version instead.
const promptPacks = createPromptPackLibrary([
  parsePromptPackSet({ ...fixturePromptPackRaw, version: '1.0.0' }),
]);

/**
 * The slack every harness step budget gets here (fix round 1, the 3.9b/3.9d CI flake class): the
 * budgets (entitle 50 ms, decide 50 ms, buildContext 300 ms, the teacher-question open 500 ms) run
 * over real Postgres, and a cold first turn on a loaded runner overran them. Production budgets
 * and clocks are unchanged.
 */
const STEP_BUDGET_SLACK = 10;

/**
 * A real clock (real `setTimeout`/`Date.now`) that runs `factor` times slower: `sleep(ms)` waits
 * `ms * factor` real ms and `now()` advances 1 ms per `factor` real ms. Both slow together, since
 * the harness races step timeouts on `sleep` and also subtracts `now()` deltas from budgets, so a
 * real hang still times out. Copied from apps/worker/test/clock.ts (3.9d), fitted to
 * `VirtualClock`. A real clock, not `virtualClock()`: the steps make real Postgres round trips,
 * which settle only through the event loop's real I/O phase, and `virtualClock()`'s `drive()`
 * fires a step's timeout as soon as its microtask queue goes quiet, before any query returns.
 */
function slackClock(factor: number = STEP_BUDGET_SLACK): VirtualClock {
  const origin = Date.now();
  return {
    pending: 0,
    now: () => origin + Math.floor((Date.now() - origin) / factor),
    sleep(ms, cancel) {
      return new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms * factor);
        cancel?.onCancel(() => {
          clearTimeout(t);
          resolve();
        });
      });
    },
    async advance() {
      // Real time passes on its own; nothing to fire.
    },
    async drive(promise) {
      return promise;
    },
  };
}

/** Runs one real turn for the given student x session over the db ports; one model call. */
async function runFor(
  clock: VirtualClock,
  studentId: string,
  sessionId: string,
  text: string,
  n: number,
  scriptedText: string,
) {
  const scope = { studentId, teacherId: tA };
  const entitlements: EntitlementStore = entitlementStoreFor(repos, {
    market: 'IN',
    packMarket,
    learnerClear,
  });
  const profiles: ProfileStore = {
    get: (sid, tid) => profileStoreFor(repos, { studentId: sid, teacherId: tid }).get(sid, tid),
    applyEvidence: () => Promise.reject(new Error('unused')),
  };
  const transcripts: TranscriptStore = transcriptStoreFor(repos, scope);
  const teacherQuestions: TeacherQuestionStore = {
    findSimilar: () => Promise.resolve([]),
    open: (q) => teacherQuestionStoreFor(repos, { studentId: q.studentId, teacherId: q.teacherId }).open(q),
  };
  const t = testDeps({
    clock,
    script: { stream: [{ steps: reply(scriptedText) }] },
    overrides: {
      entitlements,
      turnConfig: turnConfigStoreFor(repos, { locales }),
      retrieval: retrievalIndexFor(repos),
      teacherQuestions,
      profiles,
      transcripts,
      promptPacks,
    },
  });
  const steps = testSteps({
    admit: defaultSteps.admit,
    entitle: defaultSteps.entitle,
    buildContext: defaultSteps.buildContext,
    decide: defaultSteps.decide,
    generate: defaultSteps.generate,
  });
  const input: TurnInput = {
    ...demoTurnInput,
    studentId,
    agentId: agentA,
    sessionId,
    text,
    clientTs: `2026-10-21T10:0${n}:00Z`,
  };
  const run = runTurn(input, { deps: t.deps, steps });
  const events: TurnEvent[] = [];
  const [, result] = await Promise.all([
    (async () => {
      for await (const event of run.events) events.push(event);
    })(),
    run.finished,
  ]);
  // On failure, print any error event and the trace's step outcomes (as 3.9d did).
  const why = JSON.stringify({
    errors: events.filter((e) => e.type === 'error'),
    steps: result.trace?.steps,
  });
  return { events, decision: steps.commits.at(-1)?.decision, why };
}

describe.skipIf(!up)(`ask the teacher acceptance on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    dir = await mkdtemp(join(tmpdir(), 'edmate-ask-teacher-'));
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
    await rm(dir, { recursive: true, force: true });
  }, 60_000);

  async function groupOf(questionId: string): Promise<string | null> {
    const res = await raw.query<{ group_id: string | null }>(
      'select group_id from teacher_questions where id = $1',
      [questionId],
    );
    return res.rows[0]?.group_id ?? null;
  }

  it(
    "an uncovered question is answered by the teacher; a similarly worded one from a second " +
      "student opens in the same group; the teacher answers both at once through the CLI; a " +
      "third similar turn is answered from the note, citing it",
    async () => {
      const clock = slackClock();

      // The wording really differs, yet still groups (fix round 1).
      expect(queryTerms(Q2).sort()).not.toEqual(queryTerms(Q1).sort());
      expect(queryTerms(Q3).sort()).not.toEqual(queryTerms(Q1).sort());
      expect(questionSimilarity(Q1, Q2)).toBeGreaterThanOrEqual(QUESTION_GROUP_MIN);
      expect(questionSimilarity(Q1, Q2)).toBeLessThan(1);
      expect(bestGroup(Q2, [{ id: 'q1', text: Q1, groupId: null, createdAt: new Date(0) }])).toBe('q1');

      // 1. Student 1's uncovered question: ask_teacher, one teacher_question event.
      const first = await runFor(
        clock,
        'stu_1',
        ids.session('1A'),
        Q1,
        1,
        'That is a good one for your teacher. I have sent it on.',
      );
      expect(first.decision?.move, first.why).toBe('ask_teacher');
      const q1Events = of(first.events, 'teacher_question');
      expect(q1Events).toHaveLength(1);
      const q1Id = q1Events[0]!.questionId;
      expect(first.events.at(-1)?.type, first.why).toBe('done');

      // 2. Student 2's similarly worded question opens a second question in the same group.
      const second = await runFor(
        clock,
        'stu_2',
        ids.session('2A'),
        Q2,
        2,
        'That is a good one for your teacher. I have sent it on.',
      );
      expect(second.decision?.move, second.why).toBe('ask_teacher');
      expect(second.events.at(-1)?.type, second.why).toBe('done');
      const q2Events = of(second.events, 'teacher_question');
      expect(q2Events).toHaveLength(1);
      const q2Id = q2Events[0]!.questionId;
      expect(q1Id).not.toBe(q2Id);
      const [g1, g2] = await Promise.all([groupOf(q1Id), groupOf(q2Id)]);
      expect(g1).not.toBeNull();
      expect(g1).toBe(g2);

      // 3. The teacher answers once through the CLI, with a module.
      const evalBefore = await raw.query<{ n: string }>(
        'select count(*)::text as n from teacher_eval_cases',
      );
      const revBefore = await raw.query<{ rev: string }>(
        'select revision::text as rev from teacher_material_revisions where teacher_id = $1',
        [tA],
      );
      const revBeforeN = Number(revBefore.rows[0]?.rev ?? 0);
      const answerFile = join(dir, 'answer.txt');
      await writeFile(answerFile, ANSWER, 'utf8');
      const lines: string[] = [];
      const code = await runTeacherQuestionsCli(
        ['answer', '--teacher', tA, '--question', q1Id, '--module', moduleA, '--answer-file', answerFile],
        { DATABASE_URL: TEST_URL },
        (l) => lines.push(l),
      );
      expect(code).toBe(0);
      expect(lines.join('\n')).toMatch(/^db:questions: answered 2 question\(s\), 2 student\(s\)/);

      // 4. Both students get one teacher message in their open session and one notification.
      const hist1 = await repos.messages.history({ studentId: 'stu_1', teacherId: tA }, ids.session('1A'), 50);
      const hist2 = await repos.messages.history({ studentId: 'stu_2', teacherId: tA }, ids.session('2A'), 50);
      expect(hist1.filter((m) => m.role === 'teacher')).toHaveLength(1);
      expect(hist2.filter((m) => m.role === 'teacher')).toHaveLength(1);
      expect(hist1.find((m) => m.role === 'teacher')?.text).toContain('scatters shorter blue');

      const notes1 = await repos.notifications.listForStudent(
        { studentId: 'stu_1', teacherId: tA },
        { unreadOnly: false, limit: 10 },
      );
      const notes2 = await repos.notifications.listForStudent(
        { studentId: 'stu_2', teacherId: tA },
        { unreadOnly: false, limit: 10 },
      );
      expect(notes1.some((n) => n.questionId === q1Id)).toBe(true);
      expect(notes2.some((n) => n.questionId === q2Id)).toBe(true);

      // A teacher_note document and chunk exist in that module, one teacher_eval_cases row, and
      // the material revision went up.
      const noteDoc = await raw.query<{ n: string }>(
        `select count(*)::text as n from documents where module_id = $1 and kind = 'teacher_note'`,
        [moduleA],
      );
      expect(Number(noteDoc.rows[0]!.n)).toBe(1);
      const evalAfter = await raw.query<{ n: string }>(
        'select count(*)::text as n from teacher_eval_cases',
      );
      expect(Number(evalAfter.rows[0]!.n) - Number(evalBefore.rows[0]!.n)).toBe(1);
      const revAfter = await raw.query<{ rev: string }>(
        'select revision::text as rev from teacher_material_revisions where teacher_id = $1',
        [tA],
      );
      expect(Number(revAfter.rows[0]!.rev)).toBeGreaterThan(revBeforeN);

      // 5. A third turn with a similar question is not ask_teacher and opens no new question. The
      // note is retrieved first, and the sources event cites it as the teacher's answer.
      const before = await raw.query<{ n: string }>(
        `select count(*)::text as n from teacher_questions where teacher_id = $1`,
        [tA],
      );
      const third = await runFor(
        clock,
        'stu_1',
        ids.session('1A'),
        Q3,
        3,
        "The sky scatters blue light the most [1]. What colour scatters least?",
      );
      expect(third.events.at(-1)?.type, third.why).toBe('done');
      expect(third.decision?.move, third.why).not.toBe('ask_teacher');
      expect(third.decision?.move, third.why).not.toBe('locked');
      expect(of(third.events, 'teacher_question')).toHaveLength(0);
      const after = await raw.query<{ n: string }>(
        `select count(*)::text as n from teacher_questions where teacher_id = $1`,
        [tA],
      );
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);

      const [sources] = of(third.events, 'sources');
      expect(sources?.items[0], third.why).toMatchObject({
        title: "Teacher's answer",
        kind: 'teacher_note',
      });
      expect(sources?.items[0]).toEqual(
        teacherNoteSource('teacher_answer', sources!.items[0]!.locator as string),
      );
    },
    60_000,
  );
});
