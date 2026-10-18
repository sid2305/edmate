// Acceptance for task 1.2: cross-teacher and cross-student reads and writes fail closed, on a real
// Postgres 16 + pgvector (see test/pg.ts for how to start one; skipped locally without one, fails
// in CI).
//
// CASES is typed Record<RepositoryMethod, IsolationCase>, so a repository method without a case
// fails `tsc`; a runtime check also compares the methods on createRepositories(db) with CASES.
// Every case runs over the whole grid: every actor scope x every target in the seed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvidenceEvent, LearnerProfile, Message } from '@edmate/contracts';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  openDatabase,
  RepositoryError,
  type RepositoryMethod,
  type StudentScope,
  type TeacherScope,
  transcriptStoreFor,
} from '../src/index.js';
import { DATA_MODEL_TABLES } from './helpers.js';
import {
  agentConfig,
  ids,
  packageConfig,
  PAIRS,
  type Pair,
  seed,
  studentId,
  studentOf,
  type Teacher,
  teacherId,
  teacherOf,
  TEACHERS,
} from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

type Repos = ReturnType<typeof createRepositories>;

const tScope = (t: Teacher): TeacherScope => ({ teacherId: teacherId(t) });
const sScope = (p: Pair): StudentScope => ({
  studentId: studentId(studentOf(p)),
  teacherId: teacherId(teacherOf(p)),
});

/** The owner markers (`[1A]`, `[A]`) in a string. */
function markers(text: string): string[] {
  return [...text.matchAll(/\[(\w+)\]/g)].map((m) => m[1]!);
}
/** The pair a student scope's ids name, for example `1A`. */
const pairOfIds = (sid: string, tid: string) => `${sid.slice(4)}${tid.slice(4).toUpperCase()}`;
const teacherOfId = (tid: string) => tid.slice(4).toUpperCase();

interface ReadCase<K extends string, S> {
  op: 'read';
  /** Untargeted methods read "the scope's own" rows (no target id); the grid is actor-only. */
  targeted: boolean;
  call: (r: Repos, scope: S, target: K) => Promise<unknown>;
  /** The same call with a random well-formed target id (or random scope ids when untargeted). */
  random: (r: Repos, scope: S, rid: string) => Promise<unknown>;
  /** The owner key (`A` or `1A`) of every row in the result; [] for null or an empty list. */
  owners: (result: never) => string[];
}

interface WriteCase<K extends string, S> {
  op: 'write';
  /** Whether `actor` may write to `target` (default: actor === target). */
  owns?: (actor: K, target: K) => boolean;
  /** A write by `actor` aimed at `target` (target's ids or rows). */
  attempt: (r: Repos, scope: S, actor: K, target: K) => Promise<unknown>;
  /** After a successful attempt: the owner can read it back and nobody else can. */
  verify: (r: Repos, actor: K, result: unknown) => Promise<void>;
  /** Payload-mismatch writes by `actor` that must fail with `kind` and write nothing. */
  mismatches?: (actor: K) => [label: string, run: (r: Repos) => Promise<unknown>, kind: string][];
}

type IsolationCase =
  | ({ scope: 'teacher' } & (ReadCase<Teacher, TeacherScope> | WriteCase<Teacher, TeacherScope>))
  | ({ scope: 'student' } & (ReadCase<Pair, StudentScope> | WriteCase<Pair, StudentScope>));

let counter = 0;
const uid = (prefix: string) => `${prefix}_${++counter}`;

/** Asserts `who` sees `expected` (owner) and every other student scope sees nothing. */
async function onlyPairSees(
  read: (scope: StudentScope) => Promise<unknown>,
  owner: Pair,
  seen: (x: unknown) => boolean,
) {
  for (const p of PAIRS) {
    expect(seen(await read(sScope(p))), `${p} reading ${owner}'s write`).toBe(p === owner);
  }
}

const CASES: Record<RepositoryMethod, IsolationCase> = {
  'agentVersions.get': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.agentVersions.get(scope, { agentId: ids.agent(t), version: 1 }),
    random: (r, scope, rid) => r.agentVersions.get(scope, { agentId: rid, version: 1 }),
    owners: (c: { teacherId: string } | null) => (c ? [teacherOfId(c.teacherId)] : []),
  },
  'packageVersions.get': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.packageVersions.get(scope, { packageId: ids.pkg(t), version: 1 }),
    random: (r, scope, rid) => r.packageVersions.get(scope, { packageId: rid, version: 1 }),
    owners: (c: { name: string; teacherId: string } | null) =>
      c ? [...markers(c.name), teacherOfId(c.teacherId)] : [],
  },
  'packageVersions.create': {
    scope: 'teacher',
    op: 'write',
    attempt: async (r, scope, _actor, target) => {
      const config = packageConfig(target, ++counter + 100, [
        ids.module(target, 1),
        ids.module(target, 2),
      ]);
      await r.packageVersions.create(scope, config);
      return config.version;
    },
    verify: async (r, actor, version) => {
      for (const t of TEACHERS) {
        const got = await r.packageVersions.get(tScope(t), {
          packageId: ids.pkg(actor),
          version: version as number,
        });
        expect(got !== null, `${t} reading ${actor}'s new package version`).toBe(t === actor);
      }
    },
    mismatches: (a) => {
      const other: Teacher = a === 'A' ? 'B' : 'A';
      const mine = () => packageConfig(a, ++counter + 100);
      return [
        [
          "another teacher's module",
          (r) =>
            r.packageVersions.create(tScope(a), {
              ...mine(),
              moduleIds: [ids.module(a, 1), ids.module(other, 1)],
            }),
          'scope',
        ],
        [
          'a module that does not exist',
          (r) => r.packageVersions.create(tScope(a), { ...mine(), moduleIds: ['mod_nowhere'] }),
          'scope',
        ],
        [
          "another teacher's package",
          (r) =>
            r.packageVersions.create(tScope(a), {
              ...mine(),
              id: ids.pkg(other),
              agentId: ids.agent(other),
            }),
          'not_found',
        ],
        [
          "another teacher's agent on my package",
          (r) => r.packageVersions.create(tScope(a), { ...mine(), agentId: ids.agent(other) }),
          'not_found',
        ],
        [
          'an existing version (immutable)',
          (r) => r.packageVersions.create(tScope(a), packageConfig(a, 1)),
          'invalid',
        ],
        [
          'an invalid config',
          (r) => r.packageVersions.create(tScope(a), { ...mine(), helpCeiling: 9 as never }),
          'invalid',
        ],
      ];
    },
  },
  'teacherQuestions.listForTeacher': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.teacherQuestions.listForTeacher(scope, { status: 'open', limit: 200 }),
    random: (r, _scope, rid) =>
      r.teacherQuestions.listForTeacher({ teacherId: rid }, { status: 'open', limit: 200 }),
    owners: (rows: { text: string; teacherId: string }[]) =>
      rows.flatMap((q) => [...markers(q.text).map((m) => m.slice(-1)), teacherOfId(q.teacherId)]),
  },
  'sessions.create': {
    scope: 'student',
    op: 'write',
    owns: (a, t) => teacherOf(a) === teacherOf(t),
    attempt: (r, scope, _a, target) =>
      r.sessions.create(scope, { agentId: ids.agent(teacherOf(target)), agentVersion: 1 }),
    verify: async (r, actor, res) => {
      const { id } = res as { id: string };
      await onlyPairSees(
        (sc) => r.sessions.get(sc, id),
        actor,
        (x) => x !== null,
      );
    },
    mismatches: (a) => [
      [
        'a version that does not exist',
        (r) => r.sessions.create(sScope(a), { agentId: ids.agent(teacherOf(a)), agentVersion: 99 }),
        'not_found',
      ],
      [
        'an agent that does not exist',
        (r) => r.sessions.create(sScope(a), { agentId: 'agt_nowhere', agentVersion: 1 }),
        'not_found',
      ],
    ],
  },
  'sessions.get': {
    scope: 'student',
    op: 'read',
    targeted: true,
    call: (r, scope, p) => r.sessions.get(scope, ids.session(p)),
    random: (r, scope, rid) => r.sessions.get(scope, rid),
    owners: (x: { studentId: string; teacherId: string; summary: string | null } | null) =>
      x ? [pairOfIds(x.studentId, x.teacherId), ...markers(x.summary ?? '')] : [],
  },
  'messages.history': {
    scope: 'student',
    op: 'read',
    targeted: true,
    call: (r, scope, p) => r.messages.history(scope, ids.session(p), 200),
    random: (r, scope, rid) => r.messages.history(scope, rid, 200),
    owners: (rows: Message[]) =>
      rows.flatMap((m) => [
        ...markers(m.text),
        ...(m.sources ?? []).flatMap((x) => markers(x.title)),
      ]),
  },
  'messages.append': {
    scope: 'student',
    op: 'write',
    attempt: async (r, scope, actor, target) => {
      const m: Message = {
        id: uid('msg_new'),
        role: 'student',
        text: `[${actor}] appended`,
        createdAt: '2026-10-17T11:00:00Z',
      };
      await r.messages.append(scope, ids.session(target), m);
      return m.id;
    },
    verify: async (r, actor, id) => {
      for (const p of PAIRS) {
        // Every pair reads its own session; only the owner's contains the new message.
        const rows = await r.messages.history(sScope(p), ids.session(p), 200);
        expect(
          rows.some((m) => m.id === id),
          `${p} sees ${actor}'s message`,
        ).toBe(p === actor);
        const theirs = await r.messages.history(sScope(p), ids.session(actor), 200);
        expect(theirs.length > 0, `${p} reads ${actor}'s session`).toBe(p === actor);
      }
    },
    mismatches: (a) => [
      [
        'a message that fails the contract',
        (r) =>
          r.messages.append(sScope(a), ids.session(a), {
            id: 'bad id!',
            role: 'student',
            text: 'x',
            createdAt: 'yesterday',
          }),
        'invalid',
      ],
    ],
  },
  'turnTraces.insert': {
    scope: 'student',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.turnTraces.insert(scope, ids.session(target), {
        steps: [{ name: `[${actor}] new`, ms: 1, outcome: 'ok' }],
        model: 'scripted',
        inputTokens: 1,
        outputTokens: 1,
        costMicroUsd: 0,
      }),
    verify: async (r, actor) => {
      for (const p of PAIRS) {
        const rows = await r.turnTraces.listForSession(sScope(p), ids.session(actor));
        const mine = rows.some((t) => t.steps.some((st) => st.name === `[${actor}] new`));
        expect(mine, `${p} sees ${actor}'s trace`).toBe(p === actor);
      }
    },
    mismatches: (a) => [
      [
        'negative tokens',
        (r) =>
          r.turnTraces.insert(sScope(a), ids.session(a), {
            steps: [],
            model: 'scripted',
            inputTokens: -1,
            outputTokens: 0,
            costMicroUsd: 0,
          }),
        'invalid',
      ],
    ],
  },
  'turnTraces.listForSession': {
    scope: 'student',
    op: 'read',
    targeted: true,
    call: (r, scope, p) => r.turnTraces.listForSession(scope, ids.session(p)),
    random: (r, scope, rid) => r.turnTraces.listForSession(scope, rid),
    owners: (rows: { sessionId: string; steps: { name: string }[] }[]) =>
      rows.flatMap((t) => t.steps.flatMap((st) => markers(st.name))),
  },
  'learnerProfiles.get': {
    scope: 'student',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.learnerProfiles.get(scope),
    random: (r, _scope, rid) => r.learnerProfiles.get({ studentId: rid, teacherId: rid }),
    owners: (x: LearnerProfile | null) =>
      x
        ? [
            pairOfIds(x.studentId, x.teacherId),
            ...markers(x.lastSummary ?? ''),
            ...x.mistakes.flatMap((m) => markers(m.tag)),
          ]
        : [],
  },
  'learnerProfiles.save': {
    scope: 'student',
    op: 'write',
    attempt: async (r, scope, actor, target) => {
      const profile: LearnerProfile = {
        ...sScope(target),
        lang: 'en',
        mastery: {},
        mistakes: [],
        lastSummary: `[${actor}] saved`,
      };
      await r.learnerProfiles.save(scope, profile);
    },
    verify: async (r, actor) => {
      await onlyPairSees(
        (sc) => r.learnerProfiles.get(sc),
        actor,
        (x) => (x as LearnerProfile | null)?.lastSummary === `[${actor}] saved`,
      );
    },
    mismatches: (a) => [
      [
        'a profile that fails the contract',
        (r) =>
          r.learnerProfiles.save(sScope(a), {
            ...sScope(a),
            lang: 'English',
            mastery: {},
            mistakes: [],
          }),
        'invalid',
      ],
    ],
  },
  'evidenceEvents.append': {
    scope: 'student',
    op: 'write',
    attempt: async (r, scope, _actor, target) => {
      // A timestamp unique to this attempt, so verify finds exactly this write.
      const ts = new Date(Date.UTC(2026, 9, 17, 12, 0, ++counter)).toISOString();
      const event: EvidenceEvent = {
        ...sScope(target),
        topicId: ids.topic(teacherOf(target)),
        correct: true,
        source: 'practice',
        weight: 0.5,
        ts,
      };
      await r.evidenceEvents.append(scope, [event]);
      return ts;
    },
    verify: async (_r, actor, ts) => {
      // No read method for evidence in 1.2: count each pair's events with this write's timestamp.
      for (const p of PAIRS) {
        const res = await rawCount(
          `select count(*)::int as n from evidence_events
            where student_id = $1 and teacher_id = $2 and ts = $3`,
          [studentId(studentOf(p)), teacherId(teacherOf(p)), ts],
        );
        expect(res > 0, `${p} has ${actor}'s evidence`).toBe(p === actor);
      }
    },
    mismatches: (a) => {
      const other: Teacher = teacherOf(a) === 'A' ? 'B' : 'A';
      const good: EvidenceEvent = {
        ...sScope(a),
        topicId: ids.topic(teacherOf(a)),
        correct: true,
        source: 'check',
        weight: 1,
        ts: '2026-10-17T12:00:00Z',
      };
      return [
        [
          "another teacher's topic",
          (r) => r.evidenceEvents.append(sScope(a), [{ ...good, topicId: ids.topic(other) }]),
          'scope',
        ],
        [
          'one good and one foreign event (all or nothing)',
          (r) =>
            r.evidenceEvents.append(sScope(a), [
              good,
              { ...good, studentId: studentId(studentOf(a) === '1' ? '2' : '1') },
            ]),
          'scope',
        ],
        [
          'a topic that does not exist',
          (r) => r.evidenceEvents.append(sScope(a), [good, { ...good, topicId: 'top_nowhere' }]),
          'scope',
        ],
        [
          'an event that fails the contract',
          (r) => r.evidenceEvents.append(sScope(a), [{ ...good, ts: 'now' }]),
          'invalid',
        ],
      ];
    },
  },
  'subscriptions.findLive': {
    scope: 'student',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.subscriptions.findLive(scope),
    random: (r, _scope, rid) => r.subscriptions.findLive({ studentId: rid, teacherId: rid }),
    owners: (x: { id: string; packageVersionId: string } | null) =>
      x ? [x.id.slice(4).toUpperCase()] : [],
  },
  'teacherQuestions.open': {
    scope: 'student',
    op: 'write',
    owns: (a, t) => teacherOf(a) === teacherOf(t),
    attempt: (r, scope, actor, target) =>
      r.teacherQuestions.open(scope, {
        agentId: ids.agent(teacherOf(target)),
        text: `[${actor}] opened`,
        similarIds: [ids.question(target)],
      }),
    verify: async (r, actor, res) => {
      const { id } = res as { id: string };
      await onlyPairSees(
        (sc) => r.teacherQuestions.listForStudent(sc),
        actor,
        (x) => (x as { id: string }[]).some((q) => q.id === id),
      );
      for (const t of TEACHERS) {
        const rows = await r.teacherQuestions.listForTeacher(tScope(t), {
          status: 'open',
          limit: 200,
        });
        expect(
          rows.some((q) => q.id === id),
          `${t} sees ${actor}'s question`,
        ).toBe(t === teacherOf(actor));
      }
    },
    mismatches: (a) => {
      const other: Teacher = teacherOf(a) === 'A' ? 'B' : 'A';
      return [
        [
          "another teacher's agent",
          (r) =>
            r.teacherQuestions.open(sScope(a), {
              agentId: ids.agent(other),
              text: `[${a}] x`,
              similarIds: [],
            }),
          'not_found',
        ],
        [
          "another teacher's question as similar",
          (r) =>
            r.teacherQuestions.open(sScope(a), {
              agentId: ids.agent(teacherOf(a)),
              text: `[${a}] x`,
              similarIds: [ids.question(`${studentOf(a)}${other}` as Pair)],
            }),
          'scope',
        ],
        [
          'an empty question',
          (r) =>
            r.teacherQuestions.open(sScope(a), {
              agentId: ids.agent(teacherOf(a)),
              text: '   ',
              similarIds: [],
            }),
          'invalid',
        ],
      ];
    },
  },
  'teacherQuestions.listForStudent': {
    scope: 'student',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.teacherQuestions.listForStudent(scope),
    random: (r, _scope, rid) =>
      r.teacherQuestions.listForStudent({ studentId: rid, teacherId: rid }),
    owners: (rows: { text: string; studentId: string; teacherId: string }[]) =>
      rows.flatMap((q) => [pairOfIds(q.studentId, q.teacherId), ...markers(q.text)]),
  },
};

/** Seeded PRNG (mulberry32), so random ids are reproducible. */
function prng(seedValue: number) {
  let a = seedValue;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomId(rand: () => number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const len = 1 + Math.floor(rand() * 40);
  return Array.from({ length: len }, () => chars[Math.floor(rand() * chars.length)]).join('');
}

const up = await postgresUp('repository isolation tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repos;
let raw: pg.Client;

async function rawCount(text: string, values: unknown[]): Promise<number> {
  const res = await raw.query<{ n: number }>(text, values);
  return res.rows[0]?.n ?? 0;
}

/** count(*) and max(updated_at) of every table: a failed write must leave all of them unchanged. */
async function snapshot(): Promise<string> {
  const q = DATA_MODEL_TABLES.map(
    (t) => `select '${t}' as t, count(*)::text as n, max(updated_at)::text as u from "${t}"`,
  ).join(' union all ');
  const res = await raw.query<{ t: string; n: string; u: string | null }>(q);
  return res.rows.map((r) => `${r.t}:${r.n}:${r.u ?? ''}`).join('|');
}

async function expectFailsClosed(run: () => Promise<unknown>, kinds: string[], label: string) {
  const before = await snapshot();
  const err = await run().then(
    () => new Error(`${label}: write succeeded`),
    (e: unknown) => e,
  );
  expect(err, label).toBeInstanceOf(RepositoryError);
  expect(kinds, `${label}: ${(err as RepositoryError).kind}`).toContain(
    (err as RepositoryError).kind,
  );
  expect(await snapshot(), `${label}: nothing written`).toBe(before);
}

const summary: string[] = [];

describe.skipIf(!up)(
  `repository isolation on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
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
      if (summary.length > 0) {
        console.log(`[isolation] per method:\n  ${summary.join('\n  ')}`);
      }
    });

    it('has a case for exactly the methods createRepositories returns', () => {
      const found = Object.entries(repos)
        .flatMap(([repo, methods]) => Object.keys(methods).map((m) => `${repo}.${m}`))
        .sort();
      expect(found).toEqual(Object.keys(CASES).sort());
      console.log(`[isolation] ${found.length} methods: ${found.join(', ')}`);
    });

    for (const [method, c] of Object.entries(CASES) as [RepositoryMethod, IsolationCase][]) {
      it(`${method}: ${c.scope} scope, ${c.op}s fail closed across scopes`, async () => {
        let cases = 0;
        let leaks = 0;
        if (c.scope === 'teacher') {
          const actors = [...TEACHERS];
          cases += await runGrid(c, actors, tScope, (a, t) => a === t);
        } else {
          cases += await runGrid(c, PAIRS, sScope, (a, t) => a === t);
        }
        if (c.op === 'read') {
          // Random well-formed ids (20 per method) return nothing.
          const rand = prng(method.length * 7919);
          for (let i = 0; i < 20; i += 1) {
            const rid = randomId(rand);
            const res =
              c.scope === 'teacher'
                ? await c.random(repos, tScope('A'), rid)
                : await c.random(repos, sScope('1A'), rid);
            const owners = c.owners(res as never);
            if (owners.length > 0) leaks += 1;
            expect(owners, `${method} random id ${rid}`).toEqual([]);
            cases += 1;
          }
        }
        summary.push(
          `${method.padEnd(34)} ${c.scope.padEnd(7)} ${c.op.padEnd(5)} cases=${cases} leaks=${leaks}`,
        );
      });
    }

    async function runGrid<K extends string, S>(
      c: (ReadCase<K, S> | WriteCase<K, S>) & { scope: string },
      keys: readonly K[],
      scopeOf: (k: K) => S,
      same: (a: K, t: K) => boolean,
    ): Promise<number> {
      let cases = 0;
      for (const actor of keys) {
        if (c.op === 'read') {
          const targets = c.targeted ? keys : [actor];
          for (const target of targets) {
            const owners = c.owners((await c.call(repos, scopeOf(actor), target)) as never);
            if (same(actor, target)) {
              expect(owners.length, `${actor} reads own ${target}`).toBeGreaterThan(0);
              expect(new Set(owners), `${actor} reads only own rows`).toEqual(new Set([actor]));
            } else {
              expect(owners, `${actor} reading ${target}`).toEqual([]);
            }
            cases += 1;
          }
        } else {
          for (const target of keys) {
            const owns = c.owns ? c.owns(actor, target) : actor === target;
            if (owns) continue;
            await expectFailsClosed(
              () => c.attempt(repos, scopeOf(actor), actor, target),
              ['not_found', 'scope'],
              `${actor} writing to ${target}`,
            );
            cases += 1;
          }
          for (const [label, run, kind] of c.mismatches?.(actor) ?? []) {
            await expectFailsClosed(() => run(repos), [kind], `${actor}: ${label}`);
            cases += 1;
          }
          // Positive control: the actor writes its own target; the owner reads it back, nobody else.
          const result = await c.attempt(repos, scopeOf(actor), actor, actor);
          await c.verify(repos, actor, result);
          cases += 1;
        }
      }
      return cases;
    }

    it('listForTeacher never returns studentId', async () => {
      const rows = await repos.teacherQuestions.listForTeacher(tScope('A'), {
        status: 'open',
        limit: 200,
      });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const q of rows) expect(Object.keys(q)).not.toContain('studentId');
      expect(JSON.stringify(rows)).not.toMatch(/stu_/);
      expect(
        await repos.teacherQuestions.listForTeacher(tScope('A'), { status: 'answered', limit: 5 }),
      ).toEqual([]);
      const one = await repos.teacherQuestions.listForTeacher(tScope('A'), {
        status: 'open',
        limit: 1,
      });
      expect(one).toHaveLength(1);
    });

    it('listForTeacher rejects a bad status or limit', async () => {
      for (const opts of [
        { status: 'open', limit: 0 },
        { status: 'open', limit: 201 },
        { status: 'closed', limit: 5 },
      ]) {
        await expect(
          repos.teacherQuestions.listForTeacher(tScope('A'), opts as never),
        ).rejects.toMatchObject({ kind: 'invalid', code: 'validation' });
      }
    });

    it('history returns the newest `limit` messages oldest first and rejects bad limits', async () => {
      const sc = sScope('2B');
      const sid = ids.session('2B');
      const mk = (id: string, at: string): Message => ({
        id,
        role: 'agent',
        text: `[2B] ${id}`,
        createdAt: at,
      });
      await repos.messages.append(sc, sid, mk('h_3', '2026-10-17T12:00:03Z'));
      await repos.messages.append(sc, sid, mk('h_5b', '2026-10-17T12:00:05Z'));
      await repos.messages.append(sc, sid, mk('h_5a', '2026-10-17T12:00:05Z'));
      const all = await repos.messages.history(sc, sid, 200);
      const times = all.map((m) => Date.parse(m.createdAt));
      expect([...times].sort((x, y) => x - y)).toEqual(times);
      const last2 = await repos.messages.history(sc, sid, 2);
      // Same created_at: ordered by id.
      expect(last2.map((m) => m.id)).toEqual(['h_5a', 'h_5b']);
      const withSources = all.find((m) => m.role === 'agent' && m.sources);
      expect(withSources?.sources?.[0]?.kind).toBe('material');
      const plain = all.find((m) => m.id === 'h_3');
      expect(plain && 'sources' in plain).toBe(false);
      for (const bad of [0, 201, 1.5, -1]) {
        await expect(repos.messages.history(sc, sid, bad)).rejects.toMatchObject({
          kind: 'invalid',
          method: 'messages.history',
        });
      }
    });

    it('transcriptStoreFor binds the scope: no reading or appending to another pair', async () => {
      const store = transcriptStoreFor(repos, sScope('1A'));
      expect((await store.history(ids.session('1A'), 50)).length).toBeGreaterThan(0);
      for (const p of PAIRS.filter((x) => x !== '1A')) {
        expect(await store.history(ids.session(p), 50)).toEqual([]);
        await expectFailsClosed(
          () =>
            store.append(ids.session(p), {
              id: uid('msg_port'),
              role: 'student',
              text: '[1A] port',
              createdAt: '2026-10-17T13:00:00Z',
            }),
          ['not_found'],
          `transcript store 1A appending to ${p}`,
        );
      }
      const id = uid('msg_port');
      await store.append(ids.session('1A'), {
        id,
        role: 'student',
        text: '[1A] port',
        createdAt: '2026-10-17T13:00:00Z',
      });
      expect((await store.history(ids.session('1A'), 200)).some((m) => m.id === id)).toBe(true);
    });

    it('a stored row whose jsonb disagrees with its columns throws integrity, not data', async () => {
      // Teacher A's column, teacher B's config: never returned to either teacher.
      await raw.query(
        `insert into package_versions (id, teacher_id, package_id, version, config)
         values ('pv_corrupt', 'tch_a', 'pkg_a', 900, $1)`,
        [JSON.stringify(packageConfig('B', 900))],
      );
      await expect(
        repos.packageVersions.get(tScope('A'), { packageId: 'pkg_a', version: 900 }),
      ).rejects.toMatchObject({ kind: 'integrity', code: 'validation' });
      expect(
        await repos.packageVersions.get(tScope('B'), { packageId: 'pkg_a', version: 900 }),
      ).toBeNull();

      await raw.query(
        `insert into agent_versions (id, teacher_id, agent_id, version, config)
         values ('av_corrupt', 'tch_a', 'agt_a', 900, '{"id":"agt_a"}')`,
      );
      await expect(
        repos.agentVersions.get(tScope('A'), { agentId: 'agt_a', version: 900 }),
      ).rejects.toMatchObject({ kind: 'integrity' });

      await raw.query(
        `insert into messages (id, session_id, role, text, sources)
         values ('msg_corrupt', 'ses_2a', 'agent', '[2A] x', '[{"title":1}]')`,
      );
      await expect(
        repos.messages.history(sScope('2A'), ids.session('2A'), 200),
      ).rejects.toMatchObject({
        kind: 'integrity',
        method: 'messages.history',
      });
    });

    it('a read with a bad non-scope argument is invalid, not a query', async () => {
      await expect(
        repos.agentVersions.get(tScope('A'), { agentId: "x' or 1=1", version: 1 }),
      ).rejects.toMatchObject({ kind: 'invalid' });
      await expect(repos.sessions.get(sScope('1A'), '')).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('a write by a scope whose ids are not users fails closed', async () => {
      await expectFailsClosed(
        () =>
          repos.learnerProfiles.save(
            { studentId: 'stu_ghost', teacherId: 'tch_a' },
            { studentId: 'stu_ghost', teacherId: 'tch_a', lang: 'en', mastery: {}, mistakes: [] },
          ),
        ['not_found'],
        'ghost student profile',
      );
      await expectFailsClosed(
        () =>
          repos.sessions.create(
            { studentId: 'stu_ghost', teacherId: 'tch_a' },
            {
              agentId: ids.agent('A'),
              agentVersion: 1,
            },
          ),
        ['not_found'],
        'ghost student session',
      );
    });

    it('evidence append with no events writes nothing', async () => {
      const before = await snapshot();
      await repos.evidenceEvents.append(sScope('1A'), []);
      expect(await snapshot()).toBe(before);
    });

    it('openDatabase gives repositories and a close, without a raw handle', async () => {
      const opened = openDatabase({ DATABASE_URL: TEST_URL });
      try {
        expect(Object.keys(opened).sort()).toEqual(['close', 'repos']);
        expect(await opened.repos.learnerProfiles.get(sScope('1B'))).not.toBeNull();
      } finally {
        await opened.close();
      }
    });

    it('round-trips optional fields: sources, moduleHint, endedAt, a package with no modules', async () => {
      const sc = sScope('2A');
      const id = uid('msg_src');
      await repos.messages.append(sc, ids.session('2A'), {
        id,
        role: 'agent',
        text: '[2A] with sources',
        createdAt: '2026-10-17T12:30:00Z',
        sources: [{ title: '[2A] notes', locator: 'slide 3', kind: 'transcript' }],
      });
      const got = await raw.query<{ sources: unknown }>(
        'select sources from messages where id = $1',
        [id],
      );
      expect(got.rows[0]?.sources).toEqual([
        { title: '[2A] notes', locator: 'slide 3', kind: 'transcript' },
      ]);

      const q = await repos.teacherQuestions.open(sScope('2B'), {
        agentId: ids.agent('B'),
        text: '[2B] about module 2',
        moduleHint: 'module 2',
        similarIds: [],
      });
      expect(q).toMatchObject({
        moduleHint: 'module 2',
        similarIds: [],
        status: 'open',
        studentId: 'stu_2',
      });
      const listed = await repos.teacherQuestions.listForStudent(sScope('2B'));
      expect(listed.find((x) => x.id === q.id)).toEqual(q);

      await raw.query(`update sessions set ended_at = '2026-10-17T13:00:00Z' where id = 'ses_1b'`);
      expect((await repos.sessions.get(sScope('1B'), ids.session('1B')))?.endedAt).toBe(
        '2026-10-17T13:00:00.000Z',
      );
      expect((await repos.sessions.get(sScope('1A'), ids.session('1A')))?.endedAt).toBeNull();

      const bare: LearnerProfile = { ...sScope('2B'), lang: 'hi', mastery: {}, mistakes: [] };
      await repos.learnerProfiles.save(sScope('2B'), bare);
      const back = await repos.learnerProfiles.get(sScope('2B'));
      expect(back).toEqual(bare);
      expect(back && 'lastSummary' in back).toBe(false);

      await raw.query(
        `update teacher_questions set status = 'answered', answered_at = '2026-10-18T09:00:00Z' where id = 'tq_2b'`,
      );
      const answered = (await repos.teacherQuestions.listForStudent(sScope('2B'))).find(
        (x) => x.id === 'tq_2b',
      );
      expect(answered).toMatchObject({
        status: 'answered',
        answeredAt: '2026-10-18T09:00:00.000Z',
      });
      expect(
        await repos.teacherQuestions.listForTeacher(tScope('B'), { status: 'answered', limit: 10 }),
      ).toEqual([expect.not.objectContaining({ studentId: expect.anything() })]);

      const empty = packageConfig('B', 500, []);
      await repos.packageVersions.create(tScope('B'), empty);
      expect(
        await repos.packageVersions.get(tScope('B'), { packageId: ids.pkg('B'), version: 500 }),
      ).toEqual(empty);
    });

    it('an agent version whose valid config names another teacher throws integrity', async () => {
      await raw.query(
        `insert into agent_versions (id, teacher_id, agent_id, version, config)
         values ('av_corrupt_2', 'tch_b', 'agt_b', 901, $1)`,
        [JSON.stringify({ ...agentConfig('A'), id: 'agt_b', version: 901 })],
      );
      await expect(
        repos.agentVersions.get(tScope('B'), { agentId: 'agt_b', version: 901 }),
      ).rejects.toMatchObject({ kind: 'integrity', method: 'agentVersions.get' });
    });

    it('ended subscriptions are not live', async () => {
      await raw.query(`update subscriptions set status = 'ended' where id = 'sub_2b'`);
      expect(await repos.subscriptions.findLive(sScope('2B'))).toBeNull();
      expect(await repos.subscriptions.findLive(sScope('2A'))).toMatchObject({
        id: 'sub_2a',
        packageVersionId: 'pv_a',
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
      });
    });
  },
);
