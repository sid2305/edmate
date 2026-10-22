// Task 1.5: the demo seed's rows, built from content/demo-teacher/ without a database. The
// Postgres half (inserts, idempotency) is seed.int.test.ts.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDemoTeacherContent, newestSignedSet, readPromptPackLibrary } from '@edmate/content';
import { AgentConfigSchema, PackageConfigSchema, StyleCardSchema } from '@edmate/contracts';
import * as internal from '../src/internal.js';
import {
  buildDemoSeed,
  DEMO_CONTENT_DIR,
  DEMO_IDS,
  DEMO_PROMPT_PACKS_DIR,
  DEMO_STUDENT_COUNT,
  SEED_TABLES,
  seedDemoTeacher,
} from '../src/seed.js';
import type { Db } from '../src/internal.js';

const content = () => loadDemoTeacherContent(DEMO_CONTENT_DIR);
/** buildDemoSeed is pure: the caller passes the set version in (5.8a). */
const OPTS = { promptPackVersion: '9.8.7' };

/** A Db whose one transaction records every inserted row and finds nothing on select. */
function recordingDb(): { db: Db; rows: Record<string, unknown[]> } {
  const rows: Record<string, unknown[]> = {};
  const tx = {
    insert: (t: unknown) => ({
      values: (v: unknown[]) => {
        const name = SEED_TABLES.find((n) => internal[n] === t) as string;
        rows[name] = v;
        return { onConflictDoNothing: () => ({ returning: async () => v }) };
      },
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
  const db = { transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  return { db, rows };
}

/** A copy of the real prompt-pack dir with the named set manifests set back to pending. */
function packsWithPending(sets: (v: string) => boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-seed-packs-'));
  cpSync(DEMO_PROMPT_PACKS_DIR, dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    const m = /^set@(.+)\.yaml$/.exec(f);
    if (m === null || !sets(m[1] as string)) continue;
    const p = join(dir, f);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/^reviewed_by:.*$/m, 'reviewed_by: pending'));
  }
  return dir;
}

describe('seedDemoTeacher picks the newest signed prompt-pack set at seed time (5.8a)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const agentVersion = (rows: Record<string, unknown[]>) =>
    AgentConfigSchema.parse((rows.agentVersions?.[0] as { config: unknown }).config)
      .promptPackVersion;

  it('buildDemoSeed puts the version it is given in the agent config', () => {
    const seed = buildDemoSeed(content(), { promptPackVersion: '4.5.6' });
    expect(AgentConfigSchema.parse(seed.agentVersions[0]?.config).promptPackVersion).toBe('4.5.6');
  });

  it('seeds newestSignedSet of the real content/prompt-packs (1.3.0 today)', async () => {
    const { db, rows } = recordingDb();
    await seedDemoTeacher(db);
    const want = newestSignedSet(readPromptPackLibrary(DEMO_PROMPT_PACKS_DIR))?.version;
    expect(agentVersion(rows)).toBe(want);
    expect(want).toBe('1.3.0');
  });

  it('seeds the older signed set when the newer ones are unsigned', async () => {
    dir = packsWithPending((v) => v === '1.2.0' || v === '1.3.0');
    const { db, rows } = recordingDb();
    await seedDemoTeacher(db, { promptPacksDir: dir });
    // set@1.1.0's manifest is still pending on main, so the next signed one down is 1.0.0.
    expect(agentVersion(rows)).toBe('1.0.0');
  });

  it('throws before touching the database when no set is signed', async () => {
    dir = packsWithPending(() => true);
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as Db;
    await expect(seedDemoTeacher(db, { promptPacksDir: dir })).rejects.toThrow(
      /no signed prompt-pack set/,
    );
  });

  it('throws before touching the database when the prompt-pack dir cannot be read', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('database touched');
        },
      },
    ) as Db;
    await expect(
      seedDemoTeacher(db, { promptPacksDir: '/nonexistent/edmate-packs' }),
    ).rejects.toThrow(/no such prompt-pack directory/);
  });
});

describe('buildDemoSeed', () => {
  const seed = buildDemoSeed(content(), OPTS);

  it('builds an AgentConfig, two PackageConfigs and a StyleCard the frozen contracts accept', () => {
    const agent = AgentConfigSchema.parse(seed.agentVersions[0]?.config);
    expect(agent).toMatchObject({
      id: DEMO_IDS.agent,
      version: 1,
      teacherId: DEMO_IDS.teacher,
      courseId: 'python-basics-demo',
      styleCardId: DEMO_IDS.styleCard,
      promptPackVersion: OPTS.promptPackVersion,
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
      // A fictional adult year (1.7): past the age gate, needing no parent.
      expect(s.birthYear).toBe(1990);
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
    expect(buildDemoSeed(content(), OPTS)).toEqual(seed);
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
    expect(() => buildDemoSeed(loadDemoTeacherContent(dir!), OPTS)).toThrow(/not-a-module/);
  });
});
