// Task 9.6 Phase B, acceptance item 1: `buildExport` loops the Phase A paged readers until `next`
// is null, is scoped to one student x teacher pair, and never leaks help_state, another student's
// or another teacher's rows. No real database (rule 4): a fake backend implements the same keyset
// paging the real repositories use.
import type { EvidenceEvent, TeacherQuestion } from '@edmate/contracts';
import type { StudentScope } from '@edmate/db';
import { describe, expect, it } from 'vitest';
import {
  buildExport,
  type ExportBackend,
  type MessageExportRow,
  type SessionExportRow,
} from './buildExport';

interface Cursor {
  createdAt: string;
  id: string;
}

function pageOf<Row extends { createdAt: string; id: string }>(
  rows: Row[],
  after: Cursor | undefined,
  limit: number,
): { items: Row[]; next: Cursor | null } {
  const sorted = [...rows].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const start = after
    ? sorted.findIndex(
        (r) => r.createdAt > after.createdAt || (r.createdAt === after.createdAt && r.id > after.id),
      )
    : 0;
  const slice = start === -1 ? [] : sorted.slice(start, start + limit);
  const last = slice.at(-1);
  return { items: slice, next: last ? { createdAt: last.createdAt, id: last.id } : null };
}

function ts(i: number): string {
  // A deliberate tie at the 500/1000 page boundaries (two rows sharing one timestamp).
  const minute = i === 500 || i === 501 || i === 1000 || i === 1001 ? 0 : i;
  return new Date(Date.UTC(2026, 0, 1, 0, minute, 0)).toISOString();
}

const PAIR: StudentScope = { studentId: 'std_amy', teacherId: 'tch_asha' };
const OTHER: StudentScope = { studentId: 'std_zoe', teacherId: 'tch_bea' };

const ownSessions: SessionExportRow[] = Array.from({ length: 3 }, (_, i) => ({
  id: `ses_${String(i)}`,
  agentId: 'agt_1',
  agentVersion: 1,
  packageId: 'pkg_1',
  packageVersion: 1,
  summary: `Summary ${String(i)}`,
  createdAt: ts(i),
  endedAt: i === 2 ? null : ts(i + 1),
}));

const ownMessages: MessageExportRow[] = Array.from({ length: 1203 }, (_, i) => ({
  id: `msg_${String(i).padStart(5, '0')}`,
  role: i % 2 === 0 ? 'student' : 'agent',
  text: `Message ${String(i)}`,
  createdAt: ts(i),
  sessionId: `ses_${String(i % 3)}`,
}));

const otherSessions: SessionExportRow[] = Array.from({ length: 2 }, (_, i) => ({
  id: `oses_${String(i)}`,
  agentId: 'agt_2',
  agentVersion: 1,
  packageId: 'pkg_2',
  packageVersion: 1,
  summary: 'Other summary',
  createdAt: ts(i),
  endedAt: ts(i + 1),
}));

const otherMessages: MessageExportRow[] = Array.from({ length: 5 }, (_, i) => ({
  id: `omsg_${String(i)}`,
  role: 'student',
  text: 'Other message',
  createdAt: ts(i),
  sessionId: `oses_${String(i % 2)}`,
}));

const EVIDENCE: EvidenceEvent[] = [
  {
    studentId: 'std_amy',
    teacherId: 'tch_asha',
    topicId: 'top_1',
    correct: true,
    source: 'check',
    weight: 1,
    ts: ts(0),
  },
];

const QUESTIONS: TeacherQuestion[] = [
  {
    id: 'tq_1',
    teacherId: 'tch_asha',
    agentId: 'agt_1',
    studentId: 'std_amy',
    text: 'Why does the denominator matter?',
    similarIds: [],
    status: 'answered',
    createdAt: ts(0),
    answeredAt: ts(1),
  },
];

function sameScope(a: StudentScope, b: StudentScope): boolean {
  return a.studentId === b.studentId && a.teacherId === b.teacherId;
}

function fakeBackend(options: { questions?: TeacherQuestion[]; evidenceTruncated?: boolean } = {}) {
  const calls: string[] = [];
  const backend: ExportBackend = {
    agents: { owner: async () => ({ teacherId: 'tch_asha' }) },
    sessions: {
      listForStudent: async (scope, opts) => {
        calls.push('sessions.listForStudent');
        const rows = sameScope(scope, PAIR) ? ownSessions : sameScope(scope, OTHER) ? otherSessions : [];
        return pageOf(rows, opts.after as Cursor | undefined, opts.limit);
      },
    },
    messages: {
      listForStudent: async (scope, opts) => {
        calls.push('messages.listForStudent');
        const rows = sameScope(scope, PAIR) ? ownMessages : sameScope(scope, OTHER) ? otherMessages : [];
        return pageOf(rows, opts.after as Cursor | undefined, opts.limit);
      },
    },
    learnerProfiles: {
      get: async (scope) =>
        sameScope(scope, PAIR)
          ? { studentId: 'std_amy', teacherId: 'tch_asha', lang: 'en', mastery: {}, mistakes: [] }
          : null,
    },
    evidenceEvents: {
      list: async (scope) =>
        sameScope(scope, PAIR)
          ? { events: EVIDENCE, truncated: options.evidenceTruncated ?? false }
          : { events: [], truncated: false },
    },
    teacherQuestions: {
      listForStudent: async (scope) =>
        sameScope(scope, PAIR) ? options.questions ?? QUESTIONS : [],
    },
    subscriptions: {
      findLive: async (scope) =>
        sameScope(scope, PAIR)
          ? { id: 'sub_1', packageVersionId: 'pv_1', status: 'active', periodEnd: ts(400) }
          : null,
    },
    packageVersions: {
      getById: async () => ({ id: 'pkg_1', name: 'Fractions', version: 1, moduleIds: ['mod_1'] }),
    },
    outline: {
      getOutline: async () => null,
    },
  };
  return { backend, calls };
}

describe('buildExport', () => {
  it('includes every own session, message, evidence event and question exactly once, in order', async () => {
    const { backend } = fakeBackend();
    const json = await buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z');

    expect(json.sessions.map((s) => s.id)).toEqual(['ses_0', 'ses_1', 'ses_2']);
    const allMessages = json.sessions.flatMap((s) => s.messages);
    expect(allMessages).toHaveLength(1203);
    const ids = new Set(allMessages.map((m) => m.id));
    expect(ids.size).toBe(1203);
    for (const m of ownMessages) expect(ids.has(m.id)).toBe(true);
    // Oldest first within each session (own ordering is global; each session's own slice stays sorted).
    for (const session of json.sessions) {
      const createdAts = session.messages.map((m) => m.createdAt);
      expect([...createdAts].sort()).toEqual(createdAts);
    }
    expect(json.evidence).toEqual(EVIDENCE);
    expect(json.teacherQuestions).toEqual(QUESTIONS);
    expect(json.counts).toEqual({ sessions: 3, messages: 1203, evidence: 1, teacherQuestions: 1 });
  });

  it('never includes another student or teacher\'s rows', async () => {
    const { backend } = fakeBackend();
    const json = await buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z');
    const allMessages = json.sessions.flatMap((s) => s.messages);
    for (const m of otherMessages) expect(allMessages.find((x) => x.text === m.text)).toBeUndefined();
    expect(json.sessions.find((s) => s.id.startsWith('oses_'))).toBeUndefined();
  });

  it('never reads or serialises help_state, helpState, mustNotReveal or answerKey', async () => {
    const { backend } = fakeBackend();
    const json = await buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z');
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/help_state|helpState|mustNotReveal|answerKey/);
  });

  it('a truncated evidence source sets complete:false and names the section', async () => {
    const { backend } = fakeBackend({ evidenceTruncated: true });
    const json = await buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z');
    expect(json.complete).toBe(false);
    expect(json.truncated).toEqual(['evidence']);
  });

  it('200 questions (the listForStudent cap) sets complete:false and names teacherQuestions', async () => {
    const twoHundred: TeacherQuestion[] = Array.from({ length: 200 }, (_, i) => ({
      id: `tq_${String(i)}`,
      teacherId: 'tch_asha',
      agentId: 'agt_1',
      studentId: 'std_amy',
      text: `Q${String(i)}`,
      similarIds: [],
      status: 'open',
      createdAt: ts(i),
    }));
    const { backend } = fakeBackend({ questions: twoHundred });
    const json = await buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z');
    expect(json.complete).toBe(false);
    expect(json.truncated).toEqual(['teacherQuestions']);
  });

  it('a complete export (no truncation) is complete:true with an empty truncated list', async () => {
    const { backend } = fakeBackend();
    const json = await buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z');
    expect(json.complete).toBe(true);
    expect(json.truncated).toEqual([]);
  });

  it('a runaway pager throws rather than silently truncating', async () => {
    const backend: ExportBackend = {
      agents: { owner: async () => ({ teacherId: 'tch_asha' }) },
      sessions: {
        listForStudent: async () => ({
          items: [
            {
              id: 'x',
              agentId: 'agt_1',
              agentVersion: 1,
              packageId: null,
              packageVersion: null,
              summary: null,
              createdAt: ts(0),
              endedAt: null,
            },
          ],
          next: { createdAt: ts(0), id: 'x' }, // never resolves to null
        }),
      },
      messages: { listForStudent: async () => ({ items: [], next: null }) },
      learnerProfiles: { get: async () => null },
      evidenceEvents: { list: async () => ({ events: [], truncated: false }) },
      teacherQuestions: { listForStudent: async () => [] },
      subscriptions: { findLive: async () => null },
      packageVersions: { getById: async () => null },
      outline: { getOutline: async () => null },
    };
    await expect(
      buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z'),
    ).rejects.toThrow(/page/);
  });

  it('carries the subscription, projected package, and progress from the outline', async () => {
    const { backend } = fakeBackend();
    const json = await buildExport(backend, { ...PAIR, agentId: 'agt_1' }, '2026-10-22T00:00:00.000Z');
    expect(json.subscription).toEqual({
      status: 'active',
      periodEnd: ts(400),
      package: { id: 'pkg_1', name: 'Fractions', version: 1 },
    });
    expect(json.progress).toEqual({
      modules: [],
      counts: { topicsCovered: 0, topicsMastered: 0 },
      nextSteps: [],
      other: [],
    });
  });
});
