// Seed for the isolation test: two teachers (A, B), two students (1, 2) and every student x teacher
// pair. Synthetic ids only, no personal data. Every text field carries its owner's marker (`[1A]`
// for student 1 with teacher A, `[A]` for teacher A) so a leak is visible in any returned row.
import { demoAgentConfig, demoPackageFree } from '@edmate/contracts/fixtures';
import type { AgentConfig, PackageConfig } from '@edmate/contracts';
import type { Db } from '../src/internal.js';
import * as s from '../src/internal.js';

export const TEACHERS = ['A', 'B'] as const;
export const STUDENTS = ['1', '2'] as const;
export type Teacher = (typeof TEACHERS)[number];
export type Student = (typeof STUDENTS)[number];
/** A student x teacher pair, for example `1A`. */
export type Pair = `${Student}${Teacher}`;
export const PAIRS: Pair[] = STUDENTS.flatMap((st) => TEACHERS.map((t) => `${st}${t}` as Pair));

export const teacherId = (t: Teacher) => `tch_${t.toLowerCase()}`;
export const studentId = (st: Student) => `stu_${st}`;
export const teacherOf = (p: Pair) => p[1] as Teacher;
export const studentOf = (p: Pair) => p[0] as Student;
const lc = (p: Pair) => p.toLowerCase();

/** Ids of everything the seed creates, by owner. */
export const ids = {
  course: (t: Teacher) => `crs_${t.toLowerCase()}`,
  module: (t: Teacher, n: 1 | 2) => `mod_${t.toLowerCase()}${n}`,
  topic: (t: Teacher) => `top_${t.toLowerCase()}`,
  styleCard: (t: Teacher) => `sty_${t.toLowerCase()}`,
  agent: (t: Teacher) => `agt_${t.toLowerCase()}`,
  pkg: (t: Teacher) => `pkg_${t.toLowerCase()}`,
  packageVersion: (t: Teacher) => `pv_${t.toLowerCase()}`,
  session: (p: Pair) => `ses_${lc(p)}`,
  question: (p: Pair) => `tq_${lc(p)}`,
  subscription: (p: Pair) => `sub_${lc(p)}`,
};

export function agentConfig(t: Teacher): AgentConfig {
  return {
    ...demoAgentConfig,
    id: ids.agent(t),
    version: 1,
    teacherId: teacherId(t),
    courseId: ids.course(t),
    styleCardId: ids.styleCard(t),
  };
}

export function packageConfig(
  t: Teacher,
  version = 1,
  moduleIds = [ids.module(t, 1)],
): PackageConfig {
  return {
    ...demoPackageFree,
    id: ids.pkg(t),
    version,
    teacherId: teacherId(t),
    agentId: ids.agent(t),
    name: `[${t}] package`,
    moduleIds,
  };
}

export async function seed(db: Db): Promise<void> {
  await db.insert(s.users).values([
    ...TEACHERS.map((t) => ({
      id: teacherId(t),
      name: `[${t}] teacher`,
      locale: 'en',
      market: 'test',
      role: 'teacher' as const,
    })),
    ...STUDENTS.map((st) => ({
      id: studentId(st),
      name: `[${st}] student`,
      locale: 'en',
      market: 'test',
      role: 'student' as const,
    })),
  ]);

  for (const t of TEACHERS) {
    const tid = teacherId(t);
    await db
      .insert(s.courses)
      .values({ id: ids.course(t), teacherId: tid, title: `[${t}]`, order: 0 });
    await db.insert(s.modules).values(
      ([1, 2] as const).map((n) => ({
        id: ids.module(t, n),
        teacherId: tid,
        courseId: ids.course(t),
        title: `[${t}] module ${n}`,
        order: n,
      })),
    );
    await db.insert(s.topics).values({
      id: ids.topic(t),
      teacherId: tid,
      moduleId: ids.module(t, 1),
      title: `[${t}] topic`,
      order: 0,
    });
    await db
      .insert(s.styleCards)
      .values({ id: ids.styleCard(t), teacherId: tid, version: 1, text: `[${t}] style` });
    await db
      .insert(s.agents)
      .values({ id: ids.agent(t), teacherId: tid, status: 'live', liveVersion: 1 });
    await db.insert(s.agentVersions).values({
      id: `av_${t.toLowerCase()}`,
      teacherId: tid,
      agentId: ids.agent(t),
      version: 1,
      config: agentConfig(t),
    });
    await db.insert(s.packages).values({
      id: ids.pkg(t),
      teacherId: tid,
      agentId: ids.agent(t),
      name: `[${t}] package`,
      liveVersion: 1,
    });
    await db.insert(s.packageVersions).values({
      id: ids.packageVersion(t),
      teacherId: tid,
      packageId: ids.pkg(t),
      version: 1,
      config: packageConfig(t),
    });
  }

  for (const p of PAIRS) {
    const t = teacherOf(p);
    const sid = studentId(studentOf(p));
    const tid = teacherId(t);
    await db.insert(s.sessions).values({
      id: ids.session(p),
      studentId: sid,
      teacherId: tid,
      agentId: ids.agent(t),
      agentVersion: 1,
      summary: `[${p}] summary`,
    });
    await db.insert(s.messages).values([
      {
        id: `msg_${lc(p)}_1`,
        sessionId: ids.session(p),
        role: 'student',
        text: `[${p}] question`,
        createdAt: new Date('2026-10-17T10:00:00Z'),
      },
      {
        id: `msg_${lc(p)}_2`,
        sessionId: ids.session(p),
        role: 'agent',
        text: `[${p}] answer`,
        sources: [{ title: `[${p}] notes`, locator: 'p. 1', kind: 'material' }],
        createdAt: new Date('2026-10-17T10:00:02Z'),
      },
    ]);
    await db.insert(s.turnTraces).values({
      id: `tt_${lc(p)}`,
      sessionId: ids.session(p),
      steps: [{ name: `[${p}] retrieve`, ms: 3, outcome: 'ok' }],
      model: 'scripted',
      inputTokens: 10,
      outputTokens: 5,
      costMicroUsd: 1,
    });
    await db.insert(s.learnerProfiles).values({
      studentId: sid,
      teacherId: tid,
      lang: 'en',
      mastery: { [ids.topic(t)]: { p: 0.5, n: 2, updatedAt: '2026-10-17T10:00:00Z' } },
      mistakes: [{ tag: `[${p}] sign`, count: 1, lastSeen: '2026-10-17T10:00:00Z' }],
      lastSummary: `[${p}] last time`,
    });
    await db.insert(s.evidenceEvents).values({
      studentId: sid,
      teacherId: tid,
      topicId: ids.topic(t),
      correct: true,
      source: 'check',
    });
    await db.insert(s.subscriptions).values({
      id: ids.subscription(p),
      studentId: sid,
      teacherId: tid,
      packageVersionId: ids.packageVersion(t),
      status: 'active',
      periodEnd: new Date('2026-12-01T00:00:00Z'),
    });
    await db.insert(s.teacherQuestions).values({
      id: ids.question(p),
      teacherId: tid,
      agentId: ids.agent(t),
      studentId: sid,
      text: `[${p}] why?`,
      createdAt: new Date('2026-10-17T10:05:00Z'),
    });
  }
}
