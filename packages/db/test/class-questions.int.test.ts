// Task 11.2a (build plan § 11.2, Phase A) on Postgres: a student's pre-class question
// (`classQuestions.submit`) and the teacher's own grouped queue (`listQueueForTeacher`). See
// test/pg.ts for how to start one. Synthetic text only, no real student data.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, type Repositories, RepositoryError } from '../src/index.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('class questions tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const tA = teacherId('A');
const tB = teacherId('B');
const stu1 = studentId('1');

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

async function countClassQuestions(): Promise<number> {
  const res = await raw.query<{ n: string }>('select count(*)::int as n from class_questions');
  return Number(res.rows[0]!.n);
}

let counter = 0;
const uid = (prefix: string) => `${prefix}_${(counter += 1)}`;

describe.skipIf(!up)(`classQuestions on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  const FUTURE = '2030-01-01T00:00:00Z';
  const PAST = new Date('2000-01-01T00:00:00Z');
  let futureClassA: string;
  let pastClassA: string;
  let classOtherPkgA: string;

  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();

    futureClassA = (
      await repos.liveClasses.create(
        { teacherId: tA },
        {
          title: 'A future class',
          link: 'https://meet.example.com/a-future',
          startsAt: FUTURE,
          packageIds: [ids.pkg('A')],
        },
      )
    ).id;
    pastClassA = 'cls_past_a';
    await raw.query(
      `insert into live_classes (id, teacher_id, package_ids, title, starts_at, link)
       values ($1, $2, $3, 'A past class', $4, 'https://meet.example.com/a-past')`,
      [pastClassA, tA, [ids.pkg('A')], PAST],
    );

    // A second package of teacher A, with no subscriber, for "wrong package" cases.
    await raw.query(
      `insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, 'other pkg')`,
      ['pkg_a_other', tA, ids.agent('A')],
    );
    await raw.query(
      `insert into package_versions (id, teacher_id, package_id, version, config)
       values ('pv_a_other', $1, 'pkg_a_other', 1, '{}'::jsonb)`,
      [tA],
    );
    classOtherPkgA = (
      await repos.liveClasses.create(
        { teacherId: tA },
        {
          title: 'A other-package class',
          link: 'https://meet.example.com/a-other',
          startsAt: FUTURE,
          packageIds: ['pkg_a_other'],
        },
      )
    ).id;

    // Subscription-status fixtures: one student per status, each pointed at teacher A's own
    // live package (`ids.packageVersion('A')`, the one `futureClassA` is attached to).
    for (const status of ['past_due', 'paused', 'ended'] as const) {
      const sid = `stu_11_2a_${status}`;
      await raw.query(
        `insert into users (id, name, locale, market, role) values ($1, $1, 'en', 'test', 'student')`,
        [sid],
      );
      await raw.query(
        `insert into subscriptions (id, student_id, teacher_id, package_version_id, status, period_end)
         values ($1, $2, $3, $4, $5, '2030-01-01T00:00:00Z')`,
        [`sub_11_2a_${status}`, sid, tA, ids.packageVersion('A'), status],
      );
    }
  }, 30_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 30_000);

  describe('submit', () => {
    it('writes one row for a student with a live subscription to the class package, before startsAt', async () => {
      const before = await countClassQuestions();
      const { id } = await repos.classQuestions.submit(
        { studentId: stu1, teacherId: tA },
        { liveClassId: futureClassA, text: 'Why does the sky look blue at noon?' },
      );
      expect(id).toMatch(/^[\w-]+$/);
      expect(await countClassQuestions()).toBe(before + 1);
      const row = await raw.query('select live_class_id, text from class_questions where id = $1', [
        id,
      ]);
      expect(row.rows[0]).toEqual({
        live_class_id: futureClassA,
        text: 'Why does the sky look blue at noon?',
      });
    });

    it('refuses, writing nothing: a paused/past_due/ended subscription', async () => {
      for (const status of ['past_due', 'paused', 'ended'] as const) {
        const before = await countClassQuestions();
        const sid = `stu_11_2a_${status}`;
        expect(
          await kind(
            repos.classQuestions.submit(
              { studentId: sid, teacherId: tA },
              { liveClassId: futureClassA, text: `[${status}] question` },
            ),
          ),
          status,
        ).toBe('not_found');
        expect(await countClassQuestions(), status).toBe(before);
      }
    });

    it('refuses, writing nothing: a live subscription to a different package than the class', async () => {
      const before = await countClassQuestions();
      expect(
        await kind(
          repos.classQuestions.submit(
            { studentId: stu1, teacherId: tA },
            { liveClassId: classOtherPkgA, text: 'wrong package question' },
          ),
        ),
      ).toBe('not_found');
      expect(await countClassQuestions()).toBe(before);
    });

    it("refuses, writing nothing: another teacher's unrelated class", async () => {
      const before = await countClassQuestions();
      expect(
        await kind(
          repos.classQuestions.submit(
            { studentId: stu1, teacherId: tB },
            { liveClassId: futureClassA, text: 'cross-teacher question' },
          ),
        ),
      ).toBe('not_found');
      expect(await countClassQuestions()).toBe(before);
    });

    it('refuses, writing nothing: a class whose startsAt has already passed', async () => {
      const before = await countClassQuestions();
      expect(
        await kind(
          repos.classQuestions.submit(
            { studentId: stu1, teacherId: tA },
            { liveClassId: pastClassA, text: 'too late question' },
          ),
        ),
      ).toBe('not_found');
      expect(await countClassQuestions()).toBe(before);
    });

    it('refuses an empty (after trim) or over-length text, writing nothing', async () => {
      const before = await countClassQuestions();
      expect(
        await kind(
          repos.classQuestions.submit(
            { studentId: stu1, teacherId: tA },
            { liveClassId: futureClassA, text: '   ' },
          ),
        ),
      ).toBe('invalid');
      expect(
        await kind(
          repos.classQuestions.submit(
            { studentId: stu1, teacherId: tA },
            { liveClassId: futureClassA, text: 'x'.repeat(8001) },
          ),
        ),
      ).toBe('invalid');
      expect(await countClassQuestions()).toBe(before);
    });
  });

  describe('listQueueForTeacher', () => {
    it("another teacher's classes never appear", async () => {
      await repos.classQuestions.submit(
        { studentId: stu1, teacherId: tA },
        { liveClassId: futureClassA, text: `only-teacher-a marker ${uid('m')}` },
      );
      const groupsB = await repos.classQuestions.listQueueForTeacher({ teacherId: tB });
      expect(JSON.stringify(groupsB)).not.toContain('only-teacher-a');
    });

    it('clusters similar questions into one group spanning two of the teacher\'s classes; dissimilar questions stay separate', async () => {
      const secondClassA = (
        await repos.liveClasses.create(
          { teacherId: tA },
          {
            title: 'A second future class',
            link: 'https://meet.example.com/a-second',
            startsAt: FUTURE,
            packageIds: [ids.pkg('A')],
          },
        )
      ).id;
      const n = uid('cluster');
      await repos.classQuestions.submit(
        { studentId: stu1, teacherId: tA },
        { liveClassId: futureClassA, text: `How do magnets attract metal objects (${n})` },
      );
      await repos.classQuestions.submit(
        { studentId: stu1, teacherId: tA },
        { liveClassId: secondClassA, text: `How do magnets attract certain metal objects (${n})` },
      );
      await repos.classQuestions.submit(
        { studentId: stu1, teacherId: tA },
        { liveClassId: secondClassA, text: `What causes rainbows to appear (${n})` },
      );

      const groups = await repos.classQuestions.listQueueForTeacher({ teacherId: tA });
      const magnetGroup = groups.find((g) => g.sample.includes('magnets'));
      const rainbowGroup = groups.find((g) => g.sample.includes('rainbows'));
      expect(magnetGroup, 'magnet group exists').toBeDefined();
      expect(rainbowGroup, 'rainbow group exists').toBeDefined();
      expect(magnetGroup!.count).toBe(2);
      expect(new Set(magnetGroup!.liveClassIds)).toEqual(new Set([futureClassA, secondClassA]));
      expect(rainbowGroup!.count).toBe(1);
      expect(rainbowGroup!.liveClassIds).toEqual([secondClassA]);
      expect(magnetGroup!.groupId).not.toBe(rainbowGroup!.groupId);
    });

    it('scans oldest-first past the cap: the oldest pending question survives, the newest is dropped', async () => {
      // One bulk insert of QUEUE_SCAN_MAX + 1 (201) similar, synthetic pending questions on
      // futureClassA, spaced one second apart so createdAt order is unambiguous: gs=0 is oldest,
      // gs=200 is newest. QUEUE_SCAN_MAX below must match class-questions.ts's own constant.
      const QUEUE_SCAN_MAX = 200;
      await raw.query(
        `insert into class_questions (id, live_class_id, text, created_at)
         select 'cq_scan_' || gs,
                $1,
                'Why is photosynthesis important for plant growth and energy production (' || gs || ')',
                now() - ((201 - gs) * interval '1 second')
         from generate_series(0, 200) as gs`,
        [futureClassA],
      );

      const groups = await repos.classQuestions.listQueueForTeacher({ teacherId: tA });
      const group = groups.find((g) => g.sample.includes('photosynthesis'));
      expect(group, 'photosynthesis group exists').toBeDefined();
      // Exactly one of the 201 inserted rows is scanned out by the QUEUE_SCAN_MAX cap.
      expect(group!.count).toBe(QUEUE_SCAN_MAX);
      // `sample` is always the group's oldest member (question-similarity.ts): if the scan were
      // still newest-first, the true oldest (gs=0) would have been dropped and this would fail.
      expect(group!.sample).toContain('(0)');
    });

    it('never returns a student id (the table has none; an explicit key sweep)', async () => {
      const groups = await repos.classQuestions.listQueueForTeacher({ teacherId: tA });
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(Object.keys(g).sort()).toEqual(['count', 'groupId', 'liveClassIds', 'oldestAt', 'sample']);
      }
      expect(JSON.stringify(groups)).not.toMatch(/stu_/);
    });
  });
});
