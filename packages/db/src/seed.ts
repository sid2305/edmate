// The demo seed (task 1.5): the demo teacher from content/demo-teacher/ (1.8), its live agent,
// its two packages and 20 fictional students with mixed subscriptions. Every row has a fixed id
// and is inserted with ON CONFLICT (id) DO NOTHING, all in one transaction, so a second run
// inserts nothing and changes no id. The seed never updates or deletes: a seeded row that has
// since changed is left as it is and reported as drift.
//
// Writes the raw schema directly (the documented use of @edmate/db/internal), not through the
// repositories: their scoped methods re-derive ids and reject an existing version, which would
// make every re-run fail.
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import {
  checkPilotLanguages,
  loadDemoTeacherContent,
  type DemoTeacherContent,
} from '@edmate/content';
import {
  AgentConfigSchema,
  PackageConfigSchema,
  StyleCardSchema,
  type ModelPolicy,
  type PackageConfig,
} from '@edmate/contracts';
import * as s from './internal.js';
import type { Db } from './internal.js';

/** The content the CLI seeds unless EDMATE_SEED_CONTENT_DIR says otherwise. */
export const DEMO_CONTENT_DIR = fileURLToPath(
  new URL('../../../content/demo-teacher/', import.meta.url),
);

/** Fixed ids the seed owns. Module and course ids come from course.yaml. */
export const DEMO_IDS = {
  teacher: 'demo-teacher',
  teacherProfile: 'demo-teacher-profile',
  styleCard: 'demo-style-card-v1',
  agent: 'demo-agent',
  agentVersion: 'demo-agent-v1',
  packageFree: 'demo-package-free',
  packagePaid: 'demo-package-paid',
  packageVersionFree: 'demo-package-free-v1',
  packageVersionPaid: 'demo-package-paid-v1',
} as const;

export const DEMO_STUDENT_COUNT = 20;

/** Tables the seed writes, in insert (foreign key) order. */
export const SEED_TABLES = [
  'users',
  'teacherProfiles',
  'courses',
  'modules',
  'styleCards',
  'agents',
  'agentVersions',
  'packages',
  'packageVersions',
  'subscriptions',
] as const;
export type SeedTable = (typeof SEED_TABLES)[number];

/** Rows for each seeded table. */
export type DemoSeed = { [T in SeedTable]: (typeof s)[T]['$inferInsert'][] };

export interface SeedResult {
  /** Rows this run actually inserted, per table (all 0 on a re-run). */
  inserted: Record<SeedTable, number>;
  /** `<table> <id>` for each seeded row whose stored content differs from what the seed builds. */
  drift: string[];
}

export interface SeedOptions {
  /** Content tree to seed from; defaults to DEMO_CONTENT_DIR. */
  contentDir?: string;
}

/** A fixed instant, so re-runs build identical rows. */
const SEED_TIME = new Date('2026-01-01T00:00:00.000Z');
/** A fictional adult birth year for every demo user (1.7): no real person's data. */
const DEMO_BIRTH_YEAR = 1990;
/** Period end for live subscriptions: far enough out that the demo never lapses. */
const LIVE_PERIOD_END = new Date('2099-12-31T00:00:00.000Z');

// PROVISIONAL, like the gateway's DEFAULT_MODEL_POLICY (2.3) it copies: Anthropic for both
// tiers, no fallback. 7.6 settles the default model mix. Copied rather than imported because
// @edmate/db does not depend on @edmate/gateway.
const MODEL_POLICY: ModelPolicy = {
  tiers: {
    small: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    main: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  },
};
// PROVISIONAL: the first prompt-pack set; 3.11 publishes it.
const PROMPT_PACK_VERSION = '1.0.0';

type SubscriptionKind = { package: 'free' | 'paid'; status: 'active' | 'paused' | 'ended' };

/**
 * Students 01–05 free and active, 06–10 paid and active, 11–15 paid and paused, 16–20 ended
 * (16–18 on the paid package, 19–20 on the free one).
 */
function subscriptionKind(n: number): SubscriptionKind {
  if (n <= 5) return { package: 'free', status: 'active' };
  if (n <= 10) return { package: 'paid', status: 'active' };
  if (n <= 15) return { package: 'paid', status: 'paused' };
  return { package: n <= 18 ? 'paid' : 'free', status: 'ended' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Every row the seed writes, built from a loaded content tree. Pure and deterministic. */
export function buildDemoSeed(content: DemoTeacherContent): DemoSeed {
  const teacherId = DEMO_IDS.teacher;
  const { course } = content;
  const moduleIds = new Set(course.modules.map((m) => m.id));

  const styleCard = StyleCardSchema.parse({
    id: DEMO_IDS.styleCard,
    teacherId,
    version: 1,
    ...content.styleCard,
  });
  const agentConfig = AgentConfigSchema.parse({
    id: DEMO_IDS.agent,
    version: 1,
    teacherId,
    courseId: course.id,
    styleCardId: styleCard.id,
    promptPackVersion: PROMPT_PACK_VERSION,
    languages: ['en'],
    modelPolicy: MODEL_POLICY,
  });
  // Pilot policy (3.11c, 18 Oct 2026 decision): reject before writing, not just by convention.
  const pilotIssues = checkPilotLanguages(agentConfig.languages);
  if (pilotIssues.length > 0) {
    throw new Error(`seed agent config: ${pilotIssues.join('; ')}`);
  }
  const pkgConfig = (id: string, draft: DemoTeacherContent['packages']['free']): PackageConfig => {
    const unknown = draft.moduleIds.filter((m) => !moduleIds.has(m));
    if (unknown.length > 0) {
      throw new Error(
        `package ${id} unlocks modules the course does not have: ${unknown.join(', ')}`,
      );
    }
    return PackageConfigSchema.parse({
      ...draft,
      id,
      version: 1,
      teacherId,
      agentId: agentConfig.id,
    });
  };
  const free = pkgConfig(DEMO_IDS.packageFree, content.packages.free);
  const paid = pkgConfig(DEMO_IDS.packagePaid, content.packages.paid);

  const students = Array.from({ length: DEMO_STUDENT_COUNT }, (_, i) => {
    const n = pad(i + 1);
    return {
      id: `demo-student-${n}`,
      // RFC 2606 reserved domain: never deliverable. Fictional, and a fictional adult birth year
      // so the demo learners are past the age gate (1.7).
      email: `demo-student-${n}@example.invalid`,
      name: `Demo Student ${n}`,
      locale: 'en',
      market: 'global',
      role: 'student' as const,
      ageConfirmedAt: SEED_TIME,
      birthYear: DEMO_BIRTH_YEAR,
    };
  });

  return {
    users: [
      {
        id: teacherId,
        email: 'demo-teacher@example.invalid',
        name: 'Demo Teacher',
        locale: 'en',
        market: 'global',
        role: 'teacher',
        ageConfirmedAt: SEED_TIME,
        birthYear: DEMO_BIRTH_YEAR,
      },
      ...students,
    ],
    teacherProfiles: [
      {
        id: DEMO_IDS.teacherProfile,
        userId: teacherId,
        slug: 'demo-teacher',
        subject: course.title,
        bio: course.description,
        languages: ['en'],
      },
    ],
    courses: [{ id: course.id, teacherId, title: course.title, order: 0 }],
    modules: course.modules.map((m, order) => ({
      id: m.id,
      teacherId,
      courseId: course.id,
      title: m.title,
      order,
    })),
    styleCards: [
      {
        id: styleCard.id,
        teacherId,
        version: styleCard.version,
        text: styleCard.text,
        mistakeTags: styleCard.mistakeTags,
      },
    ],
    // Inserted live at version 1 in the same transaction as that version, so no reader ever sees
    // a live agent or package without its version.
    agents: [{ id: agentConfig.id, teacherId, status: 'live', liveVersion: 1 }],
    agentVersions: [
      {
        id: DEMO_IDS.agentVersion,
        teacherId,
        agentId: agentConfig.id,
        version: 1,
        config: agentConfig,
      },
    ],
    packages: [
      { id: free.id, teacherId, agentId: agentConfig.id, name: free.name, liveVersion: 1 },
      { id: paid.id, teacherId, agentId: agentConfig.id, name: paid.name, liveVersion: 1 },
    ],
    packageVersions: [
      { id: DEMO_IDS.packageVersionFree, teacherId, packageId: free.id, version: 1, config: free },
      { id: DEMO_IDS.packageVersionPaid, teacherId, packageId: paid.id, version: 1, config: paid },
    ],
    subscriptions: students.map((st, i) => {
      const kind = subscriptionKind(i + 1);
      return {
        id: `demo-subscription-${pad(i + 1)}`,
        studentId: st.id,
        teacherId,
        packageVersionId:
          kind.package === 'free' ? DEMO_IDS.packageVersionFree : DEMO_IDS.packageVersionPaid,
        status: kind.status,
        periodEnd: kind.status === 'ended' ? SEED_TIME : LIVE_PERIOD_END,
      };
    }),
  };
}

/** Seeded rows whose stored versioned content (style card, agent and package configs) changed. */
async function findDrift(tx: Db, seed: DemoSeed): Promise<string[]> {
  const drift: string[] = [];
  const cards = await tx
    .select()
    .from(s.styleCards)
    .where(
      inArray(
        s.styleCards.id,
        seed.styleCards.map((r) => r.id!),
      ),
    );
  for (const want of seed.styleCards) {
    const got = cards.find((r) => r.id === want.id);
    if (!got || got.text !== want.text || !isDeepStrictEqual(got.mistakeTags, want.mistakeTags)) {
      drift.push(`styleCards ${want.id}`);
    }
  }
  for (const table of ['agentVersions', 'packageVersions'] as const) {
    const t = s[table];
    const want = seed[table];
    const rows = await tx
      .select({ id: t.id, config: t.config })
      .from(t)
      .where(
        inArray(
          t.id,
          want.map((r) => r.id!),
        ),
      );
    for (const w of want) {
      const got = rows.find((r) => r.id === w.id);
      if (!got || !isDeepStrictEqual(got.config, w.config)) drift.push(`${table} ${w.id}`);
    }
  }
  return drift;
}

/**
 * Seeds the demo teacher. Idempotent: rows that already exist (by id) are skipped, never
 * updated. Throws, writing nothing, when the content fails to load or a row conflicts on
 * anything other than its id (for example an email another user already has).
 */
export async function seedDemoTeacher(db: Db, options: SeedOptions = {}): Promise<SeedResult> {
  const seed = buildDemoSeed(loadDemoTeacherContent(options.contentDir ?? DEMO_CONTENT_DIR));
  return db.transaction(async (tx) => {
    const inserted = {} as Record<SeedTable, number>;
    for (const table of SEED_TABLES) {
      const t = s[table];
      // Each table's rows type-check against that table in DemoSeed; the loop loses the pairing.
      const rows = await tx
        .insert(t)
        .values(seed[table] as never)
        .onConflictDoNothing({ target: t.id })
        .returning({ id: t.id });
      inserted[table] = rows.length;
    }
    return { inserted, drift: await findDrift(tx as unknown as Db, seed) };
  });
}
