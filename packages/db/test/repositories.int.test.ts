// Acceptance for task 1.2: cross-teacher and cross-student reads and writes fail closed, on a real
// Postgres 16 + pgvector (see test/pg.ts for how to start one; skipped locally without one, fails
// in CI).
//
// CASES is typed Record<RepositoryMethod, IsolationCase>, so a repository method without a case
// fails `tsc`; a runtime check also compares the methods on createRepositories(db) with CASES.
// Every case runs over the whole grid: every actor scope x every target in the seed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Chunk,
  type EvidenceEvent,
  type LearnerProfile,
  LIMITS,
  type Message,
} from '@edmate/contracts';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  type AuditEntryInput,
  type AuditRow,
  chunkId,
  type CourseRow,
  createRepositories,
  type Outline,
  type PackageDraft,
  openDatabase,
  REDACTED,
  RepositoryError,
  type RepositoryMethod,
  type StudentScope,
  type TeacherScope,
  transcriptStoreFor,
} from '../src/index.js';
import { EMBEDDING_DIMENSIONS } from '../src/schema/index.js';
import { DATA_MODEL_TABLES } from './helpers.js';
import { expectScrubbed } from './scrub.js';
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

/** A method with no teacher or student scope (only `agents.owner`): its own checks, case count. */
interface PublicCase {
  scope: 'public';
  op: 'read';
  check: (r: Repos) => Promise<number>;
}

type IsolationCase =
  | ({ scope: 'teacher' } & (ReadCase<Teacher, TeacherScope> | WriteCase<Teacher, TeacherScope>))
  | ({ scope: 'student' } & (ReadCase<Pair, StudentScope> | WriteCase<Pair, StudentScope>))
  | PublicCase;

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

const otherTeacher = (t: Teacher): Teacher => (t === 'A' ? 'B' : 'A');
const otherStudent = (p: Pair) => studentId(studentOf(p) === '1' ? '2' : '1');

/** A teacher-only audit entry by the teacher itself, tagged with its owner marker. */
function teacherEntry(t: Teacher, extra: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    actor: teacherId(t),
    actorRole: 'teacher',
    action: 'agent.update',
    target: `agent:${ids.agent(t)}`,
    reason: `[${t}] appended ${++counter}`,
    before: { status: 'draft' },
    after: { status: 'live' },
    ...extra,
  };
}

/** A memory change by the scope's student, tagged with its owner marker. */
function studentEntry(p: Pair, extra: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    actor: studentId(studentOf(p)),
    actorRole: 'student',
    action: 'profile.reset',
    target: `profile:${p.toLowerCase()}`,
    reason: `[${p}] appended ${++counter}`,
    before: { lastSummary: `[${p}] old` },
    after: { lastSummary: null },
    ...extra,
  };
}

/** Owner markers of audit rows: columns, reason, before/after. A teacher row naming a student leaks. */
function auditOwners(rows: AuditRow[], kind: 'teacher' | 'student'): string[] {
  return rows.flatMap((a) => [
    kind === 'student'
      ? pairOfIds(a.studentId ?? '', a.teacherId)
      : a.studentId === undefined
        ? teacherOfId(a.teacherId)
        : 'LEAK:student-row',
    ...markers(a.reason ?? ''),
    ...markers(JSON.stringify([a.before ?? null, a.after ?? null])),
  ]);
}

/** sessions.create input for teacher t's agent, pinned to what the seed's subscription resolves to. */
const newSession = (t: Teacher) => ({
  agentId: ids.agent(t),
  agentVersion: 1,
  packageId: ids.pkg(t),
  packageVersion: 1,
});
/** A spare open session per pair, for sessions.endOnPackageChange (inserted in beforeAll). */
const endable = (p: Pair) => `${ids.session(p)}_end`;
/** A second spare open session per pair, for sessions.end (inserted in beforeAll). */
const endable2 = (p: Pair) => `${ids.session(p)}_end2`;

/** Over the 10 000-character cap on a serialised before/after. */
const BIG = { blob: 'x'.repeat(10_001) };
const BIG_HELP = { blob: 'x'.repeat(LIMITS.helpStateMaxJsonLength) };

/** Task 5.3: each teacher's isolation document (one chunk, ord 0), written in beforeAll. */
const isoDoc = (t: Teacher) => `doc_iso_${t.toLowerCase()}`;
/** A document with a stored file, for `chunks.insertManyIfStorageKey`. */
const keyDoc = (t: Teacher) => `doc_key_${t.toLowerCase()}`;
const keyOf = (t: Teacher) => `uploads/iso-${t.toLowerCase()}.pdf`;
/** Unit vector on axis 0: every isolation chunk and query embeds to it (no model is called). */
const ISO_VEC = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
/** Task 8.1: each teacher's profile slug, and the staff user who verifies them. */
const profileSlug = (t: Teacher) => `teacher-${t.toLowerCase()}`;
const ISO_STAFF = 'stf_iso';
const chunkOwners = (cs: Chunk[]) =>
  cs.flatMap((c) => [...markers(c.text), teacherOfId(c.teacherId)]);
/** Task 8.2: a document of `target`'s that `actor` tries to delete (each pair used once). */
const delDoc = (actor: Teacher, target: Teacher) =>
  `doc_del_${actor.toLowerCase()}${target.toLowerCase()}`;
/** Task 8.2: each teacher's document that startReplace rewrites (one chunk, ord 0). */
const repDoc = (t: Teacher) => `doc_rep_${t.toLowerCase()}`;
type DocRow = { id: string; teacherId: string; sourceTitle: string };
const docOwners = (d: DocRow) => [teacherOfId(d.teacherId), ...markers(d.sourceTitle)];
const ownerOfRow = async (table: 'documents' | 'chunks', id: string) =>
  (await raw.query<{ t: string }>(`select teacher_id as t from ${table} where id = $1`, [id]))
    .rows[0]?.t;

/** Task 5.10: fixed open questions for `teacherQuestions.answer`'s isolation grid, one per
 * teacher per scenario, created once in `beforeAll` — a cross-scope `attempt`/`mismatches`
 * closure only calls `answer`, never also opens or mutates a question, so it writes nothing
 * when it fails closed (the whole-database snapshot check covers the entire closure). */
/**
 * Task 8.3: `actor` rewrites `target`'s module 1: renames it, keeps the seeded topic (it has
 * student evidence) linked to `link`, and adds one fresh topic with no links.
 */
function outlineEdit(actor: Teacher, target: Teacher, link = chunkId(isoDoc(target), 0)) {
  return {
    modules: [
      {
        id: ids.module(target, 1),
        title: `[${actor}] module 1`,
        order: 0,
        topics: [
          { id: ids.topic(target), title: `[${actor}] topic`, order: 0, chunkIds: [link] },
          { title: `[${actor}] new topic ${++counter}`, order: 1, chunkIds: [] },
        ],
      },
    ],
  };
}
/** Owner markers of an outline: course id, module and topic titles, linked source titles. */
const outlineOwners = (o: Outline) => [
  o.courseId.slice(4).toUpperCase(),
  ...o.modules.flatMap((m) => [
    ...markers(m.title),
    ...m.topics.flatMap((t) => [
      ...markers(t.title),
      ...t.chunkIds.flatMap((c) => markers(c.sourceTitle)),
    ]),
  ]),
];

/** Task 8.6b: a studio package draft of `t` (the seed's package config without its ids). */
function pkgDraft(t: Teacher, moduleIds = [ids.module(t, 1)]): PackageDraft {
  const draft = Object.fromEntries(
    Object.entries(packageConfig(t, 1, moduleIds)).filter(
      ([k]) => !['id', 'version', 'teacherId', 'agentId'].includes(k),
    ),
  ) as PackageDraft;
  return { ...draft, name: `[${t}] studio package ${++counter}` };
}
/** Task 8.6b: one studio package per teacher, created in `beforeAll`, that saveVersion targets. */
const savePkg: Partial<Record<Teacher, string>> = {};
const answerTarget: Partial<Record<Teacher, string>> = {};
const answerEmpty: Partial<Record<Teacher, string>> = {};
const answerDismissed: Partial<Record<Teacher, string>> = {};
const answerWrongModule: Partial<Record<Teacher, string>> = {};
const answerReplay: Partial<Record<Teacher, string>> = {};
/** Task 8.9: a fixed open question per teacher for `teacherQuestions.dismiss`'s cross-scope
 * attempt (reused by every non-owning actor; dismiss fails `not_found` without writing, so it
 * stays open for the next actor's attempt). */
const dismissTarget: Partial<Record<Teacher, string>> = {};
/** Task 8.9: a question already dismissed once, for the owning actor's "already-closed" mismatch. */
const dismissReplay: Partial<Record<Teacher, string>> = {};
/** Task 5.10: one persisted notification per pair, created once in `beforeAll` — guarantees every
 * pair has at least one of its own readable notifications, and gives `notifications.markRead`'s
 * cross-scope attempt a fixed id to call against without writing anything new first. */
const notifTarget: Partial<Record<Pair, string>> = {};

const CASES: Record<RepositoryMethod, IsolationCase> = {
  // Task 5.3: chunk writes and retrieval. Writes are ownership-checked inserts or a scoped update
  // and bump the material revision in the same transaction (the snapshot covers that table).
  'documents.create': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.documents.create(scope, {
        id: uid('doc_new'),
        moduleId: ids.module(target, 1),
        kind: 'material',
        sourceTitle: `[${actor}] doc`,
      }),
    verify: async (_r, actor, res) => {
      expect(await ownerOfRow('documents', (res as { id: string }).id)).toBe(teacherId(actor));
    },
    mismatches: (a) => [
      [
        "another teacher's document id",
        (r) =>
          r.documents.create(tScope(a), {
            id: isoDoc(otherTeacher(a)),
            moduleId: ids.module(a, 1),
            kind: 'material',
            sourceTitle: 'x',
          }),
        'not_found',
      ],
    ],
  },
  // Task 8.2: the document lifecycle. Reads are scoped selects; writes are scoped updates or a
  // locked delete, each with teacher_id in the same statement.
  'documents.get': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.documents.get(scope, isoDoc(t)),
    random: (r, scope, rid) => r.documents.get(scope, rid),
    owners: (d: DocRow | null) => (d ? docOwners(d) : []),
  },
  'documents.listForTeacher': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.documents.listForTeacher(scope, { moduleId: ids.module(t, 1) }),
    random: (r, scope, rid) => r.documents.listForTeacher(scope, { moduleId: rid }),
    owners: (ds: DocRow[]) => ds.flatMap(docOwners),
  },
  'documents.updateStatus': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, _actor, target) => r.documents.updateStatus(scope, repDoc(target), 'processing'),
    verify: async (r, actor) => {
      for (const t of TEACHERS) {
        const row = await r.documents.get(tScope(t), repDoc(actor));
        expect(row?.status === 'processing', `${t} sees ${actor}'s status`).toBe(t === actor);
      }
    },
    mismatches: (a) => [
      [
        'a failure reason on a non-failed status',
        (r) => r.documents.updateStatus(tScope(a), repDoc(a), 'ready', 'x_failed'),
        'invalid',
      ],
    ],
  },
  'documents.delete': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) => r.documents.delete(scope, delDoc(actor, target)),
    verify: async (r, actor, res) => {
      expect((res as { storageKey: string | null }).storageKey).toBe(`[${actor}] del`);
      expect(await ownerOfRow('documents', delDoc(actor, actor))).toBeUndefined();
      const left = await raw.query(`select 1 from chunks where document_id = $1`, [
        delDoc(actor, actor),
      ]);
      expect(left.rowCount).toBe(0);
      // The actor's failed attempt on the other teacher's document left it in place.
      const other = otherTeacher(actor);
      expect(await r.documents.get(tScope(other), delDoc(actor, other))).not.toBeNull();
    },
  },
  'documents.startReplace': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.documents.startReplace(scope, repDoc(target), { storageKey: `[${actor}] key ${++counter}` }),
    verify: async (r, actor) => {
      const row = await r.documents.get(tScope(actor), repDoc(actor));
      expect(row?.status).toBe('uploading');
      expect(markers(row?.storageKey ?? '')).toEqual([actor]);
      const other = await r.documents.get(tScope(otherTeacher(actor)), repDoc(actor));
      expect(other).toBeNull();
    },
    mismatches: (a) => [
      [
        'a teacherId key in the input',
        (r) =>
          r.documents.startReplace(tScope(a), repDoc(a), {
            storageKey: 'k',
            teacherId: teacherId(otherTeacher(a)),
          } as never),
        'invalid',
      ],
    ],
  },
  'chunks.insertMany': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.chunks.insertMany(scope, isoDoc(target), [
        { ord: ++counter, text: `[${actor}] chunk`, locator: 'p2' },
      ]),
    verify: async (r, actor, res) => {
      const [id] = (res as { ids: string[] }).ids;
      expect(await ownerOfRow('chunks', id!)).toBe(teacherId(actor));
      const found = await r.retrieval.search(tScope(actor), {
        q: 'chunk',
        allowedModuleIds: [ids.module(actor, 1)],
        k: 50,
      });
      expect(found.map((c) => c.id)).toContain(id);
    },
    mismatches: (a) => [
      [
        'an ord already written',
        (r) => r.chunks.insertMany(tScope(a), isoDoc(a), [{ ord: 0, text: 'x', locator: 'p' }]),
        'invalid',
      ],
    ],
  },
  'chunks.insertManyIfStorageKey': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.chunks.insertManyIfStorageKey(scope, keyDoc(target), keyOf(target), [
        { ord: ++counter, text: `[${actor}] keyed chunk`, locator: 'p2' },
      ]),
    verify: async (_r, actor, res) => {
      expect(res).toMatchObject({ stale: false });
      const [id] = (res as { ids: string[] }).ids;
      expect(await ownerOfRow('chunks', id!)).toBe(teacherId(actor));
    },
    mismatches: (a) => [
      [
        'an ord already written',
        (r) =>
          r.chunks.insertManyIfStorageKey(tScope(a), keyDoc(a), keyOf(a), [
            { ord: 0, text: 'x', locator: 'p' },
          ]),
        'invalid',
      ],
    ],
  },
  'chunks.setEmbeddings': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, _actor, target) =>
      r.chunks.setEmbeddings(scope, [{ id: chunkId(isoDoc(target), 0), embedding: ISO_VEC }]),
    verify: async (_r, actor) => {
      const res = await raw.query<{ t: string }>(
        `select teacher_id as t from chunks where id = $1 and embedding is not null`,
        [chunkId(isoDoc(actor), 0)],
      );
      expect(res.rows[0]?.t).toBe(teacherId(actor));
    },
    mismatches: (a) => [
      [
        'a vector of the wrong dimension',
        (r) =>
          r.chunks.setEmbeddings(tScope(a), [{ id: chunkId(isoDoc(a), 0), embedding: [1, 0] }]),
        'invalid',
      ],
    ],
  },
  'chunks.addTeacherNote': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.chunks.addTeacherNote(scope, {
        moduleId: ids.module(target, 1),
        question: `[${actor}] isolation question ${++counter}`,
        answer: `[${actor}] isolation answer`,
        origin: 'teacher_answer',
      }),
    verify: async (r, actor, res) => {
      const { chunkId: noteChunkId } = res as { chunkId: string; evalCaseId: string };
      expect(await ownerOfRow('chunks', noteChunkId)).toBe(teacherId(actor));
      const found = await r.retrieval.search(tScope(actor), {
        q: 'isolation question',
        allowedModuleIds: [ids.module(actor, 1)],
        k: 50,
      });
      expect(found.map((c) => c.id)).toContain(noteChunkId);
    },
    mismatches: (a) => [
      [
        'an empty question after trimming',
        (r) =>
          r.chunks.addTeacherNote(tScope(a), {
            moduleId: ids.module(a, 1),
            question: '   ',
            answer: 'x',
            origin: 'teacher_answer',
          }),
        'invalid',
      ],
    ],
  },
  // Task 8.5: a test-chat correction: the note (via insertTeacherNote) plus a `corrections` row,
  // both on the target's module only (the snapshot covers both tables on a failed attempt).
  'corrections.record': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.corrections.record(scope, {
        moduleId: ids.module(target, 1),
        question: `[${actor}] isolation correction ${++counter}`,
        badAnswer: `[${actor}] wrong answer`,
        correctedAnswer: `[${actor}] corrected answer`,
      }),
    verify: async (r, actor, res) => {
      const { correctionId, chunkId: noteChunkId } = res as {
        correctionId: string;
        chunkId: string;
      };
      expect(await ownerOfRow('chunks', noteChunkId)).toBe(teacherId(actor));
      const row = await raw.query<{ t: string; m: string }>(
        `select teacher_id as t, module_id as m from corrections where id = $1`,
        [correctionId],
      );
      expect(row.rows[0]).toEqual({ t: teacherId(actor), m: ids.module(actor, 1) });
      const found = await r.retrieval.search(tScope(actor), {
        q: 'isolation correction',
        allowedModuleIds: [ids.module(actor, 1)],
        k: 50,
      });
      expect(found.map((c) => c.id)).toContain(noteChunkId);
    },
    mismatches: (a) => [
      [
        'an empty bad answer after trimming',
        (r) =>
          r.corrections.record(tScope(a), {
            moduleId: ids.module(a, 1),
            question: 'q',
            badAnswer: '   ',
            correctedAnswer: 'x',
          }),
        'invalid',
      ],
    ],
  },
  // Task 7.4: read path for the rows chunks.addTeacherNote just wrote (its positive control writes
  // `[actor]` rows for each teacher, so every actor has its own rows by now).
  'teacherEvalCases.listForTeacher': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.teacherEvalCases.listForTeacher(scope),
    random: (r, _scope, rid) => r.teacherEvalCases.listForTeacher({ teacherId: rid }),
    owners: (rows: { question: string; answer: string; moduleId: string }[]) =>
      rows.flatMap((c) => [
        ...markers(c.question),
        ...markers(c.answer),
        c.moduleId.slice(4, 5).toUpperCase(),
      ]),
  },
  'retrieval.search': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) =>
      r.retrieval.search(scope, {
        q: 'isolation marker',
        allowedModuleIds: [ids.module(t, 1), ids.module(t, 2)],
        k: 50,
        embedding: ISO_VEC,
      }),
    random: (r, scope, rid) =>
      r.retrieval.search(scope, {
        q: 'isolation marker',
        allowedModuleIds: [rid],
        k: 50,
        embedding: ISO_VEC,
      }),
    owners: chunkOwners,
  },
  'retrieval.probe': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    // Only `{ hit, score }` comes back, so the owner is the target the probe named when it hits.
    call: async (r, scope, t) => ({
      ...(await r.retrieval.probe(scope, {
        q: 'isolation marker',
        moduleIds: [ids.module(t, 1)],
        embedding: ISO_VEC,
      })),
      t,
    }),
    random: async (r, scope, rid) => ({
      ...(await r.retrieval.probe(scope, {
        q: 'isolation marker',
        moduleIds: [rid],
        embedding: ISO_VEC,
      })),
      t: rid,
    }),
    owners: (x: { hit: boolean; t: string }) => (x.hit ? [x.t] : []),
  },
  'retrieval.material': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    // leakCheck's source: every chunk text of the scope teacher, never another teacher's.
    call: (r, scope) => r.retrieval.material(scope),
    random: (r, _scope, rid) => r.retrieval.material({ teacherId: rid }),
    owners: (rows: { text: string }[]) => rows.flatMap((x) => markers(x.text)),
  },
  'retrieval.revision': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: async (r, scope) => ({ n: await r.retrieval.revision(scope), t: scope.teacherId }),
    random: async (r, _scope, rid) => ({
      n: await r.retrieval.revision({ teacherId: rid }),
      t: rid,
    }),
    owners: (x: { n: number; t: string }) => (x.n > 0 ? [teacherOfId(x.t)] : []),
  },
  'agents.get': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.agents.get(scope, ids.agent(t)),
    random: (r, scope, rid) => r.agents.get(scope, rid),
    owners: (x: { teacherId: string } | null) => (x ? [teacherOfId(x.teacherId)] : []),
  },
  'agents.owner': {
    scope: 'public',
    op: 'read',
    // Public by design (agent -> teacher is shown on teacher pages): it returns the owner id of a
    // live agent and nothing else, and nothing for draft, suspended or unknown agents.
    check: async (r) => {
      let n = 0;
      for (const t of TEACHERS) {
        const got = await r.agents.owner({ agentId: ids.agent(t) });
        expect(got).toEqual({ teacherId: teacherId(t) });
        expect(Object.keys(got ?? {})).toEqual(['teacherId']);
        n += 1;
      }
      await raw.query(
        `insert into agents (id, teacher_id, status) values
           ('agt_owner_draft', 'tch_a', 'draft'), ('agt_owner_susp', 'tch_b', 'suspended')`,
      );
      for (const agentId of ['agt_owner_draft', 'agt_owner_susp']) {
        expect(await r.agents.owner({ agentId }), agentId).toBeNull();
        n += 1;
      }
      const rand = prng(4242);
      for (let i = 0; i < 20; i += 1) {
        expect(await r.agents.owner({ agentId: randomId(rand) })).toBeNull();
        n += 1;
      }
      return n;
    },
  },
  'packageVersions.liveForAgent': {
    scope: 'public',
    op: 'read',
    // Public by design (task 9.3: a student compares packages before starting one): the live
    // packages of a live agent, and nothing for a draft, suspended or unknown agent — never
    // another teacher's packages (the join is entirely by agent_id).
    check: async (r) => {
      let n = 0;
      for (const t of TEACHERS) {
        const got = await r.packageVersions.liveForAgent({ agentId: ids.agent(t) });
        expect(got.map((p) => p.packageVersionId)).toEqual([ids.packageVersion(t)]);
        expect(got[0]?.offer.packageId).toBe(ids.pkg(t));
        expect(got[0]?.offer.name).toBe(`[${t}] package`);
        // Public projection only: never the teacher's internal config (9.3 fix round 1).
        expect(Object.keys(got[0] ?? {}).sort()).toEqual(['offer', 'packageVersionId']);
        expect(Object.keys(got[0]?.offer ?? {}).sort()).toEqual([
          'dailyMessageLimit',
          'liveClassesPerMonth',
          'name',
          'packageId',
          'pricePerMonth',
          'skills',
          'trialDays',
        ]);
        n += 1;
      }
      // A draft and a suspended agent, each with a package that has a live version: the agent's
      // own status must refuse them, not a missing package.
      await raw.query(
        `insert into agents (id, teacher_id, status) values
           ('agt_live_pkg_draft', 'tch_a', 'draft'), ('agt_live_pkg_susp', 'tch_b', 'suspended')`,
      );
      await raw.query(
        `insert into packages (id, teacher_id, agent_id, name, live_version) values
           ('pkg_live_draft', 'tch_a', 'agt_live_pkg_draft', 'draft pkg', 1),
           ('pkg_live_susp', 'tch_b', 'agt_live_pkg_susp', 'susp pkg', 1)`,
      );
      await raw.query(
        `insert into package_versions (id, teacher_id, package_id, version, config) values
           ('pv_live_draft', 'tch_a', 'pkg_live_draft', 1, $1),
           ('pv_live_susp', 'tch_b', 'pkg_live_susp', 1, $2)`,
        [
          JSON.stringify({
            ...packageConfig('A', 1, []),
            id: 'pkg_live_draft',
            agentId: 'agt_live_pkg_draft',
          }),
          JSON.stringify({
            ...packageConfig('B', 1, []),
            id: 'pkg_live_susp',
            agentId: 'agt_live_pkg_susp',
          }),
        ],
      );
      for (const agentId of ['agt_live_pkg_draft', 'agt_live_pkg_susp']) {
        expect(await r.packageVersions.liveForAgent({ agentId }), agentId).toEqual([]);
        n += 1;
      }
      const rand = prng(5353);
      for (let i = 0; i < 20; i += 1) {
        expect(await r.packageVersions.liveForAgent({ agentId: randomId(rand) })).toEqual([]);
        n += 1;
      }
      return n;
    },
  },
  // Task 9.2a: public teacher discovery. Only a verified teacher with a live agent and a live
  // package version is reachable; a pending or rejected teacher, a draft or suspended agent, and
  // an agent with no live package must all stay invisible, never a thrown error.
  'discovery.search': {
    scope: 'public',
    op: 'read',
    check: async (r) => {
      let n = 0;
      const token = `discoverytoken${Math.floor(Math.random() * 1e9)}`;
      await raw.query(
        `update teacher_profiles set verification_status = 'verified',
           bio = $2, languages = '{"en"}' where user_id = $1`,
        [teacherId('A'), token],
      );
      const got = await r.discovery.search({ q: token, page: 1 });
      expect(got.teachers.map((t) => t.slug)).toEqual([profileSlug('A')]);
      expect(Object.keys(got.teachers[0] ?? {}).sort()).toEqual(
        ['bio', 'displayName', 'hasFree', 'languages', 'packageCount', 'slug', 'subject'].sort(),
      );
      n += 1;
      // A still-pending teacher (B, by default from beforeAll) never matches, however the query
      // is phrased, even with a bio word unique to B and nowhere in A's row.
      const bToken = `pendingbiotoken${Math.floor(Math.random() * 1e9)}`;
      await raw.query(`update teacher_profiles set bio = $2 where user_id = $1`, [
        teacherId('B'),
        bToken,
      ]);
      const pending = await r.discovery.search({ q: bToken, page: 1 });
      expect(pending.teachers).toEqual([]);
      await raw.query(`update teacher_profiles set bio = '' where user_id = $1`, [teacherId('B')]);
      n += 1;
      // Not even an unrelated random query ever throws or returns another teacher's row.
      const rand = prng(6464);
      for (let i = 0; i < 10; i += 1) {
        const q = randomId(rand).slice(0, 20);
        await expect(r.discovery.search({ q, page: 1 })).resolves.toBeDefined();
        n += 1;
      }
      await raw.query(`update teacher_profiles set verification_status = 'pending' where user_id = $1`, [
        teacherId('A'),
      ]);
      return n;
    },
  },
  'discovery.teacherBySlug': {
    scope: 'public',
    op: 'read',
    check: async (r) => {
      let n = 0;
      await raw.query(
        `update teacher_profiles set verification_status = 'verified' where user_id = $1`,
        [teacherId('A')],
      );
      const got = await r.discovery.teacherBySlug({ slug: profileSlug('A') });
      expect(got?.slug).toBe(profileSlug('A'));
      expect(Object.keys(got ?? {}).sort()).toEqual(
        ['agentIds', 'bio', 'displayName', 'hasFree', 'languages', 'packageCount', 'slug', 'subject'].sort(),
      );
      n += 1;
      // B stays pending: its slug resolves to nothing, not an error.
      expect(await r.discovery.teacherBySlug({ slug: profileSlug('B') })).toBeNull();
      n += 1;
      // Well-formed but unknown slugs resolve to null; a malformed one is `scope`, never a leak.
      const rand = prng(7474);
      for (let i = 0; i < 10; i += 1) {
        const suffix = Array.from({ length: 3 + Math.floor(rand() * 20) }, () =>
          'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(rand() * 36)),
        ).join('');
        expect(await r.discovery.teacherBySlug({ slug: `unknown-${suffix}` })).toBeNull();
        n += 1;
      }
      await expect(r.discovery.teacherBySlug({ slug: 'Not A Slug!' })).rejects.toMatchObject({
        kind: 'scope',
      });
      n += 1;
      await raw.query(`update teacher_profiles set verification_status = 'pending' where user_id = $1`, [
        teacherId('A'),
      ]);
      return n;
    },
  },
  'modules.ids': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.modules.ids(scope),
    random: (r, _scope, rid) => r.modules.ids({ teacherId: rid }),
    // mod_a1 -> A
    owners: (xs: string[]) => xs.map((m) => m.slice(4, 5).toUpperCase()),
  },
  // Task 8.3: the studio outline. Reads are scoped selects; replaceOutline locks the named modules
  // and topics (all the scope's, else not_found) and checks every chunk id in the link insert.
  'courses.get': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.courses.get(scope),
    random: (r, _scope, rid) => r.courses.get({ teacherId: rid }),
    owners: (c: CourseRow | null) => (c ? markers(c.title) : []),
  },
  'courses.ensureDefault': {
    scope: 'teacher',
    op: 'write',
    // Untargeted: the scope's own course (seeded), so the call is a no-op returning it.
    owns: () => true,
    attempt: (r, scope) => r.courses.ensureDefault(scope),
    verify: async (r, actor, res) => {
      expect((res as CourseRow).id).toBe(ids.course(actor));
      expect(await r.modules.ids(tScope(actor))).toEqual([ids.module(actor, 1), ids.module(actor, 2)]);
    },
    mismatches: () => [
      ['a scope id that is not a user', (r) => r.courses.ensureDefault({ teacherId: 'tch_ghost' }), 'not_found'],
    ],
  },
  'outline.getOutline': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.outline.getOutline(scope),
    random: (r, _scope, rid) => r.outline.getOutline({ teacherId: rid }),
    owners: (o: Outline | null) => (o ? outlineOwners(o) : []),
  },
  'outline.replaceOutline': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, actor, target) => r.outline.replaceOutline(scope, outlineEdit(actor, target)),
    verify: async (r, actor, res) => {
      expect((res as { outlineVersion: number }).outlineVersion).toBeGreaterThan(1);
      const mine = await r.outline.getOutline(tScope(actor));
      const m1 = mine?.modules.find((m) => m.id === ids.module(actor, 1));
      expect(m1?.title).toBe(`[${actor}] module 1`);
      expect(m1?.topics.map((t) => t.chunkIds.map((c) => c.chunkId))).toEqual([
        [chunkId(isoDoc(actor), 0)],
        [],
      ]);
      expect(new Set(outlineOwners(mine!))).toEqual(new Set([actor]));
      const theirs = await r.outline.getOutline(tScope(otherTeacher(actor)));
      expect(outlineOwners(theirs!)).not.toContain(actor);
    },
    mismatches: (a) => [
      [
        "another teacher's chunk id",
        (r) =>
          r.outline.replaceOutline(tScope(a), outlineEdit(a, a, chunkId(isoDoc(otherTeacher(a)), 0))),
        'invalid',
      ],
      [
        "another teacher's topic id under the scope's module",
        (r) =>
          r.outline.replaceOutline(tScope(a), {
            modules: [
              {
                id: ids.module(a, 1),
                title: `[${a}] module 1`,
                order: 0,
                topics: [
                  { id: ids.topic(a), title: `[${a}] topic`, order: 0, chunkIds: [] },
                  { id: ids.topic(otherTeacher(a)), title: 'x', order: 1, chunkIds: [] },
                ],
              },
            ],
          }),
        'not_found',
      ],
      [
        'a teacherId key in the input',
        (r) =>
          r.outline.replaceOutline(tScope(a), {
            ...outlineEdit(a, a),
            teacherId: teacherId(otherTeacher(a)),
          } as never),
        'invalid',
      ],
    ],
  },
  'chunks.listForModule': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.chunks.listForModule(scope, ids.module(t, 1)),
    random: (r, scope, rid) => r.chunks.listForModule(scope, rid),
    owners: (cs: { text: string; sourceTitle: string }[]) =>
      cs.flatMap((c) => [...markers(c.text), ...markers(c.sourceTitle)]),
  },
  'styleCards.get': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.styleCards.get(scope, ids.styleCard(t)),
    random: (r, scope, rid) => r.styleCards.get(scope, rid),
    owners: (c: { text: string; teacherId: string } | null) =>
      c ? [...markers(c.text), teacherOfId(c.teacherId)] : [],
  },
  'styleCards.latest': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.styleCards.latest(scope),
    random: (r, _scope, rid) => r.styleCards.latest({ teacherId: rid }),
    owners: (c: { text: string; teacherId: string } | null) =>
      c ? [...markers(c.text), teacherOfId(c.teacherId)] : [],
  },
  'styleCards.create': {
    scope: 'teacher',
    op: 'write',
    // Untargeted: the only teacher a create can name is the scope's own (no teacherId input).
    owns: () => true,
    attempt: (r, scope, actor) =>
      r.styleCards.create(scope, { text: `[${actor}] card ${++counter}`, mistakeTags: [] }),
    verify: async (r, actor, res) => {
      const card = res as { id: string; teacherId: string };
      expect(card.teacherId).toBe(teacherId(actor));
      for (const t of TEACHERS) {
        const got = await r.styleCards.get(tScope(t), card.id);
        expect(got !== null, `${t} reading ${actor}'s new style card`).toBe(t === actor);
        const latest = await r.styleCards.latest(tScope(t));
        expect(latest?.id === card.id, `${t}'s latest is ${actor}'s new card`).toBe(t === actor);
      }
    },
    mismatches: (a) => [
      [
        "a client-set teacherId (another teacher's)",
        (r) =>
          r.styleCards.create(tScope(a), {
            text: 'x',
            mistakeTags: [],
            teacherId: teacherId(otherTeacher(a)),
          } as never),
        'invalid',
      ],
      [
        'a student scope id',
        (r) => r.styleCards.create({ teacherId: studentId('1') }, { text: 'x', mistakeTags: [] }),
        'scope',
      ],
    ],
  },
  'packageVersions.getById': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.packageVersions.getById(scope, ids.packageVersion(t)),
    random: (r, scope, rid) => r.packageVersions.getById(scope, rid),
    owners: (c: { name: string; teacherId: string } | null) =>
      c ? [...markers(c.name), teacherOfId(c.teacherId)] : [],
  },
  'packageVersions.latest': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.packageVersions.latest(scope, ids.pkg(t)),
    random: (r, scope, rid) => r.packageVersions.latest(scope, rid),
    owners: (c: { name: string; teacherId: string } | null) =>
      c ? [...markers(c.name), teacherOfId(c.teacherId)] : [],
  },
  'agentVersions.latest': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.agentVersions.latest(scope, ids.agent(t)),
    random: (r, scope, rid) => r.agentVersions.latest(scope, rid),
    owners: (c: { config: { teacherId: string } } | null) =>
      c ? [teacherOfId(c.config.teacherId)] : [],
  },
  'packageVersions.listForAgent': {
    scope: 'teacher',
    op: 'read',
    targeted: true,
    call: (r, scope, t) => r.packageVersions.listForAgent(scope, ids.agent(t)),
    random: (r, scope, rid) => r.packageVersions.listForAgent(scope, rid),
    // Seeded ids (`pkg_a`) carry their owner; 8.6b's studio packages have UUIDs and a `[A]` name.
    owners: (rows: { packageId: string; name: string }[]) =>
      rows.flatMap((p) => [
        ...(p.packageId.startsWith('pkg_') ? [p.packageId.slice(4).toUpperCase()] : []),
        ...markers(p.name),
      ]),
  },
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
  // Task 8.6b: the teacher's draft agent and studio packages. ensureDraft checks the course and
  // style card are the scope's (key-share locked) before returning or creating the agent;
  // packages writes check the agent or package row (scoped by teacher and agent) and every module.
  'agents.ensureDraft': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, _actor, target) =>
      r.agents.ensureDraft(scope, {
        courseId: ids.course(target),
        styleCardId: ids.styleCard(target),
        promptPackVersion: '1.0.0',
        modelPolicy: agentConfig(target).modelPolicy,
      }),
    verify: async (r, actor, res) => {
      const { agentId, version } = res as { agentId: string; version: number };
      for (const t of TEACHERS) {
        const got = await r.agents.get(tScope(t), agentId);
        expect(got !== null, `${t} reading ${actor}'s agent`).toBe(t === actor);
        const v = await r.agentVersions.get(tScope(t), { agentId, version });
        expect(v !== null, `${t} reading ${actor}'s agent version`).toBe(t === actor);
      }
    },
    mismatches: (a) => {
      const mine = {
        courseId: ids.course(a),
        styleCardId: ids.styleCard(a),
        promptPackVersion: '1.0.0',
        modelPolicy: agentConfig(a).modelPolicy,
      };
      return [
        [
          "another teacher's style card",
          (r) =>
            r.agents.ensureDraft(tScope(a), {
              ...mine,
              styleCardId: ids.styleCard(otherTeacher(a)),
            }),
          'not_found',
        ],
        [
          "a client-set teacherId (another teacher's)",
          (r) =>
            r.agents.ensureDraft(tScope(a), {
              ...mine,
              teacherId: teacherId(otherTeacher(a)),
            } as never),
          'invalid',
        ],
        [
          'a student scope id',
          (r) => r.agents.ensureDraft({ teacherId: studentId('1') }, mine),
          'not_found',
        ],
      ];
    },
  },
  'packages.create': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, _actor, target) =>
      r.packages.create(scope, { agentId: ids.agent(target), draft: pkgDraft(target) }),
    verify: async (r, actor, res) => {
      const { packageId } = res as { packageId: string };
      for (const t of TEACHERS) {
        const list = await r.packages.listForTeacher(tScope(t));
        expect(
          list.some((p) => p.packageId === packageId),
          `${t} listing ${actor}'s new package`,
        ).toBe(t === actor);
      }
    },
    mismatches: (a) => [
      [
        "another teacher's module",
        (r) =>
          r.packages.create(tScope(a), {
            agentId: ids.agent(a),
            draft: pkgDraft(a, [ids.module(otherTeacher(a), 1)]),
          }),
        'scope',
      ],
      [
        "a client-set teacherId in the draft (another teacher's)",
        (r) =>
          r.packages.create(tScope(a), {
            agentId: ids.agent(a),
            draft: { ...pkgDraft(a), teacherId: teacherId(otherTeacher(a)) } as never,
          }),
        'invalid',
      ],
    ],
  },
  'packages.saveVersion': {
    scope: 'teacher',
    op: 'write',
    attempt: (r, scope, _actor, target) =>
      r.packages.saveVersion(scope, {
        packageId: savePkg[target]!,
        agentId: ids.agent(target),
        draft: pkgDraft(target),
      }),
    verify: async (r, actor, res) => {
      const { packageId, version } = res as { packageId: string; version: number };
      for (const t of TEACHERS) {
        const got = await r.packageVersions.get(tScope(t), { packageId, version });
        expect(got !== null, `${t} reading ${actor}'s saved version`).toBe(t === actor);
      }
    },
    mismatches: (a) => [
      [
        "my package under another teacher's agent",
        (r) =>
          r.packages.saveVersion(tScope(a), {
            packageId: savePkg[a]!,
            agentId: ids.agent(otherTeacher(a)),
            draft: pkgDraft(a),
          }),
        'not_found',
      ],
      [
        "another teacher's module",
        (r) =>
          r.packages.saveVersion(tScope(a), {
            packageId: savePkg[a]!,
            agentId: ids.agent(a),
            draft: pkgDraft(a, [ids.module(otherTeacher(a), 2)]),
          }),
        'scope',
      ],
    ],
  },
  'packages.listForTeacher': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.packages.listForTeacher(scope),
    random: (r, _scope, rid) => r.packages.listForTeacher({ teacherId: rid }),
    owners: (xs: { config: { name: string; teacherId: string } }[]) =>
      xs.flatMap((x) => [...markers(x.config.name), teacherOfId(x.config.teacherId)]),
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
    attempt: (r, scope, _a, target) => r.sessions.create(scope, newSession(teacherOf(target))),
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
        (r) => r.sessions.create(sScope(a), { ...newSession(teacherOf(a)), agentVersion: 99 }),
        'not_found',
      ],
      [
        'an agent that does not exist',
        (r) =>
          r.sessions.create(sScope(a), { ...newSession(teacherOf(a)), agentId: 'agt_nowhere' }),
        'not_found',
      ],
      // Task 3.16: the pin must be one of this agent's (so this teacher's) package versions.
      [
        "the other teacher's package",
        (r) =>
          r.sessions.create(sScope(a), {
            ...newSession(teacherOf(a)),
            packageId: ids.pkg(otherTeacher(teacherOf(a))),
          }),
        'not_found',
      ],
      [
        'a package version that does not exist',
        (r) => r.sessions.create(sScope(a), { ...newSession(teacherOf(a)), packageVersion: 9 }),
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
  // Task 3.8 (ADR-0005): the only write of the answer key; scope and open session in the WHERE.
  'sessions.saveHelpState': {
    scope: 'student',
    op: 'write',
    attempt: async (r, scope, actor, target) => {
      const value = { v: 1, marker: `[${actor}] help ${uid('h')}` };
      await r.sessions.saveHelpState(scope, ids.session(target), value);
      return value;
    },
    verify: async (r, actor, value) => {
      for (const p of PAIRS) {
        const row = await r.sessions.get(sScope(p), ids.session(actor));
        if (p === actor) expect(row?.helpState).toEqual(value);
        else expect(row, `${p} reads ${actor}'s session`).toBeNull();
      }
    },
    mismatches: (a) => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const save = (v: unknown) => (r: Repos) =>
        r.sessions.saveHelpState(sScope(a), ids.session(a), v);
      return [
        ['a value over LIMITS.helpStateMaxJsonLength', save(BIG_HELP), 'invalid'],
        ['a value that is not serialisable', save(circular), 'invalid'],
        ['undefined', save(undefined), 'invalid'],
        ['a BigInt', save({ n: BigInt(1) }), 'invalid'],
        [
          'a session id that is not an id',
          (r) => r.sessions.saveHelpState(sScope(a), 'ses not an id', {}),
          'invalid',
        ],
      ];
    },
  },
  // Task 3.16: ends the scope's own session and clears its own pair's summary; anything else is
  // not_found and writes nothing. Targets a spare session per pair (seeded in beforeAll).
  'sessions.endOnPackageChange': {
    scope: 'student',
    op: 'write',
    attempt: (r, scope, _actor, target) => r.sessions.endOnPackageChange(scope, endable(target)),
    verify: async (r, actor, res) => {
      expect(res).toEqual({ ended: true });
      for (const p of PAIRS) {
        const row = await r.sessions.get(sScope(p), endable(actor));
        if (p === actor) expect(row?.endedAt).not.toBeNull();
        else expect(row, `${p} reads ${actor}'s session`).toBeNull();
        const summary = (await r.learnerProfiles.get(sScope(p)))?.lastSummary;
        expect(summary, `${p}'s summary`).toBe(p === actor ? undefined : `[${p}] last time`);
      }
      // Put the summary back for the cases that read it later.
      await raw.query(
        'update learner_profiles set last_summary = $1 where student_id = $2 and teacher_id = $3',
        [`[${actor}] last time`, sScope(actor).studentId, sScope(actor).teacherId],
      );
    },
    mismatches: (a) => [
      [
        'a session id that is not an id',
        (r) => r.sessions.endOnPackageChange(sScope(a), 'ses not an id'),
        'invalid',
      ],
      [
        'a session that does not exist',
        (r) => r.sessions.endOnPackageChange(sScope(a), 'ses_nowhere'),
        'not_found',
      ],
    ],
  },
  // Task 6.4: ends the scope's own session normally and upserts its own pair's summary; anything
  // else is not_found and writes nothing. Targets a second spare session per pair (seeded in
  // beforeAll, distinct from endOnPackageChange's so the two write cases never share a row).
  'sessions.end': {
    scope: 'student',
    op: 'write',
    attempt: (r, scope, actor, target) =>
      r.sessions.end(scope, endable2(target), `[${actor}] wrap-up`),
    verify: async (r, actor, res) => {
      expect(res).toEqual({ ended: true });
      for (const p of PAIRS) {
        const row = await r.sessions.get(sScope(p), endable2(actor));
        if (p === actor) {
          expect(row?.endedAt).not.toBeNull();
          expect(row?.summary).toBe(`[${actor}] wrap-up`);
        } else {
          expect(row, `${p} reads ${actor}'s session`).toBeNull();
        }
        const summary = (await r.learnerProfiles.get(sScope(p)))?.lastSummary;
        expect(summary, `${p}'s summary`).toBe(p === actor ? `[${actor}] wrap-up` : `[${p}] last time`);
      }
      // Put the summary back to the seed's own value, same as endOnPackageChange's own case.
      await raw.query(
        'update learner_profiles set last_summary = $1 where student_id = $2 and teacher_id = $3',
        [`[${actor}] last time`, sScope(actor).studentId, sScope(actor).teacherId],
      );
    },
    mismatches: (a) => [
      [
        'a session id that is not an id',
        (r) => r.sessions.end(sScope(a), 'ses not an id', 'summary'),
        'invalid',
      ],
      [
        'a session that does not exist',
        (r) => r.sessions.end(sScope(a), 'ses_nowhere', 'summary'),
        'not_found',
      ],
      [
        'a summary over the word limit',
        (r) => r.sessions.end(sScope(a), endable2(a), Array(LIMITS.lastSummaryMaxWords + 1).fill('w').join(' ')),
        'invalid',
      ],
    ],
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
      r.turnTraces.insert(scope, {
        turnId: uid('trn_new'),
        sessionId: ids.session(target),
        agentVersion: 1,
        packageVersion: 1,
        steps: [{ name: `[${actor}] new`, ms: 1, outcome: 'ok' }],
        intent: 'on_task',
        move: 'hint',
        guards: [],
        usage: [
          { model: 'scripted', tier: 'main', inputTokens: 1, outputTokens: 1, costMicroUsd: 0 },
        ],
      }),
    verify: async (r, actor) => {
      for (const p of PAIRS) {
        const rows = await r.turnTraces.listForSession(sScope(p), ids.session(actor));
        const mine = rows.some((t) => t.steps.some((st) => st.name === `[${actor}] new`));
        expect(mine, `${p} sees ${actor}'s trace`).toBe(p === actor);
      }
    },
    mismatches: (a) => {
      const trace = (o: object) => ({
        turnId: uid('trn_bad'),
        sessionId: ids.session(a),
        agentVersion: 1,
        packageVersion: 1,
        steps: [],
        intent: 'on_task' as const,
        move: 'hint' as const,
        guards: [],
        usage: [],
        ...o,
      });
      const big = {
        model: 'm',
        tier: 'main',
        inputTokens: 2_000_000_000,
        outputTokens: 0,
        costMicroUsd: 0,
      };
      return [
        [
          'negative tokens',
          (r) =>
            r.turnTraces.insert(
              sScope(a),
              trace({ usage: [{ ...big, inputTokens: -1 }] }) as never,
            ),
          'invalid',
        ],
        [
          'summed tokens past the integer column',
          (r) => r.turnTraces.insert(sScope(a), trace({ usage: [big, big] }) as never),
          'invalid',
        ],
        [
          'a second trace for the same turn',
          (r) =>
            r.turnTraces.insert(
              sScope(a),
              trace({ turnId: `trn_${a.toLowerCase()}_seed` }) as never,
            ),
          'invalid',
        ],
      ];
    },
  },
  'turnTraces.findForTurn': {
    scope: 'student',
    op: 'read',
    targeted: true,
    call: (r, scope, p) =>
      r.turnTraces.findForTurn(scope, {
        sessionId: ids.session(p),
        turnId: `trn_${p.toLowerCase()}_seed`,
      }),
    random: (r, scope, rid) => r.turnTraces.findForTurn(scope, { sessionId: rid, turnId: rid }),
    owners: (x: { steps: { name: string }[] } | null) =>
      x ? x.steps.flatMap((st) => markers(st.name)) : [],
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
  'turnTraces.listForTeacherSince': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.turnTraces.listForTeacherSince(scope, '2000-01-01T00:00:00Z'),
    random: (r, _scope, rid) =>
      r.turnTraces.listForTeacherSince({ teacherId: rid }, '2000-01-01T00:00:00Z'),
    owners: (rows: { steps: { name: string }[] }[]) =>
      rows.flatMap((t) => t.steps.flatMap((st) => markers(st.name).map((p) => p.slice(-1)))),
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
  'learnerProfiles.applyMastery': {
    scope: 'student',
    op: 'write',
    // Unlike `save`, applyMastery's payload names no target at all: every call always writes
    // the authenticated scope's own row (a topic id is content, not a row selector), so there is
    // no "actor writes toward target" to test here (owns: () => true skips that grid; the topic-
    // ownership check is covered by `mismatches` below instead).
    owns: () => true,
    attempt: async (r, scope, _actor, target) => {
      const p = (((++counter % 83) + 1) / 100) as number;
      await r.learnerProfiles.applyMastery(scope, {
        [ids.topic(teacherOf(target))]: { p, n: 1, updatedAt: '2026-10-19T10:00:00.000Z' },
      });
      return { topicId: ids.topic(teacherOf(target)), p };
    },
    verify: async (r, actor, result) => {
      const { topicId, p } = result as { topicId: string; p: number };
      await onlyPairSees(
        (sc) => r.learnerProfiles.get(sc),
        actor,
        (x) => (x as LearnerProfile | null)?.mastery[topicId]?.p === p,
      );
    },
    mismatches: (a) => [
      [
        'a topic that does not exist',
        (r) =>
          r.learnerProfiles.applyMastery(sScope(a), {
            top_nowhere: { p: 0.5, n: 1, updatedAt: '2026-10-19T10:00:00.000Z' },
          }),
        'scope',
      ],
      [
        'a mastery entry that fails the contract',
        (r) =>
          r.learnerProfiles.applyMastery(sScope(a), {
            [ids.topic(teacherOf(a))]: { p: 1.5, n: 1, updatedAt: '2026-10-19T10:00:00.000Z' },
          }),
        'invalid',
      ],
    ],
  },
  'learnerProfiles.applyEvidenceMastery': {
    scope: 'student',
    op: 'write',
    // Same shape as applyMastery above: the payload names no target row, only topic ids as
    // content, so there is no "actor writes toward target" to test (owns: () => true skips that
    // grid; topic ownership is covered by `mismatches` below).
    owns: () => true,
    attempt: async (r, scope, _actor, target) => {
      const ts = new Date(Date.UTC(2026, 9, 19, 14, 0, ++counter)).toISOString();
      await r.learnerProfiles.applyEvidenceMastery(scope, [
        { topicId: ids.topic(teacherOf(target)), correct: true, ts },
      ]);
      return { topicId: ids.topic(teacherOf(target)), ts };
    },
    verify: async (r, actor, result) => {
      const { topicId, ts } = result as { topicId: string; ts: string };
      await onlyPairSees(
        (sc) => r.learnerProfiles.get(sc),
        actor,
        (x) => (x as LearnerProfile | null)?.mastery[topicId]?.updatedAt === ts,
      );
    },
    mismatches: (a) => [
      [
        'a topic that does not exist',
        (r) =>
          r.learnerProfiles.applyEvidenceMastery(sScope(a), [
            { topicId: 'top_nowhere', correct: true, ts: '2026-10-19T14:00:00.000Z' },
          ]),
        'scope',
      ],
    ],
  },
  'learnerProfiles.rebuildMastery': {
    scope: 'student',
    op: 'write',
    // Same shape as applyEvidenceMastery above: no target row named, only the authenticated
    // scope's own evidence_events history is replayed (owns: () => true skips that grid).
    owns: () => true,
    attempt: async (r, scope, _actor, target) => {
      const topicId = ids.topic(teacherOf(target));
      // isolation-seed.ts seeds one evidence_events row per pair with no explicit ts (defaults to
      // the row's real insertion time, "now"): this new event must sort after it (ts ASC, id ASC)
      // for rebuildMastery's replay to pick it up as the topic's latest, so it is timestamped
      // ahead of real "now" rather than a fixed 2026 date.
      const ts = new Date(Date.now() + ++counter * 1000).toISOString();
      await r.evidenceEvents.append(scope, [
        { ...sScope(target), topicId, correct: true, source: 'practice', weight: 1, ts },
      ]);
      await r.learnerProfiles.rebuildMastery(scope);
      return { topicId, ts };
    },
    verify: async (r, actor, result) => {
      const { topicId, ts } = result as { topicId: string; ts: string };
      await onlyPairSees(
        (sc) => r.learnerProfiles.get(sc),
        actor,
        (x) => (x as LearnerProfile | null)?.mastery[topicId]?.updatedAt === ts,
      );
    },
  },
  'learnerProfiles.applyMistakes': {
    scope: 'student',
    op: 'write',
    // Same shape as applyMastery above: the payload names no target row, only a mistake tag as
    // content, so there is no "actor writes toward target" to test (owns: () => true skips that
    // grid).
    owns: () => true,
    attempt: async (r, scope) => {
      const tag = `mistake_${++counter}`;
      const lastSeen = new Date(Date.UTC(2026, 9, 19, 14, 0, counter)).toISOString();
      await r.learnerProfiles.applyMistakes(scope, [{ tag, count: 1, lastSeen }]);
      return { tag, lastSeen };
    },
    verify: async (r, actor, result) => {
      const { tag, lastSeen } = result as { tag: string; lastSeen: string };
      await onlyPairSees(
        (sc) => r.learnerProfiles.get(sc),
        actor,
        (x) => (x as LearnerProfile | null)?.mistakes.some((m) => m.tag === tag && m.lastSeen === lastSeen) ?? false,
      );
    },
  },
  // Task 6.5: no target row named (the scope's own profile, sessions and evidence are always the
  // target), so owns: () => true skips the cross-actor grid, same shape as applyMastery above.
  // The positive control ends the pair's main seeded session and clears its profile and evidence;
  // `verify` restores all three to the seed's own values so later cases and tests are unaffected
  // (same "put it back" idiom sessions.end/endOnPackageChange already use above).
  'learnerProfiles.reset': {
    scope: 'student',
    op: 'write',
    owns: () => true,
    attempt: (r, scope) => r.learnerProfiles.reset(scope),
    verify: async (r, actor, res) => {
      expect(res).toEqual({ reset: true });
      const sc = sScope(actor);
      const profile = await r.learnerProfiles.get(sc);
      expect(profile).toMatchObject({ mastery: {}, mistakes: [] });
      expect(profile && 'lastSummary' in profile).toBe(false);
      const session = await r.sessions.get(sc, ids.session(actor));
      expect(session?.endedAt).not.toBeNull();
      for (const p of PAIRS) {
        if (p === actor) continue;
        const other = await r.learnerProfiles.get(sScope(p));
        expect(other?.mastery, `${p}'s mastery after ${actor}'s reset`).not.toEqual({});
      }
      // Restore the seed's own values, so every case and test after this one sees the original
      // fixture (same idiom sessions.end / endOnPackageChange already use).
      const t = teacherOf(actor);
      await raw.query(`update sessions set ended_at = null where id = $1`, [ids.session(actor)]);
      await raw.query(
        `update learner_profiles set mastery = $1::jsonb, mistakes = $2::jsonb, last_summary = $3
         where student_id = $4 and teacher_id = $5`,
        [
          JSON.stringify({ [ids.topic(t)]: { p: 0.5, n: 2, updatedAt: '2026-10-17T10:00:00Z' } }),
          JSON.stringify([{ tag: `[${actor}] sign`, count: 1, lastSeen: '2026-10-17T10:00:00Z' }]),
          `[${actor}] last time`,
          sc.studentId,
          sc.teacherId,
        ],
      );
      await raw.query(
        `insert into evidence_events (id, student_id, teacher_id, topic_id, correct, source)
         values (gen_random_uuid()::text, $1, $2, $3, true, 'check')`,
        [sc.studentId, sc.teacherId, ids.topic(t)],
      );
    },
  },
  'evidenceEvents.list': {
    scope: 'student',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.evidenceEvents.list(scope, { limit: 100 }),
    random: (r, _scope, rid) =>
      r.evidenceEvents.list({ studentId: rid, teacherId: rid }, { limit: 100 }),
    owners: (res: { events: EvidenceEvent[] }) =>
      res.events.map((e) => pairOfIds(e.studentId, e.teacherId)),
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
  'evidenceEvents.appendAndFold': {
    scope: 'student',
    op: 'write',
    attempt: async (r, scope, _actor, target) => {
      const ts = new Date(Date.UTC(2026, 9, 18, 12, 0, ++counter)).toISOString();
      const topicId = ids.topic(teacherOf(target));
      const event: EvidenceEvent = {
        ...sScope(target),
        topicId,
        correct: true,
        source: 'practice',
        weight: 1,
        ts,
      };
      await r.evidenceEvents.appendAndFold(scope, [event]);
      return { topicId, ts };
    },
    verify: async (r, actor, result) => {
      const { topicId, ts } = result as { topicId: string; ts: string };
      await onlyPairSees(
        (sc) => r.learnerProfiles.get(sc),
        actor,
        (x) => (x as LearnerProfile | null)?.mastery[topicId]?.updatedAt === ts,
      );
    },
    mismatches: (a) => {
      const other: Teacher = teacherOf(a) === 'A' ? 'B' : 'A';
      const good: EvidenceEvent = {
        ...sScope(a),
        topicId: ids.topic(teacherOf(a)),
        correct: true,
        source: 'check',
        weight: 1,
        ts: '2026-10-18T12:00:00Z',
      };
      return [
        [
          "another teacher's topic",
          (r) => r.evidenceEvents.appendAndFold(sScope(a), [{ ...good, topicId: ids.topic(other) }]),
          'scope',
        ],
        [
          'a topic that does not exist',
          (r) =>
            r.evidenceEvents.appendAndFold(sScope(a), [good, { ...good, topicId: 'top_nowhere' }]),
          'scope',
        ],
        [
          'an event that fails the contract',
          (r) => r.evidenceEvents.appendAndFold(sScope(a), [{ ...good, ts: 'now' }]),
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
  'subscriptions.pauseFreeForTeacher': {
    scope: 'teacher',
    op: 'write',
    // No target ids: the pause always lands in the scope's own teacher.
    owns: () => true,
    attempt: (r, scope) =>
      r.subscriptions.pauseFreeForTeacher(scope, {
        monthStart: new Date().toISOString(),
        reason: 'isolation grid',
      }),
    verify: async (_r, actor, res) => {
      const paused = res as { subscriptionId: string }[];
      // Every seeded pair is on a free package, so the actor's two subscriptions are paused.
      expect(paused.map((p) => p.subscriptionId).sort()).toEqual(
        [`1${actor}`, `2${actor}`].map((p) => ids.subscription(p as Pair)),
      );
      const rows = await raw.query<{ id: string; status: string }>(
        `select id, status from subscriptions order by id`,
      );
      for (const row of rows.rows) {
        const owner = row.id.slice(-1).toUpperCase();
        expect(row.status, `${actor}'s pause on ${row.id}`).toBe(
          owner === actor ? 'paused' : 'active',
        );
      }
      // Put the seed back for the rest of the suite.
      await raw.query(`update subscriptions set status = 'active' where teacher_id = $1`, [
        teacherId(actor),
      ]);
    },
    mismatches: (a) => [
      [
        'a bad month start',
        (r) =>
          r.subscriptions.pauseFreeForTeacher(tScope(a), {
            monthStart: 'this month',
            reason: 'x',
          }),
        'invalid',
      ],
      [
        'a teacher id smuggled in the options',
        (r) =>
          r.subscriptions.pauseFreeForTeacher(tScope(a), {
            monthStart: new Date().toISOString(),
            reason: 'x',
            teacherId: teacherId(otherTeacher(a)),
          } as never),
        'invalid',
      ],
    ],
  },
  // Task 9.3: a no-payment subscription start. Every seeded pair already has a live subscription
  // (isolation-seed.ts), so the positive control ends that pair's own seed row first (restored
  // after verify), while the mismatches below rely on it still being live.
  'subscriptions.start': {
    scope: 'student',
    op: 'write',
    // Same-teacher pairs (for example 1A, 2A) both resolve a valid packageVersionId for the
    // scope's own teacher, so only a cross-teacher target is a genuine ownership failure.
    owns: (a, t) => teacherOf(a) === teacherOf(t),
    attempt: async (r, scope, actor, target) => {
      if (actor === target) {
        await raw.query(`update subscriptions set status = 'ended' where id = $1`, [
          ids.subscription(actor),
        ]);
      }
      return r.subscriptions.start(scope, {
        packageVersionId: ids.packageVersion(teacherOf(target)),
        status: 'active',
        periodEnd: '2027-01-01T00:00:00Z',
      });
    },
    verify: async (r, actor, res) => {
      const row = res as { id: string; packageVersionId: string };
      expect(row.packageVersionId).toBe(ids.packageVersion(teacherOf(actor)));
      await onlyPairSees(
        (sc) => r.subscriptions.findLive(sc),
        actor,
        (x) => (x as { id: string } | null)?.id === row.id,
      );
      // Put the seed back for the rest of the suite.
      await raw.query(`delete from subscriptions where id = $1`, [row.id]);
      await raw.query(`update subscriptions set status = 'active' where id = $1`, [
        ids.subscription(actor),
      ]);
    },
    mismatches: (a) => [
      [
        "another teacher's packageVersionId",
        (r) =>
          r.subscriptions.start(sScope(a), {
            packageVersionId: ids.packageVersion(otherTeacher(teacherOf(a))),
            status: 'active',
            periodEnd: '2027-01-01T00:00:00Z',
          }),
        'not_found',
      ],
      [
        'a pair that already has a live subscription',
        (r) =>
          r.subscriptions.start(sScope(a), {
            packageVersionId: ids.packageVersion(teacherOf(a)),
            status: 'active',
            periodEnd: '2027-01-01T00:00:00Z',
          }),
        'invalid',
      ],
      [
        'a malformed packageVersionId',
        (r) =>
          r.subscriptions.start(sScope(a), {
            packageVersionId: '',
            status: 'active',
            periodEnd: '2027-01-01T00:00:00Z',
          }),
        'invalid',
      ],
      [
        'a bad status',
        (r) =>
          r.subscriptions.start(sScope(a), {
            packageVersionId: ids.packageVersion(teacherOf(a)),
            status: 'past_due',
            periodEnd: '2027-01-01T00:00:00Z',
          } as never),
        'invalid',
      ],
      [
        'a bad periodEnd',
        (r) =>
          r.subscriptions.start(sScope(a), {
            packageVersionId: ids.packageVersion(teacherOf(a)),
            status: 'active',
            periodEnd: 'next year',
          }),
        'invalid',
      ],
    ],
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
  'audit.appendForTeacher': {
    scope: 'teacher',
    op: 'write',
    // The entry names no other scope: it always lands in the scope's teacher.
    owns: () => true,
    attempt: async (r, scope, actor) => {
      const e = teacherEntry(actor);
      await r.audit.appendForTeacher(scope, e);
      return e.reason;
    },
    verify: async (r, actor, reason) => {
      for (const t of TEACHERS) {
        const rows = await r.audit.listForTeacher(tScope(t), { limit: 200 });
        expect(
          rows.some((a) => a.reason === reason),
          `${t} sees ${actor}'s audit row`,
        ).toBe(t === actor);
      }
      for (const p of PAIRS) {
        const rows = await r.audit.listForStudent(sScope(p), { limit: 200 });
        expect(
          rows.some((a) => a.reason === reason),
          `${p} sees ${actor}'s row`,
        ).toBe(false);
      }
    },
    mismatches: (a) => {
      const other = otherTeacher(a);
      return [
        [
          'an extra key naming another teacher',
          (r) =>
            r.audit.appendForTeacher(tScope(a), {
              ...teacherEntry(a),
              teacherId: teacherId(other),
            } as never),
          'invalid',
        ],
        [
          'another teacher as the acting teacher',
          (r) => r.audit.appendForTeacher(tScope(a), teacherEntry(a, { actor: teacherId(other) })),
          'scope',
        ],
        [
          'a student acting on teacher-only data',
          (r) =>
            r.audit.appendForTeacher(
              tScope(a),
              teacherEntry(a, { actor: studentId('1'), actorRole: 'student' }),
            ),
          'scope',
        ],
        [
          'an oversized before',
          (r) => r.audit.appendForTeacher(tScope(a), teacherEntry(a, { before: BIG })),
          'invalid',
        ],
        [
          'an oversized after',
          (r) => r.audit.appendForTeacher(tScope(a), teacherEntry(a, { after: BIG })),
          'invalid',
        ],
        [
          'a value JSON cannot hold',
          (r) => r.audit.appendForTeacher(tScope(a), teacherEntry(a, { before: { n: 1n } })),
          'invalid',
        ],
        [
          'a value JSON drops entirely (a function)',
          (r) => r.audit.appendForTeacher(tScope(a), teacherEntry(a, { after: () => 1 })),
          'invalid',
        ],
        [
          'an empty action',
          (r) => r.audit.appendForTeacher(tScope(a), teacherEntry(a, { action: '' })),
          'invalid',
        ],
        [
          'an unknown role',
          (r) =>
            r.audit.appendForTeacher(tScope(a), teacherEntry(a, { actorRole: 'admin' as never })),
          'invalid',
        ],
        [
          'a system role on a user id',
          (r) =>
            r.audit.appendForTeacher(
              tScope(a),
              teacherEntry(a, { actor: teacherId(a), actorRole: 'system' }),
            ),
          'scope',
        ],
        [
          'a staff role on a system actor id',
          (r) =>
            r.audit.appendForTeacher(
              tScope(a),
              teacherEntry(a, { actor: 'system_cost_alarm', actorRole: 'staff' }),
            ),
          'scope',
        ],
      ];
    },
  },
  // Task 8.1: each teacher's own profile (created in beforeAll). Writes name no target: they always
  // land on the scope's own row, so the grid checks only the payload mismatches and that nobody
  // else reads the write back.
  'teacherProfiles.create': {
    scope: 'teacher',
    op: 'write',
    owns: () => true,
    // One profile per teacher: the positive control removes the actor's own row first.
    attempt: async (r, scope, actor) => {
      await raw.query('delete from teacher_profiles where user_id = $1', [teacherId(actor)]);
      return r.teacherProfiles.create(scope, {
        slug: profileSlug(actor),
        subject: `[${actor}] subject ${++counter}`,
      });
    },
    verify: async (r, actor, res) => {
      const subject = (res as { subject: string }).subject;
      for (const t of TEACHERS) {
        const row = await r.teacherProfiles.get(tScope(t));
        expect(row?.subject === subject, `${t} sees ${actor}'s profile`).toBe(t === actor);
      }
    },
    mismatches: (a) => [
      [
        'a second profile for the same teacher',
        (r) => r.teacherProfiles.create(tScope(a), { slug: `${profileSlug(a)}-2`, subject: 'x' }),
        'invalid',
      ],
      [
        "another teacher's slug",
        (r) =>
          r.teacherProfiles.create(tScope(a), { slug: profileSlug(otherTeacher(a)), subject: 'x' }),
        'invalid',
      ],
      [
        'a verificationStatus key',
        (r) =>
          r.teacherProfiles.create(tScope(a), {
            slug: 'self-verified',
            subject: 'x',
            verificationStatus: 'verified',
          } as never),
        'invalid',
      ],
      [
        'a student scope id',
        (r) =>
          r.teacherProfiles.create({ teacherId: studentId('1') }, { slug: 'stu', subject: 'x' }),
        'scope',
      ],
    ],
  },
  'teacherProfiles.get': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.teacherProfiles.get(scope),
    random: (r, _scope, rid) => r.teacherProfiles.get({ teacherId: rid }),
    owners: (x: { teacherId: string; subject: string } | null) =>
      x ? [teacherOfId(x.teacherId), ...markers(x.subject)] : [],
  },
  'teacherProfiles.update': {
    scope: 'teacher',
    op: 'write',
    owns: () => true,
    attempt: (r, scope, actor) =>
      r.teacherProfiles.update(scope, { subject: `[${actor}] edited ${++counter}` }),
    verify: async (r, actor, res) => {
      const subject = (res as { subject: string }).subject;
      for (const t of TEACHERS) {
        const row = await r.teacherProfiles.get(tScope(t));
        expect(row?.subject === subject, `${t} sees ${actor}'s edit`).toBe(t === actor);
      }
    },
    mismatches: (a) => [
      [
        'a verificationStatus key (no self-verification)',
        (r) => r.teacherProfiles.update(tScope(a), { verificationStatus: 'verified' } as never),
        'invalid',
      ],
      [
        'a userId key naming another teacher',
        (r) =>
          r.teacherProfiles.update(tScope(a), {
            subject: 'x',
            userId: teacherId(otherTeacher(a)),
          } as never),
        'invalid',
      ],
      ['an empty patch', (r) => r.teacherProfiles.update(tScope(a), {}), 'invalid'],
      [
        'a scope with no profile',
        (r) => r.teacherProfiles.update({ teacherId: studentId('1') }, { subject: 'x' }),
        'not_found',
      ],
    ],
  },
  // Staff verify one named teacher (the audit.appendForTeacher precedent): the staff role is
  // checked in the same transaction, and the audit row lands in that teacher only.
  'teacherProfiles.setVerification': {
    scope: 'teacher',
    op: 'write',
    owns: () => true,
    attempt: async (r, scope, actor) => {
      const reason = `[${actor}] verified ${++counter}`;
      await r.teacherProfiles.setVerification(scope, { status: 'verified', by: ISO_STAFF, reason });
      return reason;
    },
    verify: async (r, actor, reason) => {
      expect((await r.teacherProfiles.get(tScope(actor)))?.verificationStatus).toBe('verified');
      for (const t of TEACHERS) {
        const rows = await r.audit.listForTeacher(tScope(t), { limit: 200 });
        expect(
          rows.some((x) => x.reason === reason && x.action === 'teacher.verify'),
          `${t} sees ${actor}'s verification`,
        ).toBe(t === actor);
      }
    },
    mismatches: (a) => [
      [
        'the teacher verifying themself',
        (r) =>
          r.teacherProfiles.setVerification(tScope(a), { status: 'verified', by: teacherId(a) }),
        'scope',
      ],
      [
        'another teacher as the verifier',
        (r) =>
          r.teacherProfiles.setVerification(tScope(a), {
            status: 'verified',
            by: teacherId(otherTeacher(a)),
          }),
        'scope',
      ],
      [
        'a student as the verifier',
        (r) =>
          r.teacherProfiles.setVerification(tScope(a), { status: 'verified', by: studentId('1') }),
        'scope',
      ],
      [
        'an extra key naming another teacher',
        (r) =>
          r.teacherProfiles.setVerification(tScope(a), {
            status: 'verified',
            by: ISO_STAFF,
            teacherId: teacherId(otherTeacher(a)),
          } as never),
        'invalid',
      ],
      [
        'a scope with no profile',
        (r) =>
          r.teacherProfiles.setVerification(
            { teacherId: studentId('1') },
            { status: 'verified', by: ISO_STAFF },
          ),
        'not_found',
      ],
    ],
  },
  // The publish guard: with only the actor verified, only the actor passes it.
  'teacherProfiles.assertVerifiedForPublish': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: async (r, scope) => {
      await raw.query(
        `update teacher_profiles set verification_status =
           case when user_id = $1 then 'verified' else 'pending' end::teacher_verification_status`,
        [scope.teacherId],
      );
      const passed: string[] = [];
      for (const t of TEACHERS) {
        const ok = await r.teacherProfiles.assertVerifiedForPublish(tScope(t)).then(
          () => true,
          () => false,
        );
        if (ok) passed.push(t);
      }
      return passed;
    },
    random: async (r, _scope, rid) =>
      r.teacherProfiles.assertVerifiedForPublish({ teacherId: rid }).then(
        () => [rid],
        () => [],
      ),
    owners: (passed: string[]) => passed,
  },
  'audit.appendForStudent': {
    scope: 'student',
    op: 'write',
    owns: () => true,
    attempt: async (r, scope, actor) => {
      const e = studentEntry(actor);
      await r.audit.appendForStudent(scope, e);
      return e.reason;
    },
    verify: async (r, actor, reason) => {
      await onlyPairSees(
        (sc) => r.audit.listForStudent(sc, { limit: 200 }),
        actor,
        (x) => (x as AuditRow[]).some((a) => a.reason === reason),
      );
      // A student's memory change is in no teacher's own audit list.
      for (const t of TEACHERS) {
        const rows = await r.audit.listForTeacher(tScope(t), { limit: 200 });
        expect(
          rows.some((a) => a.reason === reason),
          `${t} sees ${actor}'s row`,
        ).toBe(false);
      }
    },
    mismatches: (a) => [
      [
        'another student as the acting student',
        (r) => r.audit.appendForStudent(sScope(a), studentEntry(a, { actor: otherStudent(a) })),
        'scope',
      ],
      [
        'another teacher as the acting teacher',
        (r) =>
          r.audit.appendForStudent(
            sScope(a),
            studentEntry(a, { actor: teacherId(otherTeacher(teacherOf(a))), actorRole: 'teacher' }),
          ),
        'scope',
      ],
      [
        'an extra key naming another student',
        (r) =>
          r.audit.appendForStudent(sScope(a), {
            ...studentEntry(a),
            studentId: otherStudent(a),
          } as never),
        'invalid',
      ],
      [
        'an oversized after',
        (r) => r.audit.appendForStudent(sScope(a), studentEntry(a, { after: BIG })),
        'invalid',
      ],
    ],
  },
  'audit.listForTeacher': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.audit.listForTeacher(scope, { limit: 200 }),
    random: (r, _scope, rid) => r.audit.listForTeacher({ teacherId: rid }, { limit: 200 }),
    owners: (rows: AuditRow[]) => auditOwners(rows, 'teacher'),
  },
  'audit.listForStudent': {
    scope: 'student',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.audit.listForStudent(scope, { limit: 200 }),
    random: (r, _scope, rid) =>
      r.audit.listForStudent({ studentId: rid, teacherId: rid }, { limit: 200 }),
    owners: (rows: AuditRow[]) => auditOwners(rows, 'student'),
  },
  // Task 2.4. Writes: any student of a teacher may be billed on that teacher's package, so the
  // owner is the teacher half of the pair; another teacher's package is not_found.
  'usageLedger.record': {
    scope: 'student',
    op: 'write',
    owns: (a, t) => teacherOf(a) === teacherOf(t),
    attempt: async (r, scope, _actor, target) => {
      const turnId = uid('turn_rec');
      await r.usageLedger.record(scope, ids.pkg(teacherOf(target)), {
        turnId,
        source: 'subscription',
        usage: { model: 'priced', tier: 'main', inputTokens: 3, outputTokens: 4, costMicroUsd: 9 },
      });
      return turnId;
    },
    verify: (r, actor, turnId) => onlyPairSeesTurn(r, actor, turnId as string),
    mismatches: (a) => [
      [
        'negative tokens',
        (r) =>
          r.usageLedger.record(sScope(a), ids.pkg(teacherOf(a)), {
            turnId: uid('turn_bad'),
            source: 'subscription',
            usage: { model: 'm', tier: 'main', inputTokens: -1, outputTokens: 0, costMicroUsd: 0 },
          }),
        'invalid',
      ],
      [
        'an empty model',
        (r) =>
          r.usageLedger.record(sScope(a), ids.pkg(teacherOf(a)), {
            turnId: uid('turn_bad'),
            source: 'subscription',
            usage: { model: '', tier: 'main', inputTokens: 1, outputTokens: 1, costMicroUsd: 1 },
          }),
        'invalid',
      ],
      [
        'an unknown source',
        (r) =>
          r.usageLedger.record(sScope(a), ids.pkg(teacherOf(a)), {
            turnId: uid('turn_bad'),
            source: 'free' as never,
            usage: { model: 'm', tier: 'main', inputTokens: 1, outputTokens: 1, costMicroUsd: 1 },
          }),
        'invalid',
      ],
      [
        'a package id that is not an id',
        (r) =>
          r.usageLedger.record(sScope(a), "pkg' or 1=1", {
            turnId: uid('turn_bad'),
            source: 'subscription',
            usage: { model: 'm', tier: 'main', inputTokens: 1, outputTokens: 1, costMicroUsd: 1 },
          }),
        'invalid',
      ],
    ],
  },
  'usageLedger.recordUnmetered': {
    scope: 'student',
    op: 'write',
    owns: (a, t) => teacherOf(a) === teacherOf(t),
    attempt: async (r, scope, _actor, target) => {
      const turnId = uid('turn_unk');
      await r.usageLedger.recordUnmetered(scope, ids.pkg(teacherOf(target)), {
        turnId,
        source: 'eval',
        tier: 'small',
        reason: 'no_usage_reported',
      });
      return turnId;
    },
    verify: (r, actor, turnId) => onlyPairSeesTurn(r, actor, turnId as string),
    mismatches: (a) => {
      const base = { turnId: 'turn_bad', source: 'subscription', tier: 'main' } as const;
      const write = (entry: unknown) => (r: Repos) =>
        r.usageLedger.recordUnmetered(sScope(a), ids.pkg(teacherOf(a)), entry as never);
      return [
        [
          'unknown usage with tokens',
          write({
            ...base,
            reason: 'no_usage_reported',
            tokens: { inputTokens: 1, outputTokens: 1 },
          }),
          'invalid',
        ],
        [
          'unknown usage with an empty model',
          write({ ...base, reason: 'no_usage_reported', model: '' }),
          'invalid',
        ],
        [
          'unpriced without tokens',
          write({ ...base, reason: 'unpriced_model:m', model: 'm' }),
          'invalid',
        ],
        [
          'unpriced naming another model',
          write({
            ...base,
            reason: 'unpriced_model:x',
            model: 'm',
            tokens: { inputTokens: 1, outputTokens: 1 },
          }),
          'invalid',
        ],
        ['a free-text reason', write({ ...base, reason: 'student said hello' }), 'invalid'],
      ];
    },
  },
  'usageLedger.listForTurn': {
    scope: 'student',
    op: 'read',
    targeted: true,
    call: (r, scope, p) => r.usageLedger.listForTurn(scope, ids.turn(p)),
    random: (r, scope, rid) => r.usageLedger.listForTurn(scope, rid),
    owners: (rows: { studentId: string; teacherId: string }[]) =>
      rows.map((u) => pairOfIds(u.studentId, u.teacherId)),
  },
  'usageLedger.sumForStudent': {
    scope: 'student',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.usageLedger.sumForStudent(scope),
    random: (r, _scope, rid) => r.usageLedger.sumForStudent({ studentId: rid, teacherId: rid }),
    // Exact sums per pair are checked against raw SQL in "cost per turn and per student" below.
    owners: (x: { studentId: string; teacherId: string; calls: number }) =>
      x.calls > 0 ? [pairOfIds(x.studentId, x.teacherId)] : [],
  },
  'usageLedger.sumForTeacherSince': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.usageLedger.sumForTeacherSince(scope, '2000-01-01T00:00:00Z'),
    random: (r, _scope, rid) =>
      r.usageLedger.sumForTeacherSince({ teacherId: rid }, '2000-01-01T00:00:00Z'),
    // Exact sums, eval exclusion and the date bound are checked in cost-alarm.int.test.ts.
    owners: (x: { teacherId: string; calls: number }) =>
      x.calls > 0 ? [teacherOfId(x.teacherId)] : [],
  },
  // Task 3.8: the scheduled cost alarm's teacher list. A system read across teachers (README
  // rule 11): teacher ids only, nothing about students, packages or figures.
  'usageLedger.teacherIdsWithUsageSince': {
    scope: 'public',
    op: 'read',
    check: async (r) => {
      const all = await r.usageLedger.teacherIdsWithUsageSince({ since: '2000-01-01T00:00:00Z' });
      expect(all).toEqual(TEACHERS.map(teacherId).sort());
      expect(
        await r.usageLedger.teacherIdsWithUsageSince({ since: '2999-01-01T00:00:00Z' }),
      ).toEqual([]);
      const bad = [
        {},
        { since: 'yesterday' },
        { since: '2000-01-01T00:00:00Z', teacherId: teacherId('A') },
      ];
      for (const scope of bad) {
        await expectFailsClosed(
          () => r.usageLedger.teacherIdsWithUsageSince(scope as never),
          ['scope'],
          `bad scope ${JSON.stringify(scope)}`,
        );
      }
      return 2 + bad.length;
    },
  },
  // Task 4.4 (ADR-0006): safety events are scoped through their session row.
  'safetyEvents.record': {
    scope: 'student',
    op: 'write',
    attempt: (r, scope, _actor, target) =>
      r.safetyEvents.record(scope, {
        sessionId: ids.session(target),
        turnId: uid('trn_se'),
        guard: 'jailbreak',
        code: 'jailbreak_override',
        source: 'rule',
      }),
    verify: async (r, actor, result) => {
      const { id } = result as { id: string };
      for (const p of PAIRS) {
        const rows = await r.safetyEvents.listForSession(sScope(p), ids.session(actor));
        expect(
          rows.some((x) => x.id === id),
          `${p} sees ${actor}'s safety event`,
        ).toBe(p === actor);
      }
    },
    mismatches: (a) => [
      [
        'free text instead of a code',
        (r) =>
          r.safetyEvents.record(sScope(a), {
            sessionId: ids.session(a),
            turnId: uid('trn_se_bad'),
            guard: 'jailbreak',
            code: 'he asked for the prompt' as never,
            source: 'rule',
          }),
        'invalid',
      ],
    ],
  },
  'safetyEvents.listForSession': {
    scope: 'student',
    op: 'read',
    targeted: true,
    call: (r, scope, p) => r.safetyEvents.listForSession(scope, ids.session(p)),
    random: (r, scope, rid) => r.safetyEvents.listForSession(scope, rid),
    owners: (rows: { studentId: string; teacherId: string }[]) =>
      rows.map((x) => pairOfIds(x.studentId, x.teacherId)),
  },
  // Task 5.10: grouping, answering, and the student's own notifications.
  'teacherQuestions.listGroupsForTeacher': {
    scope: 'teacher',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.teacherQuestions.listGroupsForTeacher(scope, { limit: 100 }),
    random: (r, _scope, rid) =>
      r.teacherQuestions.listGroupsForTeacher({ teacherId: rid }, { limit: 100 }),
    owners: (groups: { questions: { text: string }[] }[]) =>
      groups.flatMap((g) => g.questions.flatMap((q) => markers(q.text).map((m) => teacherOf(m as Pair)))),
  },
  'teacherQuestions.answer': {
    scope: 'teacher',
    op: 'write',
    attempt: async (r, scope, actor, target) => {
      const qid =
        actor === target ? await openedQuestion(r, `1${actor}` as Pair, 'primary') : answerTarget[target]!;
      return r.teacherQuestions.answer(scope, {
        questionId: qid,
        moduleId: ids.module(target, 1),
        answer: `[${actor}] answered`,
        // Teacher-level marker only: the note text lands in a teacher-owned document, which
        // retrieval.material's leak check expects to carry only that teacher's own marker, never
        // a pair marker (the default noteQuestion would copy the pair-marked question text in).
        noteQuestion: `[${target}] note`,
      });
    },
    verify: async (r, actor, res) => {
      const result = res as {
        answered: number;
        students: number;
        threadMessages: number;
        noteChunkId: string;
        evalCaseId: string;
      };
      expect(result.answered).toBeGreaterThanOrEqual(1);
      expect(Object.keys(result).sort()).toEqual(
        ['answered', 'evalCaseId', 'noteChunkId', 'students', 'threadMessages'].sort(),
      );
      expect(JSON.stringify(result)).not.toMatch(/stu_/);
      for (const p of PAIRS) {
        const notes = await r.notifications.listForStudent(sScope(p), {
          unreadOnly: false,
          limit: 50,
        });
        const mine = teacherOf(p) === actor && studentOf(p) === '1';
        expect(
          notes.some((n) => n.answer === `[${actor}] answered`),
          `${p} sees ${actor}'s answer`,
        ).toBe(mine);
      }
    },
    mismatches: (a) => {
      const other = otherTeacher(a);
      return [
        [
          'an empty answer after trimming',
          (r) =>
            r.teacherQuestions.answer(tScope(a), {
              questionId: answerEmpty[a]!,
              moduleId: ids.module(a, 1),
              answer: '   ',
            }),
          'invalid',
        ],
        [
          'a replay of an already-answered question',
          (r) =>
            r.teacherQuestions.answer(tScope(a), {
              questionId: answerReplay[a]!,
              moduleId: ids.module(a, 1),
              answer: 'second',
            }),
          'not_found',
        ],
        [
          'a dismissed question',
          (r) =>
            r.teacherQuestions.answer(tScope(a), {
              questionId: answerDismissed[a]!,
              moduleId: ids.module(a, 1),
              answer: 'x',
            }),
          'not_found',
        ],
        [
          "another teacher's module",
          (r) =>
            r.teacherQuestions.answer(tScope(a), {
              questionId: answerWrongModule[a]!,
              moduleId: ids.module(other, 1),
              answer: 'x',
            }),
          'not_found',
        ],
      ];
    },
  },
  'teacherQuestions.dismiss': {
    scope: 'teacher',
    op: 'write',
    attempt: async (r, scope, actor, target) => {
      const qid =
        actor === target
          ? await openedQuestion(r, `1${actor}` as Pair, 'dismiss-own')
          : dismissTarget[target]!;
      await r.teacherQuestions.dismiss(scope, qid);
      return { id: qid };
    },
    verify: async (r, actor, res) => {
      const { id } = res as { id: string };
      const open = await r.teacherQuestions.listForTeacher(tScope(actor), {
        status: 'open',
        limit: 200,
      });
      expect(open.some((q) => q.id === id)).toBe(false);
    },
    mismatches: (a) => [
      [
        'a missing question id',
        (r) => r.teacherQuestions.dismiss(tScope(a), uid('tq_missing')),
        'not_found',
      ],
      [
        'an already-dismissed question',
        (r) => r.teacherQuestions.dismiss(tScope(a), dismissReplay[a]!),
        'not_found',
      ],
      [
        'an already-answered question',
        (r) => r.teacherQuestions.dismiss(tScope(a), answerReplay[a]!),
        'not_found',
      ],
    ],
  },
  'notifications.listForStudent': {
    scope: 'student',
    op: 'read',
    targeted: false,
    call: (r, scope) => r.notifications.listForStudent(scope, { unreadOnly: false, limit: 50 }),
    random: (r, _scope, rid) =>
      r.notifications.listForStudent({ studentId: rid, teacherId: rid }, {
        unreadOnly: false,
        limit: 50,
      }),
    owners: (rows: { questionText: string }[]) => rows.flatMap((x) => markers(x.questionText)),
  },
  'notifications.markRead': {
    scope: 'student',
    op: 'write',
    attempt: async (r, scope, actor, target) => {
      const id = actor === target ? await makeNotification(r, target) : notifTarget[target]!;
      await r.notifications.markRead(scope, id);
      return { id };
    },
    verify: async (r, actor, res) => {
      const { id } = res as { id: string };
      for (const p of PAIRS) {
        const notes = await r.notifications.listForStudent(sScope(p), {
          unreadOnly: false,
          limit: 50,
        });
        const found = notes.find((n) => n.id === id);
        if (p === actor) {
          expect(found?.readAt, `${p} marks its own read`).not.toBeNull();
        } else {
          expect(found, `${p} sees ${actor}'s notification`).toBeUndefined();
        }
      }
    },
    mismatches: (a) => [
      [
        'a missing notification id',
        (r) => r.notifications.markRead(sScope(a), uid('ntf_missing')),
        'not_found',
      ],
    ],
  },
};

/** Opens a fresh question under `pair`'s own scope (task 5.10 isolation cases). */
async function openedQuestion(r: Repos, pair: Pair, label: string): Promise<string> {
  const q = await r.teacherQuestions.open(sScope(pair), {
    agentId: ids.agent(teacherOf(pair)),
    text: `[${pair}] ANSWER-TEST-${label}-${uid('q')}`,
    similarIds: [],
  });
  return q.id;
}

/** A fresh open question for `pair`, with a `notifications` row pointing at it (raw insert: the
 * only writer of `notifications` is `teacherQuestions.answer`, not a student-scoped call). */
async function makeNotification(r: Repos, pair: Pair): Promise<string> {
  const qid = await openedQuestion(r, pair, 'notif');
  const notifId = uid('ntf');
  await raw.query(
    `insert into notifications (id, student_id, teacher_id, kind, teacher_question_id)
     values ($1, $2, $3, 'teacher_answer', $4)`,
    [notifId, studentId(studentOf(pair)), teacherId(teacherOf(pair)), qid],
  );
  return notifId;
}

/** After a usage write by `actor` on turn `turnId`: only the actor's scope sees that turn. */
async function onlyPairSeesTurn(r: Repos, actor: Pair, turnId: string) {
  for (const p of PAIRS) {
    const rows = await r.usageLedger.listForTurn(sScope(p), turnId);
    expect(rows.length, `${p} sees ${actor}'s usage row`).toBe(p === actor ? 1 : 0);
  }
}

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
      for (const t of TEACHERS) {
        await repos.documents.create(tScope(t), {
          id: isoDoc(t),
          moduleId: ids.module(t, 1),
          kind: 'material',
          sourceTitle: `[${t}] doc`,
        });
        await repos.chunks.insertMany(tScope(t), isoDoc(t), [
          { ord: 0, text: `[${t}] isolation marker`, locator: 'p1' },
        ]);
        // Task 8.3: chunks.listForModule reads ready documents only.
        await repos.documents.updateStatus(tScope(t), isoDoc(t), 'processing');
        await repos.documents.updateStatus(tScope(t), isoDoc(t), 'ready');
        await repos.documents.create(tScope(t), {
          id: keyDoc(t),
          moduleId: ids.module(t, 1),
          kind: 'material',
          sourceTitle: `[${t}] keyed doc`,
          storageKey: keyOf(t),
        });
        await repos.chunks.insertMany(tScope(t), keyDoc(t), [
          { ord: 0, text: `[${t}] keyed marker`, locator: 'p1' },
        ]);
      }
      for (const target of TEACHERS) {
        for (const actor of TEACHERS) {
          await repos.documents.create(tScope(target), {
            id: delDoc(actor, target),
            moduleId: ids.module(target, 1),
            kind: 'material',
            sourceTitle: `[${target}] deletable`,
            storageKey: `[${target}] del`,
          });
          await repos.chunks.insertMany(tScope(target), delDoc(actor, target), [
            { ord: 0, text: `[${target}] deletable chunk`, locator: 'p1' },
          ]);
        }
        await repos.documents.create(tScope(target), {
          id: repDoc(target),
          moduleId: ids.module(target, 1),
          kind: 'material',
          sourceTitle: `[${target}] replaceable`,
          storageKey: `[${target}] rep`,
        });
      }
      await raw.query(
        `insert into users (id, name, locale, market, role) values ($1, 'Iso Staff', 'en', 'test', 'staff')`,
        [ISO_STAFF],
      );
      for (const t of TEACHERS) {
        await repos.teacherProfiles.create(tScope(t), {
          slug: profileSlug(t),
          subject: `[${t}] subject`,
        });
      }
      for (const p of PAIRS) {
        const t = teacherOf(p);
        await raw.query(
          `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
           values ($1, $2, $3, $4, 1, $5, 1)`,
          [endable(p), studentId(studentOf(p)), teacherId(t), ids.agent(t), ids.pkg(t)],
        );
        await raw.query(
          `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
           values ($1, $2, $3, $4, 1, $5, 1)`,
          [endable2(p), studentId(studentOf(p)), teacherId(t), ids.agent(t), ids.pkg(t)],
        );
      }
      // Task 5.10: fixed fixtures for teacherQuestions.answer / notifications' isolation cases.
      for (const t of TEACHERS) {
        const p = `1${t}` as Pair;
        answerTarget[t] = await openedQuestion(repos, p, 'cross');
        answerEmpty[t] = await openedQuestion(repos, p, 'empty');
        answerWrongModule[t] = await openedQuestion(repos, p, 'wrong-module');
        const dismissId = await openedQuestion(repos, p, 'dismissed');
        await raw.query(`update teacher_questions set status = 'dismissed' where id = $1`, [
          dismissId,
        ]);
        answerDismissed[t] = dismissId;
        const replayId = await openedQuestion(repos, p, 'replay');
        await repos.teacherQuestions.answer(tScope(t), {
          questionId: replayId,
          moduleId: ids.module(t, 1),
          answer: 'first answer',
          noteQuestion: `[${t}] replay note`,
        });
        answerReplay[t] = replayId;
        dismissTarget[t] = await openedQuestion(repos, p, 'dismiss-cross');
        const dismissReplayId = await openedQuestion(repos, p, 'dismiss-replay');
        await repos.teacherQuestions.dismiss(tScope(t), dismissReplayId);
        dismissReplay[t] = dismissReplayId;
      }
      for (const p of PAIRS) {
        notifTarget[p] = await makeNotification(repos, p);
      }
      for (const t of TEACHERS) {
        savePkg[t] = (
          await repos.packages.create(tScope(t), { agentId: ids.agent(t), draft: pkgDraft(t) })
        ).packageId;
      }
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
        if (c.scope === 'public') {
          cases += await c.check(repos);
          summary.push(`${method.padEnd(34)} public  read  cases=${cases} leaks=0`);
          return;
        }
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
      // Task 5.10: `answer` may have already answered some of teacher A's questions elsewhere in
      // this suite, so this only checks the status filter actually filters (no overlap with
      // `open`), not that the list is empty.
      const answered = await repos.teacherQuestions.listForTeacher(tScope('A'), {
        status: 'answered',
        limit: 200,
      });
      for (const q of answered) {
        expect(Object.keys(q)).not.toContain('studentId');
        expect(rows.some((o) => o.id === q.id)).toBe(false);
      }
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
              packageId: ids.pkg('A'),
              packageVersion: 1,
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

    it('openDatabase gives repositories, the identity store and a close, without a raw handle', async () => {
      const opened = openDatabase({ DATABASE_URL: TEST_URL });
      try {
        expect(Object.keys(opened).sort()).toEqual(['close', 'identity', 'repos']);
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
      // Task 5.10: `answer` may already have answered other questions of teacher B's elsewhere in
      // this suite, so this checks `tq_2b` is among them (and none leak studentId) rather than
      // that it is the only one.
      const answeredForB = await repos.teacherQuestions.listForTeacher(tScope('B'), {
        status: 'answered',
        limit: 200,
      });
      expect(answeredForB.some((r) => r.id === 'tq_2b')).toBe(true);
      for (const r of answeredForB) expect(r).not.toHaveProperty('studentId');

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

    it('a statement timeout surfaces scrubbed: no ids, no message text, no SQL params', async () => {
      // A short statement timeout and a lock held by another connection force a real pg error.
      const slow = createDb({ DATABASE_URL: TEST_URL, DATABASE_STATEMENT_TIMEOUT_MS: '200' });
      const slowRepos = createRepositories(slow.db);
      const locker = new pg.Client({ connectionString: TEST_URL });
      await locker.connect();
      try {
        await locker.query('begin');
        await locker.query('lock table messages in access exclusive mode');
        const secrets = ['stu_1', 'tch_a', 'ses_1a', 'msg_timeout_1', 'very private homework'];
        const h = await slowRepos.messages
          .history(sScope('1A'), ids.session('1A'), 10)
          .catch((e: unknown) => e);
        expectScrubbed(h, 'messages.history', secrets);
        expect((h as RepositoryError).cause).toMatchObject({ code: '57014' });
        const a = await slowRepos.messages
          .append(sScope('1A'), ids.session('1A'), {
            id: 'msg_timeout_1',
            role: 'student',
            text: 'very private homework',
            createdAt: '2026-10-17T14:00:00Z',
          })
          .catch((e: unknown) => e);
        expectScrubbed(a, 'messages.append', secrets);
      } finally {
        await locker.query('rollback');
        await locker.end();
        await slow.close();
      }
    });

    it("a message id already used in another student's session reads as not_found", async () => {
      // msg_1b_1 exists in student 1's session with teacher B. Reusing it from 2A must look exactly
      // like appending to a session that isn't yours, so ids can't be probed.
      await expectFailsClosed(
        () =>
          repos.messages.append(sScope('2A'), ids.session('2A'), {
            id: 'msg_1b_1',
            role: 'student',
            text: '[2A] probe',
            createdAt: '2026-10-17T14:00:00Z',
          }),
        ['not_found'],
        'duplicate message id',
      );
    });

    it('config, staff and memory changes write before/after rows, personal keys redacted', async () => {
      // Config: teacher A publishes a package version.
      await repos.audit.appendForTeacher(tScope('A'), {
        actor: teacherId('A'),
        actorRole: 'teacher',
        action: 'package.publish',
        target: `package:${ids.pkg('A')}`,
        before: { liveVersion: 1, name: '[A] Old name', moduleIds: [ids.module('A', 1)] },
        after: { liveVersion: 2, name: '[A] New name', moduleIds: [ids.module('A', 2)] },
      });
      // Staff: a staff member verifies teacher B (the payload carries an email it should not).
      await repos.audit.appendForTeacher(tScope('B'), {
        actor: 'stf_1',
        actorRole: 'staff',
        action: 'teacher.verify',
        target: `teacher:${teacherId('B')}`,
        reason: 'documents checked',
        before: { verificationStatus: 'pending', contact: { email: 'b@example.test' } },
        after: { verificationStatus: 'verified' },
      });
      // Memory: student 2 resets what teacher A's agent remembers.
      await repos.audit.appendForStudent(sScope('2A'), {
        actor: studentId('2'),
        actorRole: 'student',
        action: 'profile.reset',
        target: 'profile:2a',
        reason: 'student requested reset',
        before: {
          mastery: { [ids.topic('A')]: { p: 0.5, n: 2 } },
          mistakes: [{ tag: 'sign', count: 1 }],
          displayName: 'Student Two',
        },
        after: { mastery: {}, mistakes: [] },
      });

      const [config] = await repos.audit.listForTeacher(tScope('A'), {
        target: `package:${ids.pkg('A')}`,
        limit: 1,
      });
      expect(config).toMatchObject({
        actor: 'tch_a',
        actorRole: 'teacher',
        action: 'package.publish',
        teacherId: 'tch_a',
        before: { liveVersion: 1, name: REDACTED, moduleIds: ['mod_a1'] },
        after: { liveVersion: 2, name: REDACTED, moduleIds: ['mod_a2'] },
      });
      expect(config && 'studentId' in config).toBe(false);
      expect(config && 'reason' in config).toBe(false);
      expect(Number.isNaN(Date.parse(config?.ts ?? ''))).toBe(false);

      const [staff] = await repos.audit.listForTeacher(tScope('B'), {
        target: `teacher:${teacherId('B')}`,
        limit: 1,
      });
      expect(staff).toMatchObject({
        actor: 'stf_1',
        actorRole: 'staff',
        action: 'teacher.verify',
        reason: 'documents checked',
        before: { verificationStatus: 'pending', contact: { email: REDACTED } },
        after: { verificationStatus: 'verified' },
      });

      const [memory] = await repos.audit.listForStudent(sScope('2A'), {
        target: 'profile:2a',
        limit: 1,
      });
      expect(memory).toMatchObject({
        studentId: 'stu_2',
        teacherId: 'tch_a',
        action: 'profile.reset',
        reason: 'student requested reset',
        before: {
          mastery: { top_a: { p: 0.5, n: 2 } },
          mistakes: [{ tag: 'sign', count: 1 }],
          displayName: REDACTED,
        },
        after: { mastery: {}, mistakes: [] },
      });

      // The stored jsonb itself is redacted: the raw values never reach the table.
      const stored = await raw.query<{ before: unknown; after: unknown }>(
        'select before, after from audit_log',
      );
      const all = JSON.stringify(stored.rows);
      for (const secret of ['b@example.test', 'Student Two', 'Old name', 'New name']) {
        expect(all).not.toContain(secret);
      }
    });

    it('audit lists: newest first, optional target filter, limit 1..200', async () => {
      const sc = tScope('B');
      const target = `agent:${ids.agent('B')}:order`;
      await repos.audit.appendForTeacher(sc, teacherEntry('B', { target, action: 'first' }));
      await repos.audit.appendForTeacher(sc, teacherEntry('B', { target, action: 'second' }));
      const rows = await repos.audit.listForTeacher(sc, { target, limit: 200 });
      expect(rows.map((a) => a.action)).toEqual(['second', 'first']);
      expect(await repos.audit.listForTeacher(sc, { target, limit: 1 })).toHaveLength(1);
      expect(await repos.audit.listForTeacher(sc, { target: 'agent:nowhere', limit: 5 })).toEqual(
        [],
      );
      // A row with no before/after/reason reads back without those keys.
      await repos.audit.appendForStudent(sScope('1B'), {
        actor: 'stf_2',
        actorRole: 'staff',
        action: 'safety.review',
        target: 'session:ses_1b',
      });
      const [bare] = await repos.audit.listForStudent(sScope('1B'), {
        target: 'session:ses_1b',
        limit: 1,
      });
      expect(bare?.action).toBe('safety.review');
      expect(bare && ['before', 'after', 'reason'].some((k) => k in bare)).toBe(false);
      for (const bad of [
        { limit: 0 },
        { limit: 201 },
        { limit: 1.5 },
        {},
        { limit: 5, target: '' },
        { limit: 5, target: 'x'.repeat(201) },
        { limit: 5, extra: 1 },
      ]) {
        await expect(repos.audit.listForTeacher(sc, bad as never)).rejects.toMatchObject({
          kind: 'invalid',
          method: 'audit.listForTeacher',
        });
        await expect(repos.audit.listForStudent(sScope('1B'), bad as never)).rejects.toMatchObject({
          kind: 'invalid',
          method: 'audit.listForStudent',
        });
      }
    });

    it('class instances and toJSON values are redacted as the JSON they become', async () => {
      class Teacher {
        name = 'Private Person';
        status = 'pending';
      }
      const at = new Date('2026-10-17T00:00:00Z');
      await repos.audit.appendForTeacher(tScope('A'), {
        actor: 'stf_3',
        actorRole: 'staff',
        action: 'teacher.reject',
        target: 'teacher:tch_a:json',
        before: new Teacher(),
        after: { at, contact: { toJSON: () => ({ phone: '000', ok: true }) } },
      });
      const [row] = await repos.audit.listForTeacher(tScope('A'), {
        target: 'teacher:tch_a:json',
        limit: 1,
      });
      expect(row?.before).toEqual({ name: REDACTED, status: 'pending' });
      expect(row?.after).toEqual({ at: at.toISOString(), contact: { phone: REDACTED, ok: true } });
    });

    it('audit is append-only: no update or delete method exists', () => {
      expect(Object.keys(repos.audit).sort()).toEqual([
        'appendForStudent',
        'appendForTeacher',
        'listForStudent',
        'listForTeacher',
      ]);
    });

    it('an audit append by a scope whose ids are not users fails closed', async () => {
      await expectFailsClosed(
        () =>
          repos.audit.appendForTeacher(
            { teacherId: 'tch_ghost' },
            { actor: 'stf_1', actorRole: 'staff', action: 'x', target: 'teacher:tch_ghost' },
          ),
        ['not_found'],
        'ghost teacher audit',
      );
      await expectFailsClosed(
        () =>
          repos.audit.appendForStudent(
            { studentId: 'stu_ghost', teacherId: 'tch_a' },
            { actor: 'stf_1', actorRole: 'staff', action: 'x', target: 'profile:ghost' },
          ),
        ['not_found'],
        'ghost student audit',
      );
    });

    it('a stored audit row that fails its shape throws integrity', async () => {
      await raw.query(
        `insert into audit_log (id, actor, actor_role, action, target, teacher_id)
         values ('al_corrupt', '', 'teacher', 'x', 'integrity:check', 'tch_b')`,
      );
      await expect(
        repos.audit.listForTeacher(tScope('B'), { target: 'integrity:check', limit: 5 }),
      ).rejects.toMatchObject({ kind: 'integrity', method: 'audit.listForTeacher' });
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
