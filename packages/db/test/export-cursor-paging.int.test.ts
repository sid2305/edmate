// Task 9.6f (9.6a review follow-up): sessions.listForStudent and messages.listForStudent page by
// (created_at, id) without sorting the whole pair history each page. `repositories.int.test.ts` is
// out of bounds for this task (another builder owns it, see docs/tasks/9.6f/plan.md's "Scope
// conflict found while planning"), so the missing messages.listForStudent cases (malformed cursor,
// exact-boundary next = null, return-key-set) that mirror the existing sessions.listForStudent
// cases there live here instead, next to the EXPLAIN assertions the index needs.
// See test/pg.ts for how to start Postgres.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, type Repositories } from '../src/index.js';
import { EXPORT_PAGE_MAX } from '../src/repositories/sessions.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('export-cursor paging tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let raw: pg.Client;
let repos: Repositories;

const TEACHER = 'tch_xcur_1';
const STUDENT = 'stu_xcur_1';
const AGENT = 'agt_xcur_1';
const SCOPE = { studentId: STUDENT, teacherId: TEACHER };
const SESSION_COUNT = 12;
const MESSAGE_COUNT = 10_000;
const NOISE_SESSION_COUNT = 5_000;

// A second, small pair: for the malformed-cursor, exact-boundary and return-key-set cases, which
// need a controllable, exactly-known total (the big pair's EXPORT_PAGE_MAX-capped reads can't
// reach an exact boundary once its own history passes that cap).
const TEACHER_B = 'tch_xcur_b';
const STUDENT_B = 'stu_xcur_b';
const SCOPE_B = { studentId: STUDENT_B, teacherId: TEACHER_B };
const SESSION_B = 'ses_xcur_b1';

// A third, dedicated small pair: for the cross-session created_at tie on a page boundary (item 3,
// lead amendment 2) -- its own two sessions, created in that test itself (not beforeAll), so the
// big pair's seed above never needs touching.
const TEACHER_C = 'tch_xcur_c';
const STUDENT_C = 'stu_xcur_c';
const SCOPE_C = { studentId: STUDENT_C, teacherId: TEACHER_C };
const SESSION_C1 = 'ses_xcur_c1';
const SESSION_C2 = 'ses_xcur_c2';

/**
 * Captures the one SQL statement + bound params the pool's `query` actually receives while
 * `run` executes, then EXPLAINs that literal statement over `raw` with the same params -- so the
 * EXPLAIN reflects the repository's real SQL, never a hand-written copy (9.6j).
 */
async function captureAndExplain<T>(
  pool: pg.Pool,
  raw: pg.Client,
  run: () => Promise<T>,
): Promise<{ result: T; text: string; rows: { 'QUERY PLAN': { Plan: PlanNode }[] }[] }> {
  const spy = vi.spyOn(pool, 'query');
  const result = await run();
  expect(spy.mock.calls).toHaveLength(1);
  const [config, params] = spy.mock.calls[0] as unknown as [string | { text: string }, unknown[]];
  const text = typeof config === 'string' ? config : config.text;
  const { rows } = await raw.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
    `EXPLAIN (FORMAT JSON) ${text}`,
    params,
  );
  spy.mockRestore();
  return { result, text, rows };
}

describe.skipIf(!up)(`export cursor paging on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();

    await raw.query(
      `insert into users (id, name, locale, market, role) values
           ($1, 'Export Cursor Teacher', 'en-US', 'US', 'teacher'),
           ($2, 'Export Cursor Student', 'en-US', 'US', 'student'),
           ($3, 'Export Cursor Teacher B', 'en-US', 'US', 'teacher'),
           ($4, 'Export Cursor Student B', 'en-US', 'US', 'student')`,
      [TEACHER, STUDENT, TEACHER_B, STUDENT_B],
    );
    // NOISE_SESSION_COUNT other students of the same teacher, so the sessions table is big
    // enough overall that the planner prefers the new index over a seq scan + Sort to find this
    // one pair's SESSION_COUNT rows (a 12-row table never needs an index).
    await raw.query(
      `insert into users (id, name, locale, market, role)
           select 'stu_xcur_noise_' || gs, 'Noise Student ' || gs, 'en-US', 'US', 'student'
           from generate_series(1, $1) gs`,
      [NOISE_SESSION_COUNT],
    );
    await raw.query(
      `insert into agents (id, teacher_id, status, created_at, updated_at) values
           ($1, $2, 'draft', now(), now()),
           ($3, $4, 'draft', now(), now())`,
      [AGENT, TEACHER, 'agt_xcur_b', TEACHER_B],
    );
    // SESSION_COUNT sessions, already ended (package_id/package_version left null: the
    // sessions_open_has_package check only requires one of ended_at/package_id), spread one
    // minute apart so they share no created_at.
    await raw.query(
      `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, created_at, ended_at)
           select 'ses_xcur_' || gs, $1, $2, $3, 1,
                  timestamp '2026-01-01 00:00:00' + (gs || ' minutes')::interval,
                  timestamp '2026-01-01 00:00:00' + (gs || ' minutes')::interval
           from generate_series(1, $4) gs`,
      [STUDENT, TEACHER, AGENT, SESSION_COUNT],
    );
    await raw.query(
      `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, created_at, ended_at)
           select 'ses_xcur_noise_' || gs, 'stu_xcur_noise_' || gs, $1, $2, 1,
                  timestamp '2025-01-01 00:00:00' + (gs || ' minutes')::interval,
                  timestamp '2025-01-01 00:00:00' + (gs || ' minutes')::interval
           from generate_series(1, $3) gs`,
      [TEACHER, AGENT, NOISE_SESSION_COUNT],
    );
    await raw.query(
      `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, created_at, ended_at)
           values ($1, $2, $3, 'agt_xcur_b', 1, '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
      [SESSION_B, STUDENT_B, TEACHER_B],
    );
    // MESSAGE_COUNT messages spread evenly across the SESSION_COUNT sessions, one second apart
    // within a session so every (session_id, created_at) pair is distinct (no tie-break needed
    // for the bulk of the seed; the dedicated tie-break rows below cover that).
    await raw.query(
      `insert into messages (id, session_id, role, text, created_at)
           select 'msg_xcur_' || gs,
                  'ses_xcur_' || (1 + (gs % $1)),
                  'student',
                  'bulk ' || gs,
                  timestamp '2026-02-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, $2) gs`,
      [SESSION_COUNT, MESSAGE_COUNT],
    );
    // Pair B's small, exactly-known history: 3 messages, two of them tied on created_at.
    await raw.query(
      `insert into messages (id, session_id, role, text, created_at) values
           ($1, $2, 'student', 'b1', '2026-04-01T00:01:00Z'),
           ($1 || '_tie_b', $2, 'student', 'b2 tie', '2026-04-01T00:02:00Z'),
           ($1 || '_tie_a', $2, 'student', 'b3 tie', '2026-04-01T00:02:00Z')`,
      ['msg_xcur_b', SESSION_B],
    );
    await raw.query('analyze sessions');
    await raw.query('analyze messages');
  });

  afterAll(async () => {
    await raw?.end();
    await dropDatabase(dbName);
    await handle?.close();
  });

  it('creates the two new additive indexes', async () => {
    const { rows } = await raw.query<{ tablename: string; indexname: string; indexdef: string }>(
      `select tablename, indexname, indexdef from pg_indexes
           where indexname in (
             'sessions_teacher_id_student_id_created_at_id_idx',
             'messages_session_id_created_at_id_idx'
           )`,
    );
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.sessions_teacher_id_student_id_created_at_id_idx).toMatch(
      /\(teacher_id, student_id, created_at, id\)/,
    );
    expect(defs.messages_session_id_created_at_id_idx).toMatch(/\(session_id, created_at, id\)/);
  });

  it('sessions.listForStudent: EXPLAIN shows an index scan with no full Sort over the pair', async () => {
    const { rows } = await raw.query<{ 'QUERY PLAN': { Plan: unknown }[] }>(
      `explain (format json)
           select id, agent_id, agent_version, package_id, package_version, summary, created_at, ended_at
           from sessions where teacher_id = $1 and student_id = $2
           order by created_at asc, id asc limit 3`,
      [TEACHER, STUDENT],
    );
    const plan = JSON.stringify(rows[0]?.['QUERY PLAN']);
    expect(plan).toContain('sessions_teacher_id_student_id_created_at_id_idx');
    expect(plan).toMatch(/Index( Only)? Scan/);
    expect(plan).not.toContain('"Sort Key"');
  });

  it(
    'messages.listForStudent: EXPLAIN on the real statement shows the lateral per-session seek ' +
      'and an outer scan on the sessions index, no full Sort over the 10,000-row history',
    async () => {
      // The real statement messages.listForStudent sends (sessions join + cross join lateral +
      // outer order/limit), not just a hand-written copy of the inner per-session subquery.
      const { text, rows } = await captureAndExplain(handle.pool, raw, () =>
        repos.messages.listForStudent(SCOPE, { limit: 2 }),
      );
      expect(text.toLowerCase()).toContain('cross join lateral');
      const top = rows[0]?.['QUERY PLAN']?.[0]?.Plan;
      const plan = JSON.stringify(top);
      expect(plan).toContain('messages_session_id_created_at_id_idx');
      expect(plan).toMatch(/Index( Only)? Scan/);
      // The outer scan (finding this pair's SESSION_COUNT sessions among NOISE_SESSION_COUNT
      // others) stays on the sessions (teacher_id, student_id) index too, rather than a seq scan
      // that would run the lateral once per unrelated noise session.
      expect(plan).toContain('sessions_teacher_id_student_id_created_at_id_idx');
      // "no full Sort": every "Plan Rows" figure in the tree stays under the pair's 10,000-message
      // history -- the lateral's bounded per-session candidate set, never the whole history.
      const plannedRows = collectPlannedRows(top);
      expect(Math.max(...plannedRows, 0)).toBeLessThan(MESSAGE_COUNT);
    },
  );

  it('sessions.listForStudent: a mid-range (page 2+) cursor seeks on the index, no OR Filter', async () => {
    // Task 9.6f review HIGH: the old `or(gt(...), and(eq(...), gt(...)))` cursor makes Postgres
    // plan `Index Cond: teacher_id = … AND student_id = …` plus a `Filter` holding the OR, scanning
    // every earlier row in the pair. The row-value compare folds the cursor into the index too.
    const { text, rows } = await captureAndExplain(handle.pool, raw, () =>
      repos.sessions.listForStudent(SCOPE, {
        after: { createdAt: '2026-01-01T00:05:00.000Z', id: 'ses_xcur_5' },
        limit: 3,
      }),
    );
    expect(text).toMatch(/>\s*\(/); // the row-value cursor compare, not a hand-written OR
    const top = rows[0]?.['QUERY PLAN']?.[0]?.Plan;
    const plan = JSON.stringify(top);
    expect(plan).toContain('sessions_teacher_id_student_id_created_at_id_idx');
    expect(plan).toMatch(/Index( Only)? Scan/);
    const scan = findIndexScan(top);
    expect(scan?.['Index Cond']).toMatch(/created_at/);
    expect(scan?.Filter).toBeUndefined();
  });

  it('messages.listForStudent: a mid-range (page 2+) per-session cursor seeks on the index, no OR Filter', async () => {
    const { text, rows } = await captureAndExplain(handle.pool, raw, () =>
      repos.messages.listForStudent(SCOPE, {
        after: { createdAt: '2026-02-01T00:02:00.000Z', id: 'msg_xcur_120' },
        limit: 3,
      }),
    );
    expect(text).toMatch(/>\s*\(/); // the row-value cursor compare, not a hand-written OR
    const top = rows[0]?.['QUERY PLAN']?.[0]?.Plan;
    const plan = JSON.stringify(top);
    expect(plan).toContain('messages_session_id_created_at_id_idx');
    expect(plan).toMatch(/Index( Only)? Scan/);
    // The relation filter picks the inner per-session messages seek, not the outer sessions scan
    // the lateral statement also runs (both are Index (Only) Scans in this plan).
    const scan = findIndexScan(top, 'messages');
    expect(scan?.['Index Cond']).toMatch(/created_at/);
    expect(scan?.Filter).toBeUndefined();
  });

  it(
    'messages.listForStudent: a created_at tie across two different sessions on a page boundary ' +
      'drops or duplicates no row',
    async () => {
      // A third, dedicated small pair (own sessions, own messages): two sessions, one message
      // each, sharing a created_at exactly -- the merge across sessions in
      // messagesRepo.listForStudent must place exactly one of them on each side of a page cut at
      // limit = 1, with no row lost or doubled across the two pages.
      await raw.query(
        `insert into users (id, name, locale, market, role) values
             ($1, 'Export Cursor Teacher C', 'en-US', 'US', 'teacher'),
             ($2, 'Export Cursor Student C', 'en-US', 'US', 'student')`,
        [TEACHER_C, STUDENT_C],
      );
      await raw.query(
        `insert into agents (id, teacher_id, status, created_at, updated_at) values
             ($1, $2, 'draft', now(), now())`,
        ['agt_xcur_c', TEACHER_C],
      );
      await raw.query(
        `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, created_at, ended_at) values
             ($1, $3, $4, 'agt_xcur_c', 1, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
             ($2, $3, $4, 'agt_xcur_c', 1, '2026-06-01T00:01:00Z', '2026-06-01T00:01:00Z')`,
        [SESSION_C1, SESSION_C2, STUDENT_C, TEACHER_C],
      );
      await raw.query(
        `insert into messages (id, session_id, role, text, created_at) values
             ('msg_xcur_c_a', $1, 'student', 'boundary a', '2026-06-01T00:02:00Z'),
             ('msg_xcur_c_b', $2, 'student', 'boundary b', '2026-06-01T00:02:00Z')`,
        [SESSION_C1, SESSION_C2],
      );
      const page1 = await repos.messages.listForStudent(SCOPE_C, { limit: 1 });
      expect(page1.next).not.toBeNull();
      const page2 = await repos.messages.listForStudent(SCOPE_C, {
        after: page1.next!,
        limit: 1,
      });
      expect(page2.next).toBeNull();
      const ids = [...page1.items, ...page2.items].map((m) => m.id);
      expect(new Set(ids)).toEqual(new Set(['msg_xcur_c_a', 'msg_xcur_c_b']));
    },
  );

  it(
    'messages.listForStudent pages every message of every own session, oldest first, stable ' +
      'across a created_at tie, matching one big unpaginated read page-by-page',
    async () => {
      // Two messages sharing a created_at in the same session: tie-break by id.
      await raw.query(
        `insert into messages (id, session_id, role, text, created_at) values
             ('msg_xcur_tie_b', 'ses_xcur_1', 'student', 'tie b', '2026-03-01T00:00:00Z'),
             ('msg_xcur_tie_a', 'ses_xcur_1', 'student', 'tie a', '2026-03-01T00:00:00Z')`,
      );
      // Ground truth: the pair's whole history, read directly (never capped by
      // EXPORT_PAGE_MAX, unlike the repo's own listForStudent).
      const { rows: truth } = await raw.query<{ id: string }>(
        `select m.id from messages m join sessions s on s.id = m.session_id
             where s.teacher_id = $1 and s.student_id = $2
             order by m.created_at asc, m.id asc`,
        [TEACHER, STUDENT],
      );
      expect(truth.length).toBeGreaterThan(MESSAGE_COUNT); // bulk + 2 tie rows
      const tieIdx = truth.findIndex((m) => m.id === 'msg_xcur_tie_a');
      expect(truth[tieIdx + 1]?.id).toBe('msg_xcur_tie_b');

      let after: { createdAt: string; id: string } | undefined;
      const paged: { id: string }[] = [];
      for (;;) {
        const page = await repos.messages.listForStudent(SCOPE, {
          ...(after ? { after } : {}),
          limit: EXPORT_PAGE_MAX,
        });
        paged.push(...page.items.map((m) => ({ id: m.id })));
        if (page.next === null) break;
        after = page.next;
      }
      expect(paged.map((m) => m.id)).toEqual(truth.map((m) => m.id));
    },
  );

  it('messages.listForStudent: malformed cursor is invalid, exact boundary is next = null, next is only {createdAt, id}', async () => {
    // Pair B's whole (exactly-known) history is 3 messages.
    const whole = await repos.messages.listForStudent(SCOPE_B, { limit: EXPORT_PAGE_MAX });
    expect(whole.items.map((m) => m.id)).toEqual([
      'msg_xcur_b',
      'msg_xcur_b_tie_a',
      'msg_xcur_b_tie_b',
    ]);

    // Exact boundary: a limit equal to the total leaves nothing for a next page.
    const exact = await repos.messages.listForStudent(SCOPE_B, { limit: 3 });
    expect(exact.items).toHaveLength(3);
    expect(exact.next).toBeNull();

    // A real next cursor, when there is one, is exactly {createdAt, id}.
    const short = await repos.messages.listForStudent(SCOPE_B, { limit: 2 });
    expect(short.next).not.toBeNull();
    expect(Object.keys(short.next ?? {}).sort()).toEqual(['createdAt', 'id']);
    expect(short.next).toEqual({ createdAt: '2026-04-01T00:02:00.000Z', id: 'msg_xcur_b_tie_a' });

    await expect(
      repos.messages.listForStudent(SCOPE_B, {
        limit: 2,
        after: { createdAt: 'not a date', id: 'msg_xcur_b' },
      }),
    ).rejects.toMatchObject({ kind: 'invalid', method: 'messages.listForStudent' });
    await expect(
      repos.messages.listForStudent(SCOPE_B, {
        limit: 2,
        after: { createdAt: '2026-04-01T00:01:00Z', id: 'not an id!' },
      }),
    ).rejects.toMatchObject({ kind: 'invalid', method: 'messages.listForStudent' });
  });
});

/** The shape `explain (format json)`'s nested `Plan` objects share. */
interface PlanNode {
  'Node Type'?: string;
  'Plan Rows'?: number;
  'Index Cond'?: string;
  'Relation Name'?: string;
  Filter?: string;
  Plans?: PlanNode[];
}

/** Every `"Plan Rows"` figure anywhere in the plan tree, for a gross bound on scanned/sorted rows. */
function collectPlannedRows(node: PlanNode | undefined): number[] {
  if (!node) return [];
  const own = typeof node['Plan Rows'] === 'number' ? [node['Plan Rows']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(collectPlannedRows)];
}

/**
 * The first Index (Only) Scan node anywhere in the plan tree, for its `Index Cond`/`Filter`.
 * `relation`, when given, narrows to the scan over that table (the lateral messages query has
 * two Index Scans -- the outer sessions seek and the inner per-session messages seek -- and the
 * cursor assertions below are about the latter).
 */
function findIndexScan(node: PlanNode | undefined, relation?: string): PlanNode | undefined {
  if (!node) return undefined;
  if (
    node['Node Type']?.includes('Index') &&
    node['Node Type']?.includes('Scan') &&
    (relation === undefined || node['Relation Name'] === relation)
  ) {
    return node;
  }
  for (const child of node.Plans ?? []) {
    const found = findIndexScan(child, relation);
    if (found) return found;
  }
  return undefined;
}
