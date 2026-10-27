// Task 12.2b on Postgres: staff take down a document or an agent and lift it again. A document
// takedown removes the document's chunks from retrieval (text, vector and term stats), probe,
// leakCheck's material and the outline drafter's read at once; an agent takedown suspends the
// agent. Every write is staff-only and audited, and a takedown racing publish.goLive on one agent
// never deadlocks. See test/pg.ts. All data is synthetic.
import { demoAgentConfig } from '@edmate/contracts/fixtures';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  PublishRefusedError,
  type Repositories,
  RepositoryError,
  retrievalIndexFor,
  TAKEDOWNS_ACTIVE_MAX_LIMIT,
} from '../src/index.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import { scriptedEmbedder, scriptedVector } from './retrieval-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('takedowns tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const STAFF = 'stf_td_1';
const A = { teacherId: teacherId('A') };
const OPEN = ids.module('A', 1);
const LOCKED = ids.module('A', 2);
const DOC = 'doc_td_a';
const KEEP = 'doc_td_keep';
const NOTE_DOC = 'doc_td_locked';
const DOC_TEXT = 'chlorophyll absorbs sunlight to power photosynthesis in green leaves';
const KEEP_TEXT = 'mitochondria release energy from glucose during cellular respiration';
/** A locked module's sentence: leakCheck must flag it while its document is up. */
const SPAN = 'the quiet harbour lamps were lit one by one at dusk by the keeper';

async function failure(p: Promise<unknown>): Promise<RepositoryError> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return e as RepositoryError;
}

const count = async (sql: string, values: unknown[] = []) =>
  Number(Object.values((await raw.query<Record<string, string>>(sql, values)).rows[0] ?? {})[0]);
const agentRow = async (agentId: string) =>
  (
    await raw.query<{ status: string; live_version: number | null }>(
      'select status, live_version from agents where id = $1',
      [agentId],
    )
  ).rows[0]!;
const revision = () => repos.retrieval.revision(A);

async function material(docId: string, moduleId: string, text: string): Promise<void> {
  await repos.documents.create(A, {
    id: docId,
    moduleId,
    kind: 'material',
    sourceTitle: docId,
    rightsDeclared: true,
  });
  const { ids: chunkIds } = await repos.chunks.insertMany(A, docId, [
    { ord: 0, text, locator: 'p1' },
  ]);
  await repos.chunks.setEmbeddings(
    A,
    chunkIds.map((id) => ({ id, embedding: scriptedVector(text) })),
  );
  await raw.query(`update documents set status = 'ready' where id = $1`, [docId]);
}

/** A fresh, publishable teacher (verified profile, course, card, draft agent v1, package v1). */
let n = 0;
async function makeTeacher() {
  const k = ++n;
  const t = {
    teacherId: `tch_tdp${k}`,
    agentId: `agt_tdp${k}`,
    pkgId: `pkg_tdp${k}`,
    courseId: `crs_tdp${k}`,
    styleCardId: `sty_tdp${k}`,
  };
  const q = (text: string, values: unknown[]) => raw.query(text, values);
  await q(
    `insert into users (id, name, locale, market, role) values ($1, 'TD Teacher', 'en', 'test', 'teacher')`,
    [t.teacherId],
  );
  await q(
    `insert into teacher_profiles (id, user_id, slug, subject, verification_status)
     values ($1, $2, $3, 'maths', 'verified')`,
    [`tp_tdp${k}`, t.teacherId, `td-teacher-${k}`],
  );
  await q(`insert into courses (id, teacher_id, title, "order") values ($1, $2, 'C', 0)`, [
    t.courseId,
    t.teacherId,
  ]);
  await q(`insert into style_cards (id, teacher_id, version, text) values ($1, $2, 1, 'card')`, [
    t.styleCardId,
    t.teacherId,
  ]);
  await q(`insert into agents (id, teacher_id, status) values ($1, $2, 'draft')`, [
    t.agentId,
    t.teacherId,
  ]);
  await q(
    `insert into agent_versions (id, teacher_id, agent_id, version, config) values ($1, $2, $3, 1, $4)`,
    [
      `av_tdp${k}`,
      t.teacherId,
      t.agentId,
      JSON.stringify({
        ...demoAgentConfig,
        id: t.agentId,
        version: 1,
        teacherId: t.teacherId,
        courseId: t.courseId,
        styleCardId: t.styleCardId,
      }),
    ],
  );
  await q(`insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, 'P')`, [
    t.pkgId,
    t.teacherId,
    t.agentId,
  ]);
  await q(
    `insert into package_versions (id, teacher_id, package_id, version, config) values ($1, $2, $3, 1, '{}'::jsonb)`,
    [`pv_tdp${k}`, t.teacherId, t.pkgId],
  );
  return t;
}

/** `makeTeacher`, but the agent starts already `live` (version 1): `setVerification(safety)`
 * only locks agents whose status is already `live` for that teacher, so a lock-order race
 * against it needs a live agent going in. */
async function makeLiveTeacher() {
  const t = await makeTeacher();
  await raw.query(`update agents set status = 'live', live_version = 1 where id = $1`, [t.agentId]);
  return t;
}

const GATE = {
  passRate: 1,
  summary: {
    groups: [
      { origin: 'platform', group: 'accuracy', total: 1, passed: 1, minPercent: 99, pass: true },
    ],
    stats: { cases: 1, notRun: 0, deadlinePassed: false },
    costMicroUsd: 1,
  },
  scorecard: {
    pass: true,
    changes: ['first_publish'],
    categories: (['hints_before_answers', 'locked_content', 'accuracy'] as const).map((key) => ({
      key,
      measured: false,
      total: 0,
      passed: 0,
      percent: null,
      pass: false,
      byOrigin: [],
    })),
  },
} as const;

async function lockWaiters(want: number): Promise<void> {
  for (let i = 0; i < 500; i++) {
    await raw.query('select pg_stat_clear_snapshot()');
    const got = await count(
      `select count(*)::int as n from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (got >= want) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`fewer than ${want} lock waiters`);
}
const settle = <T>(p: Promise<T>) =>
  p.then(
    (r) => r,
    (e: unknown) => e,
  );

describe.skipIf(!up)(`takedowns on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, email, locale, market, role) values
       ($1, 'Staff One', 'staff-one@example.test', 'en', 'test', 'staff')`,
      [STAFF],
    );
    await raw.query(
      `insert into teacher_profiles (id, user_id, slug, subject, verification_status) values
       ('tp_a', $1, 'teacher-a', 'Maths', 'verified'), ('tp_b', $2, 'teacher-b', 'Maths', 'verified')`,
      [teacherId('A'), teacherId('B')],
    );
    await material(DOC, OPEN, DOC_TEXT);
    await material(KEEP, OPEN, KEEP_TEXT);
    await material(NOTE_DOC, LOCKED, SPAN);
    // An agent that was never live: a lift returns it to draft.
    await raw.query(
      `insert into agents (id, teacher_id, status) values ('agt_td_draft', $1, 'draft')`,
      [teacherId('B')],
    );
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  beforeEach(async () => {
    await raw.query('delete from takedowns');
    await raw.query('delete from reports');
    await raw.query("update agents set status = 'live' where id in ('agt_a', 'agt_b')");
    await raw.query("update agents set status = 'draft' where id = 'agt_td_draft'");
  });

  describe('a document takedown removes material from retrieval at once (acceptance)', () => {
    it('search, probe, leakCheck and listForModule skip it; lift brings it back', async () => {
      const index = retrievalIndexFor(repos, { embedder: scriptedEmbedder, leakTimeoutMs: 5_000 });
      const scope = { teacherId: A.teacherId, allowedModuleIds: [OPEN] };
      const probeScope = { teacherId: A.teacherId, moduleIds: [OPEN] };
      const docsOf = async (q: string) =>
        (await index.search(q, scope, 10)).map((c) => c.documentId);
      const outline = async () => (await repos.chunks.listForModule(A, OPEN)).map((c) => c.text);

      expect(await docsOf(DOC_TEXT)).toContain(DOC);
      expect((await index.probe(DOC_TEXT, probeScope)).hit).toBe(true);
      expect(await index.leakCheck([SPAN], scope)).toEqual({ hit: true });
      expect(await outline()).toContain(DOC_TEXT);
      const rev0 = await revision();

      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: DOC,
        category: 'copyright',
        note: 'staff note',
      });
      // The very next reads, on the same index instance: no cache, no job.
      expect(await docsOf(DOC_TEXT)).not.toContain(DOC);
      expect(await docsOf(KEEP_TEXT)).toContain(KEEP);
      const probed = await index.probe(DOC_TEXT, probeScope);
      expect(probed.hit).toBe(false);
      expect(await outline()).toEqual([KEEP_TEXT]);
      expect(await revision()).toBe(rev0 + 1);
      // The chunks are kept (a filter, not a delete).
      expect(await count('select count(*) from chunks where document_id = $1', [DOC])).toBe(1);

      const { id: lockedId } = await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: NOTE_DOC,
        category: 'copyright',
      });
      expect(await repos.retrieval.material(A)).not.toContainEqual({
        moduleId: LOCKED,
        text: SPAN,
      });
      expect(await index.leakCheck([SPAN], scope)).toEqual({ hit: false });

      await repos.takedowns.lift(STAFF, id, {});
      await repos.takedowns.lift(STAFF, lockedId, { note: 'counter notice accepted' });
      expect(await docsOf(DOC_TEXT)).toContain(DOC);
      expect((await index.probe(DOC_TEXT, probeScope)).hit).toBe(true);
      expect(await index.leakCheck([SPAN], scope)).toEqual({ hit: true });
      expect(await outline()).toContain(DOC_TEXT);
      expect(await revision()).toBe(rev0 + 4);
    });

    it('full text alone (no embedder) also skips it, and term stats ignore it', async () => {
      const index = retrievalIndexFor(repos);
      const scope = { teacherId: A.teacherId, allowedModuleIds: [OPEN] };
      expect((await index.search('chlorophyll', scope, 5)).map((c) => c.documentId)).toEqual([DOC]);
      await repos.takedowns.create(STAFF, { kind: 'document', targetId: DOC, category: 'harmful' });
      expect(await index.search('chlorophyll', scope, 5)).toEqual([]);
    });

    it('survives the teacher replacing the same document id', async () => {
      await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: DOC,
        category: 'copyright',
      });
      await repos.documents.startReplace(A, DOC, {
        storageKey: 'uploads/replaced.pdf',
        rightsDeclared: true,
      });
      await repos.chunks.insertMany(A, DOC, [{ ord: 0, text: DOC_TEXT, locator: 'p1' }]);
      await raw.query(`update documents set status = 'ready' where id = $1`, [DOC]);
      const index = retrievalIndexFor(repos);
      const scope = { teacherId: A.teacherId, allowedModuleIds: [OPEN] };
      expect(await index.search('chlorophyll', scope, 5)).toEqual([]);
    });

    it('the filter probes takedowns_target_idx', async () => {
      await repos.takedowns.create(STAFF, { kind: 'document', targetId: KEEP, category: 'other' });
      await raw.query('begin');
      try {
        // A realistic shape (thousands of active takedowns, so `status = 'active'` is not
        // selective), rolled back afterwards.
        await raw.query(
          `insert into takedowns (id, target, reason, status)
           select 'td_x' || g, 'document:doc_x' || g, 'other', 'active'
           from generate_series(1, 5000) g`,
        );
        await raw.query('analyze takedowns');
        await raw.query('set local enable_seqscan = off');
        const plan = await raw.query<{ 'QUERY PLAN': string }>(
          `explain select c.id from chunks c where c.teacher_id = $1 and not exists (
             select 1 from takedowns td where td.target = 'document:' || c.document_id
             and td.status = 'active')`,
          [A.teacherId],
        );
        expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('takedowns_target_idx');
      } finally {
        await raw.query('rollback');
      }
    });
  });

  describe('an agent takedown suspends the agent', () => {
    it('owner is null and publish is refused while suspended; lift makes it live again', async () => {
      expect(await repos.agents.owner({ agentId: 'agt_a' })).toEqual(A);
      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'agent',
        targetId: 'agt_a',
        category: 'harmful',
      });
      expect(await agentRow('agt_a')).toEqual({ status: 'suspended', live_version: 1 });
      expect(await repos.agents.owner({ agentId: 'agt_a' })).toBeNull();
      // Material revision untouched by an agent takedown.
      const rev = await revision();

      await expect(repos.takedowns.lift(STAFF, id, { note: 'reviewed' })).resolves.toEqual({
        id,
        status: 'lifted',
        agentStatus: 'live',
      });
      expect(await agentRow('agt_a')).toEqual({ status: 'live', live_version: 1 });
      expect(await repos.agents.owner({ agentId: 'agt_a' })).toEqual(A);
      expect(await revision()).toBe(rev);
    });

    it('publish.startRun is refused suspended', async () => {
      const t = await makeTeacher();
      await repos.takedowns.create(STAFF, {
        kind: 'agent',
        targetId: t.agentId,
        category: 'other',
      });
      const e = await failure(
        repos.publish.startRun(
          { teacherId: t.teacherId },
          {
            agentId: t.agentId,
            courseId: t.courseId,
            styleCardId: t.styleCardId,
            promptPackVersion: '1.0.0',
            modelPolicy: demoAgentConfig.modelPolicy,
            judgeModel: 'judge-test',
          },
        ),
      );
      expect(e).toBeInstanceOf(PublishRefusedError);
      expect((e as PublishRefusedError).reason).toBe('suspended');
    });

    it.each([
      ['rejected', 'draft', null],
      // Verified-only (9.3e lead decision): a pending teacher is not reopened by a lift either.
      ['pending', 'draft', null],
    ] as const)(
      'a lift while the teacher is %s restores the agent to %s (9.3e)',
      async (status, restored, owner) => {
        const { id } = await repos.takedowns.create(STAFF, {
          kind: 'agent',
          targetId: 'agt_a',
          category: 'harmful',
        });
        await raw.query(`update teacher_profiles set verification_status = $1 where id = 'tp_a'`, [
          status,
        ]);
        try {
          await repos.takedowns.lift(STAFF, id, {});
          expect(await agentRow('agt_a')).toEqual({ status: restored, live_version: 1 });
          expect(await repos.agents.owner({ agentId: 'agt_a' })).toEqual(owner);
          const [audit] = (
            await raw.query<{ after: Record<string, unknown> }>(
              `select after from audit_log where action = 'takedown.lift' and target = 'agent:agt_a'
               order by created_at desc, id desc limit 1`,
            )
          ).rows;
          expect(audit?.after).toMatchObject({ agentStatus: restored });
        } finally {
          await raw.query(
            `update teacher_profiles set verification_status = 'verified' where id = 'tp_a'`,
          );
        }
      },
    );

    it('a safety-rejected teacher who edits their subject (pending) stays off after a lift (9.3e)', async () => {
      await repos.teacherProfiles.setVerification(
        { teacherId: teacherId('A') },
        { by: STAFF, status: 'rejected', reason: 'safety', safety: true },
      );
      try {
        expect((await agentRow('agt_a')).status).toBe('suspended');
        const edited = await repos.teacherProfiles.update(
          { teacherId: teacherId('A') },
          { subject: 'Physics' },
        );
        expect(edited.verificationStatus).toBe('pending');
        const { rows } = await raw.query<{ id: string }>(
          `select id from takedowns where target = 'agent:agt_a' and status = 'active'`,
        );
        expect(rows).toHaveLength(1);
        await repos.takedowns.lift(STAFF, rows[0]!.id, {});
        expect(await agentRow('agt_a')).toEqual({ status: 'draft', live_version: 1 });
        expect(await repos.agents.owner({ agentId: 'agt_a' })).toBeNull();
      } finally {
        await raw.query(
          `update teacher_profiles set verification_status = 'verified', subject = 'Maths' where id = 'tp_a'`,
        );
      }
    });

    it('an agent that was never live goes back to draft on lift', async () => {
      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'agent',
        targetId: 'agt_td_draft',
        category: 'inappropriate',
      });
      expect((await agentRow('agt_td_draft')).status).toBe('suspended');
      await repos.takedowns.lift(STAFF, id, {});
      expect(await agentRow('agt_td_draft')).toEqual({ status: 'draft', live_version: null });
    });

    it('an agent with no teacher_profiles row at all restores to draft on lift', async () => {
      // Same pattern as makeTeacher, minus the teacher_profiles insert.
      await raw.query(
        `insert into users (id, name, locale, market, role) values ($1, 'No Profile', 'en', 'test', 'teacher')`,
        ['tch_td_noprofile'],
      );
      await raw.query(
        `insert into agents (id, teacher_id, status, live_version) values ($1, $2, 'live', 1)`,
        ['agt_td_noprofile', 'tch_td_noprofile'],
      );
      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'agent',
        targetId: 'agt_td_noprofile',
        category: 'other',
      });
      await expect(repos.takedowns.lift(STAFF, id, {})).resolves.toEqual({
        id,
        status: 'lifted',
        agentStatus: 'draft',
      });
      expect(await agentRow('agt_td_noprofile')).toEqual({ status: 'draft', live_version: 1 });
    });
  });

  describe('rules', () => {
    it('only staff, right now: everyone else is scope and nothing is written', async () => {
      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'agent',
        targetId: 'agt_b',
        category: 'other',
      });
      for (const by of [teacherId('A'), teacherId('B'), studentId('1'), 'stf_ghost']) {
        expect(
          (
            await failure(
              repos.takedowns.create(by, { kind: 'document', targetId: DOC, category: 'other' }),
            )
          ).kind,
        ).toBe('scope');
        expect((await failure(repos.takedowns.lift(by, id, {}))).kind).toBe('scope');
        expect((await failure(repos.takedowns.listActiveForStaff(by))).kind).toBe('scope');
      }
      expect(await count("select count(*) from takedowns where status = 'active'")).toBe(1);
      expect(await agentRow('agt_b')).toEqual({ status: 'suspended', live_version: 1 });
    });

    it('a missing target is not_found; a second active takedown on a target is invalid', async () => {
      for (const kind of ['document', 'agent'] as const) {
        expect(
          (
            await failure(
              repos.takedowns.create(STAFF, { kind, targetId: 'nope', category: 'other' }),
            )
          ).kind,
        ).toBe('not_found');
      }
      await repos.takedowns.create(STAFF, { kind: 'document', targetId: DOC, category: 'other' });
      const rev = await revision();
      expect(
        (
          await failure(
            repos.takedowns.create(STAFF, { kind: 'document', targetId: DOC, category: 'harmful' }),
          )
        ).kind,
      ).toBe('invalid');
      expect(await revision()).toBe(rev);
      expect(await count('select count(*) from takedowns')).toBe(1);
    });

    it('lifting twice, or a missing takedown, is not_found', async () => {
      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: KEEP,
        category: 'other',
      });
      await repos.takedowns.lift(STAFF, id, {});
      expect((await failure(repos.takedowns.lift(STAFF, id, {}))).kind).toBe('not_found');
      expect((await failure(repos.takedowns.lift(STAFF, 'td_missing', {}))).kind).toBe('not_found');
      // A lifted target can be taken down again.
      await repos.takedowns.create(STAFF, { kind: 'document', targetId: KEEP, category: 'other' });
    });

    it('a takedown whose target vanished or is malformed is integrity on lift', async () => {
      await raw.query(
        `insert into takedowns (id, target, reason, status) values
         ('td_bad', 'teacher:tch_a', 'other', 'active'), ('td_gone', 'agent:agt_gone', 'other', 'active')`,
      );
      expect((await failure(repos.takedowns.lift(STAFF, 'td_bad', {}))).kind).toBe('integrity');
      expect((await failure(repos.takedowns.lift(STAFF, 'td_gone', {}))).kind).toBe('integrity');
      // A stored target the list can't parse fails the read loudly, like every repository read.
      await raw.query(
        `insert into takedowns (id, target, reason, status) values ('td_odd', 'document:a b', 'other', 'active')`,
      );
      expect((await failure(repos.takedowns.lift(STAFF, 'td_odd', {}))).kind).toBe('integrity');
      expect((await failure(repos.takedowns.listActiveForStaff(STAFF))).kind).toBe('integrity');
    });

    it('create and lift are audited and append staff actions', async () => {
      await raw.query(
        "delete from audit_log where target like 'document:%' or target like 'agent:%'",
      );
      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: DOC,
        category: 'copyright',
        note: 'notice 1',
      });
      await repos.takedowns.lift(STAFF, id, { note: 'notice withdrawn' });
      const audit = await raw.query(
        `select actor, actor_role, action, target, teacher_id, reason, before, after
         from audit_log where target = $1 order by created_at, action`,
        [`document:${DOC}`],
      );
      expect(audit.rows).toEqual([
        {
          actor: STAFF,
          actor_role: 'staff',
          action: 'takedown.create',
          target: `document:${DOC}`,
          teacher_id: A.teacherId,
          reason: 'notice 1',
          before: { takedown: null },
          after: { takedown: id, status: 'active', category: 'copyright', reportId: null },
        },
        {
          actor: STAFF,
          actor_role: 'staff',
          action: 'takedown.lift',
          target: `document:${DOC}`,
          teacher_id: A.teacherId,
          reason: 'notice withdrawn',
          before: { takedown: id, status: 'active' },
          after: { takedown: id, status: 'lifted' },
        },
      ]);
      const row = (
        await raw.query<{
          status: string;
          reason: string;
          staff_actions: { action: string; actor: string; note: string | null }[];
        }>('select status, reason, staff_actions from takedowns where id = $1', [id])
      ).rows[0]!;
      expect(row.status).toBe('lifted');
      expect(row.reason).toBe('copyright');
      expect(row.staff_actions.map(({ action, actor, note }) => ({ action, actor, note }))).toEqual(
        [
          { action: 'create', actor: STAFF, note: 'notice 1' },
          { action: 'lift', actor: STAFF, note: 'notice withdrawn' },
        ],
      );
    });

    it('lists active takedowns newest first with kind, target, teacher slug and category', async () => {
      const first = await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: DOC,
        category: 'copyright',
      });
      const second = await repos.takedowns.create(STAFF, {
        kind: 'agent',
        targetId: 'agt_b',
        category: 'harmful',
      });
      const lifted = await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: KEEP,
        category: 'other',
      });
      await repos.takedowns.lift(STAFF, lifted.id, {});
      const rows = await repos.takedowns.listActiveForStaff(STAFF);
      expect(rows.map(({ createdAt: _c, ...r }) => r)).toEqual([
        {
          id: second.id,
          kind: 'agent',
          targetId: 'agt_b',
          teacherId: teacherId('B'),
          teacherSlug: 'teacher-b',
          category: 'harmful',
        },
        {
          id: first.id,
          kind: 'document',
          targetId: DOC,
          teacherId: A.teacherId,
          teacherSlug: 'teacher-a',
          category: 'copyright',
        },
      ]);
      expect(rows[0]!.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(TAKEDOWNS_ACTIVE_MAX_LIMIT).toBe(200);
    });
  });

  describe('report linking', () => {
    const file = () =>
      repos.reports.file(
        { studentId: studentId('1'), teacherId: teacherId('A') },
        { sessionId: ids.session('1A'), messageId: 'msg_1a_2', category: 'harmful' },
      );
    const reportStatus = async (id: string) =>
      (await raw.query<{ status: string }>('select status from reports where id = $1', [id]))
        .rows[0]!.status;

    it('an open report about the same teacher is set actioned and audited', async () => {
      const { id: reportId } = await file();
      const { id } = await repos.takedowns.create(STAFF, {
        kind: 'document',
        targetId: DOC,
        category: 'harmful',
        reportId,
        note: 'confirmed',
      });
      expect(await reportStatus(reportId)).toBe('actioned');
      expect(
        await count(
          "select count(*) from audit_log where action = 'report.review' and target = $1",
          [`report:${reportId}`],
        ),
      ).toBe(1);
      const after = (
        await raw.query<{ after: unknown }>(
          "select after from audit_log where action = 'takedown.create' and after->>'takedown' = $1",
          [id],
        )
      ).rows[0]!.after;
      expect(after).toMatchObject({ reportId });
      // The report is closed: a second takedown can't link it.
      expect(
        (
          await failure(
            repos.takedowns.create(STAFF, {
              kind: 'agent',
              targetId: 'agt_a',
              category: 'harmful',
              reportId,
            }),
          )
        ).kind,
      ).toBe('invalid');
      expect(await agentRow('agt_a')).toEqual({ status: 'live', live_version: 1 });
      // Another student's report on the same teacher, linked without a note, to an agent takedown.
      const { id: second } = await repos.reports.file(
        { studentId: studentId('2'), teacherId: teacherId('A') },
        { sessionId: ids.session('2A'), messageId: 'msg_2a_2', category: 'other' },
      );
      await repos.takedowns.create(STAFF, {
        kind: 'agent',
        targetId: 'agt_a',
        category: 'other',
        reportId: second,
      });
      expect(await reportStatus(second)).toBe('actioned');
      expect((await agentRow('agt_a')).status).toBe('suspended');
    });

    it('a report about another teacher, or a missing one, is invalid and nothing is written', async () => {
      const { id: reportId } = await file();
      const rev = await revision();
      for (const [kind, targetId, rid] of [
        ['agent', 'agt_b', reportId],
        ['document', DOC, 'rp_missing'],
      ] as const) {
        expect(
          (
            await failure(
              repos.takedowns.create(STAFF, { kind, targetId, category: 'harmful', reportId: rid }),
            )
          ).kind,
        ).toBe('invalid');
      }
      expect(await reportStatus(reportId)).toBe('open');
      expect(await count('select count(*) from takedowns')).toBe(0);
      expect(await agentRow('agt_b')).toEqual({ status: 'live', live_version: 1 });
      expect(await revision()).toBe(rev);
    });
  });

  // Task 12.3b: repeat-infringer counting. Count only: nothing reads it to enforce yet (12.3d).
  describe("countUpheld counts a teacher's active copyright takedowns", () => {
    const B = { teacherId: teacherId('B') };
    const down = (kind: 'document' | 'agent', targetId: string, category = 'copyright') =>
      repos.takedowns.create(STAFF, { kind, targetId, category } as never);

    it("counts active copyright takedowns on the teacher's own documents and agents only", async () => {
      expect(await repos.takedowns.countUpheld(A)).toBe(0);
      expect(await repos.takedowns.countUpheld(B)).toBe(0);
      await down('document', DOC);
      await down('agent', ids.agent('A'));
      // Not copyright: not counted.
      await down('document', KEEP, 'harmful');
      // Lifted: reversed, not counted.
      const lifted = await down('document', NOTE_DOC);
      await repos.takedowns.lift(STAFF, lifted.id, {});
      // Another teacher's.
      await down('agent', ids.agent('B'));
      expect(await repos.takedowns.countUpheld(A)).toBe(2);
      expect(await repos.takedowns.countUpheld(B)).toBe(1);
      expect(await repos.takedowns.countUpheld({ teacherId: 'tch_nobody' })).toBe(0);
    });

    it('a target or status 12.2 never writes is not counted', async () => {
      await raw.query(
        `insert into takedowns (id, target, reason, status) values
         ('tkd_raw_1', $1, 'copyright', 'active'),
         ('tkd_raw_2', 'document:' || $2, 'copyright', 'upheld'),
         ('tkd_raw_3', 'document:' || $2, 'copyright', 'open')`,
        [`teacher:${teacherId('A')}`, DOC],
      );
      expect(await repos.takedowns.countUpheld(A)).toBe(0);
    });

    it('still counts after the teacher deletes the taken-down document', async () => {
      const gone = 'doc_td_gone';
      await material(gone, OPEN, 'osmosis moves water across a membrane toward salt');
      await down('document', gone);
      expect(await repos.takedowns.countUpheld(A)).toBe(1);
      await repos.documents.delete(A, gone);
      expect(await count('select count(*) from documents where id = $1', [gone])).toBe(0);
      expect(await repos.takedowns.countUpheld(A)).toBe(1);
      expect(await repos.takedowns.countUpheld(B)).toBe(0);
    });

    it('a malformed scope is scope, before any SQL', async () => {
      for (const bad of [null, {}, { teacherId: '' }, { teacherId: 'tch_a', extra: 1 }, 'tch_a']) {
        expect((await failure(repos.takedowns.countUpheld(bad as never))).kind).toBe('scope');
      }
    });
  });

  describe('lock order: takedown and publish.goLive on one agent never deadlock', () => {
    for (const first of ['goLive', 'takedown'] as const) {
      it(`${first} queued first: both finish and the agent ends suspended`, async () => {
        for (let i = 0; i < 3; i++) {
          const t = await makeTeacher();
          const scope = { teacherId: t.teacherId };
          const run = await repos.publish.startRun(scope, {
            agentId: t.agentId,
            courseId: t.courseId,
            styleCardId: t.styleCardId,
            promptPackVersion: '1.0.0',
            modelPolicy: demoAgentConfig.modelPolicy,
            judgeModel: 'judge-test',
          });
          expect(await repos.publish.markRunning(scope, run.id)).toBe(true);
          // Hold the agent row so both writers queue on it, in a forced order.
          await raw.query('begin');
          await raw.query('select 1 from agents where id = $1 for update', [t.agentId]);
          const goLive = () =>
            settle(repos.publish.goLive(scope, { runId: run.id, ...GATE } as never));
          const takedown = () =>
            settle(
              repos.takedowns.create(STAFF, {
                kind: 'agent',
                targetId: t.agentId,
                category: 'harmful',
              }),
            );
          const a = first === 'goLive' ? goLive() : takedown();
          await lockWaiters(1);
          const b = first === 'goLive' ? takedown() : goLive();
          await lockWaiters(2);
          await raw.query('commit');
          const [ra, rb] = await Promise.all([a, b]);
          const [live, down] = first === 'goLive' ? [ra, rb] : [rb, ra];
          expect(down).toMatchObject({ id: expect.any(String) });
          if (first === 'goLive') {
            // The takedown committed last: it wins.
            expect(live).toEqual({ agentVersion: 2, packageVersions: { [t.pkgId]: 1 } });
          } else {
            // The takedown committed first: goLive is refused, nothing goes live.
            expect(live).toBeInstanceOf(PublishRefusedError);
            expect((live as PublishRefusedError).reason).toBe('suspended');
          }
          expect((await agentRow(t.agentId)).status).toBe('suspended');
        }
      });
    }
  });

  describe('lock order: setVerification(safety) and publish.goLive on one agent never deadlock', () => {
    for (const first of ['goLive', 'verify'] as const) {
      it(`${first} queued first: both finish, the agent ends suspended`, async () => {
        const t = await makeLiveTeacher();
        const scope = { teacherId: t.teacherId };
        const run = await repos.publish.startRun(scope, {
          agentId: t.agentId,
          courseId: t.courseId,
          styleCardId: t.styleCardId,
          promptPackVersion: '1.0.0',
          modelPolicy: demoAgentConfig.modelPolicy,
          judgeModel: 'judge-test',
        });
        expect(await repos.publish.markRunning(scope, run.id)).toBe(true);
        // Hold the agent row so both writers queue on it, in a forced order.
        await raw.query('begin');
        await raw.query('select 1 from agents where id = $1 for update', [t.agentId]);
        const goLive = () =>
          settle(repos.publish.goLive(scope, { runId: run.id, ...GATE } as never));
        const verify = () =>
          settle(
            repos.teacherProfiles.setVerification(scope, {
              status: 'rejected',
              by: STAFF,
              safety: true,
            }),
          );
        const a = first === 'goLive' ? goLive() : verify();
        await lockWaiters(1);
        const b = first === 'goLive' ? verify() : goLive();
        await lockWaiters(2);
        await raw.query('commit');
        const [ra, rb] = await Promise.all([a, b]);
        const [live, down] = first === 'goLive' ? [ra, rb] : [rb, ra];
        if (first === 'goLive') {
          // goLive committed first (agent still live): it succeeds, then the rejection
          // suspends the now-republished agent.
          expect(live).toEqual({ agentVersion: 2, packageVersions: { [t.pkgId]: 1 } });
          expect(down).toMatchObject({ verificationStatus: 'rejected', agentsTakenDown: 1 });
        } else {
          // The rejection committed first (and holds the profile row until it commits):
          // goLive's own `lockVerified` (profile FOR SHARE, taken before the agent) blocks on
          // it, and once it unblocks the teacher is no longer verified, so goLive is refused
          // before it ever reaches the agent check.
          expect(down).toMatchObject({ verificationStatus: 'rejected', agentsTakenDown: 1 });
          expect(live).toBeInstanceOf(RepositoryError);
          expect((live as RepositoryError).kind).toBe('scope');
        }
        expect((await agentRow(t.agentId)).status).toBe('suspended');
      });
    }
  });

  describe('lock order: setVerification(safety) and takedowns.create on one agent never deadlock', () => {
    for (const first of ['create', 'verify'] as const) {
      it(`${first} queued first: both finish, the agent ends suspended`, async () => {
        const t = await makeLiveTeacher();
        const scope = { teacherId: t.teacherId };
        // Hold the agent row so both writers queue on it, in a forced order.
        await raw.query('begin');
        await raw.query('select 1 from agents where id = $1 for update', [t.agentId]);
        const create = () =>
          settle(
            repos.takedowns.create(STAFF, {
              kind: 'agent',
              targetId: t.agentId,
              category: 'harmful',
            }),
          );
        const verify = () =>
          settle(
            repos.teacherProfiles.setVerification(scope, {
              status: 'rejected',
              by: STAFF,
              safety: true,
            }),
          );
        const a = first === 'create' ? create() : verify();
        await lockWaiters(1);
        const b = first === 'create' ? verify() : create();
        await lockWaiters(2);
        await raw.query('commit');
        const [ra, rb] = await Promise.all([a, b]);
        const [c, v] = first === 'create' ? [ra, rb] : [rb, ra];
        if (first === 'create') {
          // create committed first: it makes the agent's own takedown. The rejection then
          // finds the agent already suspended (not `live`), so it never locks it at all --
          // no takedown, no stale-row audit, zero agents taken down.
          expect(c).toMatchObject({ id: expect.any(String) });
          expect(v).toMatchObject({ verificationStatus: 'rejected', agentsTakenDown: 0 });
        } else {
          // The rejection committed first: it already made its own takedown on the agent, so
          // the direct create call sees an active takedown on the same target and is `invalid`.
          expect(v).toMatchObject({ verificationStatus: 'rejected', agentsTakenDown: 1 });
          expect(c).toBeInstanceOf(RepositoryError);
          expect((c as RepositoryError).kind).toBe('invalid');
        }
        expect((await agentRow(t.agentId)).status).toBe('suspended');
      });
    }
  });
});
