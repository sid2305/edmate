// Task 11.1d (build plan § 11.1d) on Postgres: editing and cancelling a scheduled live class
// before it starts (`liveClasses.update` / `liveClasses.cancel`), the https-only/length-capped
// link shared by `create` and `update`, and `listUpcomingForStudent`'s `.selectDistinct` defence-in-depth and
// cancelled-but-visible cases. See test/pg.ts for how to start one. Synthetic text only, no real
// student data. Every fixture class here is its own, created fresh in its own test (never the
// shared `liveClassFor` fixture `repositories.int.test.ts`'s own CASES entries depend on).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  LIVE_CLASS_LINK_MAX_LENGTH,
  RepositoryError,
  type Repositories,
} from '../src/index.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('live classes tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const tA = 'tch_11d_a';
const tB = 'tch_11d_b';
const stu1 = 'stu_11d_1';

const FUTURE = '2030-01-01T00:00:00Z';
const FUTURE_LATER = '2031-01-01T00:00:00Z';

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}_${(counter += 1)}`;
const httpsLink = () => `https://meet.example.com/${uid('l')}`;

describe.skipIf(!up)(`liveClasses on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  let pkgA: string;
  let pkgB: string;

  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();

    await raw.query(
      `insert into users (id, name, locale, market, role) values ($1, $1, 'en', 'test', 'teacher'), ($2, $2, 'en', 'test', 'teacher'), ($3, $3, 'en', 'test', 'student')`,
      [tA, tB, stu1],
    );
    pkgA = 'pkg_11d_a';
    pkgB = 'pkg_11d_b';
    await raw.query(
      `insert into agents (id, teacher_id, status, live_version) values ('agt_11d_a', $1, 'live', 1), ('agt_11d_b', $2, 'live', 1)`,
      [tA, tB],
    );
    await raw.query(
      `insert into packages (id, teacher_id, agent_id, name) values ($1, $2, 'agt_11d_a', '11d pkg a'), ($3, $4, 'agt_11d_b', '11d pkg b')`,
      [pkgA, tA, pkgB, tB],
    );
    await raw.query(
      `insert into package_versions (id, teacher_id, package_id, version, config)
       values ('pv_11d_a', $1, $2, 1, '{}'::jsonb), ('pv_11d_b', $3, $4, 1, '{}'::jsonb)`,
      [tA, pkgA, tB, pkgB],
    );
  }, 30_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 30_000);

  async function freshClass(
    teacherId: string,
    packageId: string,
    startsAt: string = FUTURE,
  ): Promise<string> {
    const { id } = await repos.liveClasses.create(
      { teacherId },
      {
        title: `[${uid('cls')}] a class`,
        link: httpsLink(),
        startsAt,
        packageIds: [packageId],
      },
    );
    return id;
  }

  describe('create', () => {
    it('refuses a plain http (not https) link', async () => {
      expect(
        await kind(
          repos.liveClasses.create(
            { teacherId: tA },
            {
              title: '[A] http link',
              link: 'http://meet.example.com/insecure',
              startsAt: FUTURE,
              packageIds: [pkgA],
            },
          ),
        ),
      ).toBe('invalid');
    });

    it('refuses a link one character over LIVE_CLASS_LINK_MAX_LENGTH', async () => {
      const pad = 'x'.repeat(LIVE_CLASS_LINK_MAX_LENGTH + 1 - 'https://e.co/'.length);
      expect(
        await kind(
          repos.liveClasses.create(
            { teacherId: tA },
            {
              title: '[A] over-length link',
              link: `https://e.co/${pad}`,
              startsAt: FUTURE,
              packageIds: [pkgA],
            },
          ),
        ),
      ).toBe('invalid');
    });

    it('accepts a link at exactly LIVE_CLASS_LINK_MAX_LENGTH characters', async () => {
      const pad = 'x'.repeat(LIVE_CLASS_LINK_MAX_LENGTH - 'https://e.co/'.length);
      const link = `https://e.co/${pad}`;
      expect(link).toHaveLength(LIVE_CLASS_LINK_MAX_LENGTH);
      const { id } = await repos.liveClasses.create(
        { teacherId: tA },
        { title: '[A] boundary link', link, startsAt: FUTURE, packageIds: [pkgA] },
      );
      expect(id).toMatch(/^[\w-]+$/);
    });
  });

  describe('update', () => {
    it("fails not_found on another teacher's class, writing nothing", async () => {
      const id = await freshClass(tA, pkgA);
      expect(
        await kind(
          repos.liveClasses.update(
            { teacherId: tB },
            id,
            { title: '[B] hijack', link: httpsLink(), startsAt: FUTURE },
          ),
        ),
      ).toBe('not_found');
      const list = await repos.liveClasses.listForTeacher({ teacherId: tA });
      expect(list.find((c) => c.id === id)?.title).not.toBe('[B] hijack');
    });

    it('fails not_found on a missing id', async () => {
      expect(
        await kind(
          repos.liveClasses.update(
            { teacherId: tA },
            'cls_11d_missing',
            { title: 'x', link: httpsLink(), startsAt: FUTURE },
          ),
        ),
      ).toBe('not_found');
    });

    it('fails invalid on a non-https or over-length link', async () => {
      const id = await freshClass(tA, pkgA);
      expect(
        await kind(
          repos.liveClasses.update(
            { teacherId: tA },
            id,
            { title: '[A] bad link', link: 'http://meet.example.com/x', startsAt: FUTURE },
          ),
        ),
      ).toBe('invalid');
    });

    it('fails invalid on a past startsAt', async () => {
      const id = await freshClass(tA, pkgA);
      expect(
        await kind(
          repos.liveClasses.update(
            { teacherId: tA },
            id,
            { title: '[A] bad time', link: httpsLink(), startsAt: '2000-01-01T00:00:00Z' },
          ),
        ),
      ).toBe('invalid');
    });

    it('fails invalid on a class whose own startsAt has already passed', async () => {
      const id = 'cls_11d_past_update';
      await raw.query(
        `insert into live_classes (id, teacher_id, package_ids, title, starts_at, link)
         values ($1, $2, $3, '[A] past', $4, $5)`,
        [id, tA, [pkgA], new Date('2000-01-01T00:00:00Z'), httpsLink()],
      );
      expect(
        await kind(
          repos.liveClasses.update(
            { teacherId: tA },
            id,
            { title: '[A] too late', link: httpsLink(), startsAt: FUTURE },
          ),
        ),
      ).toBe('invalid');
    });

    it('fails invalid on an already-cancelled class', async () => {
      const id = await freshClass(tA, pkgA);
      await repos.liveClasses.cancel({ teacherId: tA }, id);
      expect(
        await kind(
          repos.liveClasses.update(
            { teacherId: tA },
            id,
            { title: '[A] edit after cancel', link: httpsLink(), startsAt: FUTURE },
          ),
        ),
      ).toBe('invalid');
    });

    it('updates title/link/startsAt, visible in a fresh listForTeacher call', async () => {
      const id = await freshClass(tA, pkgA);
      const newLink = httpsLink();
      const res = await repos.liveClasses.update(
        { teacherId: tA },
        id,
        { title: '[A] edited title', link: newLink, startsAt: FUTURE_LATER },
      );
      expect(res).toEqual({ updated: true });
      const list = await repos.liveClasses.listForTeacher({ teacherId: tA });
      const row = list.find((c) => c.id === id);
      expect(row?.title).toBe('[A] edited title');
      expect(row?.link).toBe(newLink);
      expect(row?.status).toBe('scheduled');
    });
  });

  describe('cancel', () => {
    it("fails not_found on another teacher's class, writing nothing", async () => {
      const id = await freshClass(tA, pkgA);
      expect(await kind(repos.liveClasses.cancel({ teacherId: tB }, id))).toBe('not_found');
      const list = await repos.liveClasses.listForTeacher({ teacherId: tA });
      expect(list.find((c) => c.id === id)?.status).toBe('scheduled');
    });

    it('fails not_found on a missing id', async () => {
      expect(
        await kind(repos.liveClasses.cancel({ teacherId: tA }, 'cls_11d_missing_cancel')),
      ).toBe('not_found');
    });

    it('fails invalid on a scheduled class whose startsAt has already passed', async () => {
      const id = 'cls_11d_past_cancel';
      await raw.query(
        `insert into live_classes (id, teacher_id, package_ids, title, starts_at, link)
         values ($1, $2, $3, '[A] past 2', $4, $5)`,
        [id, tA, [pkgA], new Date('2000-01-01T00:00:00Z'), httpsLink()],
      );
      expect(await kind(repos.liveClasses.cancel({ teacherId: tA }, id))).toBe('invalid');
    });

    it('cancels once, and a second cancel is a no-op: no error, nothing changed, no second audit row', async () => {
      const id = await freshClass(tA, pkgA);
      const first = await repos.liveClasses.cancel({ teacherId: tA }, id);
      expect(first).toEqual({ cancelled: true });
      const cancelAuditCount = async () =>
        (
          await raw.query<{ n: number }>(
            `select count(*)::int as n from audit_log where target = $1 and action = 'live_class.cancel'`,
            [`live_class:${id}`],
          )
        ).rows[0]!.n;
      expect(await cancelAuditCount()).toBe(1);

      const second = await repos.liveClasses.cancel({ teacherId: tA }, id);
      expect(second).toEqual({ cancelled: false });
      expect(await cancelAuditCount()).toBe(1);

      const list = await repos.liveClasses.listForTeacher({ teacherId: tA });
      expect(list.find((c) => c.id === id)?.status).toBe('cancelled');
    });
  });

  describe('listUpcomingForStudent (11.1d additions)', () => {
    // `subscriptions_one_live_per_pair_key` (billing.ts) already makes a student's second
    // simultaneous live subscription to the same teacher a unique-constraint violation, so two
    // live rows for one (student, teacher) pair can't exist to drive this join twice that way.
    // The reachable version of the 11.1a review's duplicate-row shape is a class whose own
    // `package_ids` names the same package twice (never possible through `create`'s own
    // `.refine(unique, …)`, only through data written before that check, or directly): this still
    // exercises the same join. Note this passes with plain `.select` too — the duplicate is not
    // reachable through the repository today — so `.selectDistinct` is defence in depth against a
    // future join or constraint change, not a bug fix, and this test pins that guard.
    it('a class attached to the same package twice appears once (selectDistinct defence in depth)', async () => {
      const sid = 'stu_11d_dedupe';
      await raw.query(
        `insert into users (id, name, locale, market, role) values ($1, $1, 'en', 'test', 'student')`,
        [sid],
      );
      await raw.query(
        `insert into subscriptions (id, student_id, teacher_id, package_version_id, status, period_end)
         values ($1, $2, $3, 'pv_11d_a', 'active', '2032-01-01T00:00:00Z')`,
        ['sub_11d_dedupe', sid, tA],
      );
      const id = 'cls_11d_dupe_pkg';
      await raw.query(
        `insert into live_classes (id, teacher_id, package_ids, title, starts_at, link)
         values ($1, $2, $3, '[dedupe] class', $4, $5)`,
        [id, tA, [pkgA, pkgA], new Date(FUTURE), httpsLink()],
      );
      const rows = await repos.liveClasses.listUpcomingForStudent({
        studentId: sid,
        teacherId: tA,
      });
      const matches = rows.filter((r) => r.id === id);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.status).toBe('scheduled');
    });

    it('a cancelled class with a future startsAt still appears, with status "cancelled"', async () => {
      const sid = 'stu_11d_cancelled_view';
      await raw.query(
        `insert into users (id, name, locale, market, role) values ($1, $1, 'en', 'test', 'student')`,
        [sid],
      );
      await raw.query(
        `insert into subscriptions (id, student_id, teacher_id, package_version_id, status, period_end)
         values ($1, $2, $3, 'pv_11d_a', 'active', '2032-01-01T00:00:00Z')`,
        [`sub_11d_cancelled_view`, sid, tA],
      );
      const { id } = await repos.liveClasses.create(
        { teacherId: tA },
        {
          title: `[cancel-view-${uid('cv')}] class`,
          link: httpsLink(),
          startsAt: FUTURE,
          packageIds: [pkgA],
        },
      );
      await repos.liveClasses.cancel({ teacherId: tA }, id);
      const rows = await repos.liveClasses.listUpcomingForStudent({
        studentId: sid,
        teacherId: tA,
      });
      const row = rows.find((r) => r.id === id);
      expect(row?.status).toBe('cancelled');
    });
  });
});
