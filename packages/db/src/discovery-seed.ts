// Dev-only discovery seed (task 9.2): synthetic, verified teachers with a live agent and one or
// two live packages each, for exercising `discovery.search` at scale and for the manual timed
// run. Every row is fabricated (no real names, emails or personal details): ids are prefixed
// `seed-`, emails end `@example.invalid` (RFC 2606, never deliverable). These teachers have no
// course, module or style card -- discovery shows them, but nothing can start a chat with one
// (`AgentConfig.courseId`/`styleCardId` are synthetic ids with no matching row).
//
// `buildDiscoverySeed` is pure and deterministic (same input, same rows); only
// `packages/db/src/bin/seed-discovery.ts` writes them, and only outside production.
import type { AgentConfig, Money, PackageConfig } from '@edmate/contracts';
import { AgentConfigSchema, PackageConfigSchema } from '@edmate/contracts';
import type * as s from './internal.js';

/** A fixed instant, so re-runs build identical rows (seed.ts precedent). */
const SEED_TIME = new Date('2026-01-01T00:00:00.000Z');
/** A fictional adult birth year (1.7): no real person's data. */
const SEED_BIRTH_YEAR = 1990;

// PROVISIONAL, like seed.ts's own copy: Anthropic for both tiers, no fallback. Copied rather than
// imported because @edmate/db does not depend on @edmate/gateway.
const MODEL_POLICY = {
  tiers: {
    small: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    main: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  },
} as const;

/** US pilot subjects, rotated across the seeded teachers (English only, standing rule). */
const PILOT_SUBJECTS = [
  'Algebra',
  'Biology',
  'Chemistry',
  'English Writing',
  'Finance',
  'Python Programming',
  'Public Speaking',
  'SAT Prep',
  'Spanish',
  'World History',
] as const;

const FREE: Money = { amountMinor: 0, currency: 'USD' };
const PAID: Money = { amountMinor: 1999, currency: 'USD' };

const pad = (n: number) => String(n).padStart(3, '0');

export type DiscoverySeedTable =
  | 'users'
  | 'teacherProfiles'
  | 'agents'
  | 'agentVersions'
  | 'packages'
  | 'packageVersions';

/** Rows for each seeded table, written in this (foreign key) order. */
export const DISCOVERY_SEED_TABLES: readonly DiscoverySeedTable[] = [
  'users',
  'teacherProfiles',
  'agents',
  'agentVersions',
  'packages',
  'packageVersions',
];

export type DiscoverySeed = { [T in DiscoverySeedTable]: (typeof s)[T]['$inferInsert'][] };

/** One seeded teacher's ids, for tests that want to address a specific row. */
export interface DiscoveryTeacherIds {
  userId: string;
  slug: string;
  agentId: string;
  freePackageId: string;
  paidPackageId?: string;
}

/**
 * `n` synthetic, verified teachers (`buildDiscoverySeed(200).users.length === 200`), deterministic
 * by index: teacher `i` (1-based) always gets the same ids, subject and bio. Every odd teacher
 * sells one free package; every even teacher sells a free and a paid package (so `packageCount`
 * and `hasFree` vary). Throws if a built config fails its contract (never writes a partial row).
 */
export function buildDiscoverySeed(n: number): DiscoverySeed {
  const users: DiscoverySeed['users'] = [];
  const teacherProfiles: DiscoverySeed['teacherProfiles'] = [];
  const agents: DiscoverySeed['agents'] = [];
  const agentVersions: DiscoverySeed['agentVersions'] = [];
  const packages: DiscoverySeed['packages'] = [];
  const packageVersions: DiscoverySeed['packageVersions'] = [];

  for (let i = 1; i <= n; i += 1) {
    const num = pad(i);
    const userId = `seed-teacher-${num}`;
    const subject = PILOT_SUBJECTS[(i - 1) % PILOT_SUBJECTS.length]!;
    const agentId = `seed-agent-${num}`;

    users.push({
      id: userId,
      email: `seed-teacher-${num}@example.invalid`,
      name: `Seed Teacher ${num}`,
      locale: 'en',
      market: 'US',
      role: 'teacher',
      ageConfirmedAt: SEED_TIME,
      birthYear: SEED_BIRTH_YEAR,
    });
    teacherProfiles.push({
      id: `seed-teacher-profile-${num}`,
      userId,
      slug: `seed-teacher-${num}`,
      subject,
      bio:
        `Seed Teacher ${num} teaches ${subject} to beginners and advanced students preparing ` +
        `for exams and jobs. Weekly live classes, practice sets and worked examples.`,
      languages: ['en'],
      verificationStatus: 'verified',
    });

    const agentConfig: AgentConfig = AgentConfigSchema.parse({
      id: agentId,
      version: 1,
      teacherId: userId,
      courseId: `seed-course-${num}`,
      styleCardId: `seed-style-${num}`,
      promptPackVersion: '1.0.0',
      languages: ['en'],
      modelPolicy: MODEL_POLICY,
    });
    agents.push({ id: agentId, teacherId: userId, status: 'live', liveVersion: 1 });
    agentVersions.push({
      id: `seed-agent-version-${num}`,
      teacherId: userId,
      agentId,
      version: 1,
      config: agentConfig,
    });

    const freeId = `seed-package-free-${num}`;
    const freeConfig: PackageConfig = PackageConfigSchema.parse({
      id: freeId,
      version: 1,
      teacherId: userId,
      agentId,
      name: `${subject} - Free`,
      moduleIds: [],
      skills: ['explain', 'coach'],
      helpCeiling: 2,
      finalAnswers: 'never',
      dailyMessageLimit: 20,
      liveClassesPerMonth: 0,
      pricePerMonth: FREE,
      lockedReply: 'name_package',
    });
    packages.push({ id: freeId, teacherId: userId, agentId, name: freeConfig.name, liveVersion: 1 });
    packageVersions.push({
      id: `seed-package-version-free-${num}`,
      teacherId: userId,
      packageId: freeId,
      version: 1,
      config: freeConfig,
    });

    if (i % 2 === 0) {
      const paidId = `seed-package-paid-${num}`;
      const paidConfig: PackageConfig = PackageConfigSchema.parse({
        id: paidId,
        version: 1,
        teacherId: userId,
        agentId,
        name: `${subject} - Full access`,
        moduleIds: [],
        skills: ['explain', 'coach', 'practice', 'feedback'],
        helpCeiling: 4,
        finalAnswers: 'after_attempt',
        dailyMessageLimit: 100,
        liveClassesPerMonth: 2,
        pricePerMonth: PAID,
        trialDays: 7,
        lockedReply: 'generic',
      });
      packages.push({
        id: paidId,
        teacherId: userId,
        agentId,
        name: paidConfig.name,
        liveVersion: 1,
      });
      packageVersions.push({
        id: `seed-package-version-paid-${num}`,
        teacherId: userId,
        packageId: paidId,
        version: 1,
        config: paidConfig,
      });
    }
  }

  return { users, teacherProfiles, agents, agentVersions, packages, packageVersions };
}
