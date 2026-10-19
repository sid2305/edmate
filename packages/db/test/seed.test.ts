// Task 1.5: the demo seed's rows, built from content/demo-teacher/ without a database. The
// Postgres half (inserts, idempotency) is seed.int.test.ts.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDemoTeacherContent } from '@edmate/content';
import { AgentConfigSchema, PackageConfigSchema, StyleCardSchema } from '@edmate/contracts';
import {
  buildDemoSeed,
  DEMO_CONTENT_DIR,
  DEMO_IDS,
  DEMO_STUDENT_COUNT,
  SEED_TABLES,
  seedDemoTeacher,
} from '../src/seed.js';
import type { Db } from '../src/internal.js';

const content = () => loadDemoTeacherContent(DEMO_CONTENT_DIR);

describe('buildDemoSeed', () => {
  const seed = buildDemoSeed(content());

  it('builds an AgentConfig, two PackageConfigs and a StyleCard the frozen contracts accept', () => {
    const agent = AgentConfigSchema.parse(seed.agentVersions[0]?.config);
    expect(agent).toMatchObject({
      id: DEMO_IDS.agent,
      version: 1,
      teacherId: DEMO_IDS.teacher,
      courseId: 'python-basics-demo',
      styleCardId: DEMO_IDS.styleCard,
      promptPackVersion: '1.0.0',
      languages: ['en'],
    });
    // Provisional: the same policy as the gateway's DEFAULT_MODEL_POLICY (2.3), no fallback.
    expect(Object.keys(agent.modelPolicy.tiers).sort()).toEqual(['main', 'small']);
    expect(Object.values(agent.modelPolicy.tiers).every((t) => t.provider === 'anthropic')).toBe(
      true,
    );
    expect(agent.modelPolicy.fallback).toBeUndefined();

    const [free, paid] = seed.packageVersions.map((v) => PackageConfigSchema.parse(v.config));
    expect(free).toMatchObject({ id: DEMO_IDS.packageFree, version: 1, agentId: DEMO_IDS.agent });
    expect(free?.pricePerMonth.amountMinor).toBe(0);
    expect(paid).toMatchObject({ id: DEMO_IDS.packagePaid, version: 1, agentId: DEMO_IDS.agent });
    expect(paid?.pricePerMonth.amountMinor).toBeGreaterThan(0);

    const [card] = seed.styleCards;
    expect(
      StyleCardSchema.parse({
        id: card?.id,
        teacherId: card?.teacherId,
        version: card?.version,
        text: card?.text,
        mistakeTags: card?.mistakeTags,
      }).id,
    ).toBe(DEMO_IDS.styleCard);
  });

  it('takes the course and module ids from course.yaml, in file order, owned by the teacher', () => {
    expect(seed.courses).toEqual([
      expect.objectContaining({ id: 'python-basics-demo', teacherId: DEMO_IDS.teacher }),
    ]);
    expect(seed.modules.map((m) => [m.id, m.order])).toEqual([
      ['values-variables', 0],
      ['conditions', 1],
      ['loops', 2],
      ['functions', 3],
      ['lists-dicts', 4],
    ]);
    expect(seed.modules.every((m) => m.courseId === 'python-basics-demo')).toBe(true);
  });

  it('only unlocks modules the course has', () => {
    const moduleIds = new Set(seed.modules.map((m) => m.id));
    for (const v of seed.packageVersions) {
      expect(v.config.moduleIds.every((m) => moduleIds.has(m))).toBe(true);
    }
  });

  it('makes 20 fictional students: example.invalid emails, age attested, market global', () => {
    const students = seed.users.filter((u) => u.role === 'student');
    expect(students).toHaveLength(DEMO_STUDENT_COUNT);
    expect(new Set(students.map((s) => s.id)).size).toBe(20);
    expect(students[0]?.id).toBe('demo-student-01');
    expect(students[19]?.id).toBe('demo-student-20');
    for (const s of students) {
      expect(s.email).toMatch(/^demo-student-\d{2}@example\.invalid$/);
      expect(s.market).toBe('global');
      expect(s.ageConfirmedAt).toBeInstanceOf(Date);
    }
    const teachers = seed.users.filter((u) => u.role === 'teacher');
    expect(teachers.map((t) => t.id)).toEqual([DEMO_IDS.teacher]);
    expect(teachers[0]?.email).toMatch(/@example\.invalid$/);
  });

  it('splits subscriptions 5 free, 5 paid-active, 5 paused, 5 ended; one per student', () => {
    const subs = seed.subscriptions;
    expect(subs).toHaveLength(20);
    expect(new Set(subs.map((s) => s.studentId)).size).toBe(20);
    const kind = (s: (typeof subs)[number]) =>
      `${s.packageVersionId === DEMO_IDS.packageVersionFree ? 'free' : 'paid'}:${s.status}`;
    const counts: Record<string, number> = {};
    for (const s of subs) counts[kind(s)] = (counts[kind(s)] ?? 0) + 1;
    expect(counts['free:active']).toBe(5);
    expect(counts['paid:active']).toBe(5);
    expect(counts['paid:paused']).toBe(5);
    expect(subs.filter((s) => s.status === 'ended')).toHaveLength(5);
    expect(subs.every((s) => s.teacherId === DEMO_IDS.teacher)).toBe(true);
  });

  it('is deterministic: the same content gives the same rows', () => {
    expect(buildDemoSeed(content())).toEqual(seed);
  });

  it('names every table it writes', () => {
    for (const table of SEED_TABLES) expect(seed[table].length).toBeGreaterThan(0);
  });
});

describe('seedDemoTeacher content errors', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('refuses a content dir that fails to load, before touching the database', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as Db;
    await expect(seedDemoTeacher(db, { contentDir: '/nonexistent/edmate-seed' })).rejects.toThrow(
      /no such content directory/,
    );
  });

  it('refuses a package that unlocks a module the course does not have', async () => {
    dir = mkdtempSync(join(tmpdir(), 'edmate-seed-'));
    cpSync(DEMO_CONTENT_DIR, dir, { recursive: true });
    const paid = join(dir, 'packages/paid.yaml');
    writeFileSync(
      paid,
      [
        'name: Full course',
        'moduleIds: [values-variables, not-a-module]',
        'skills: [explain]',
        'helpCeiling: 4',
        'finalAnswers: after_attempt',
        'dailyMessageLimit: 100',
        'liveClassesPerMonth: 2',
        'pricePerMonth: { amountMinor: 999, currency: USD }',
        'lockedReply: name_package',
        '',
      ].join('\n'),
    );
    expect(() => buildDemoSeed(loadDemoTeacherContent(dir!))).toThrow(/not-a-module/);
  });
});
