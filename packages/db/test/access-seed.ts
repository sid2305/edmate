// Extra rows for the EntitlementStore and TurnConfigStore integration tests (task 3.2), on top of
// the isolation seed (teachers A and B, students 1 and 2). Synthetic ids only.
//
// - agt_a is live at v2; ses_1a stays pinned to v1 (ADR-0004 required test b).
// - pkg_a has v1 (mod_a1) and v2 (mod_a1, mod_a2); pv_a (v1) is what the seed's subscriptions use.
// - agt_a_draft (draft) with pkg_a_draft; agt_b_susp (suspended).
// - Sessions: ses_1a_ended (ended), ses_1a_draft (another agent), ses_preview_a (teacher A
//   previewing agt_a, pinned v2), ses_eval_a (eval student, v2). Each session's package pin
//   (task 3.16) is what its entitlement resolves to here: pkg_a v2 for preview and eval.
// - Subscriptions: 1A active, 2A paused, 1B ended, 2B active.
import { demoLocalePack, localePackMinimal } from '@edmate/contracts/fixtures';
import { eq } from 'drizzle-orm';
import type { LocalePack } from '@edmate/contracts';
import type { Db } from '../src/internal.js';
import * as s from '../src/internal.js';
import { agentConfig, ids, packageConfig, seed, teacherId } from './isolation-seed.js';

export const EVAL_STUDENT = 'stu_eval';
export const LOCALES: LocalePack[] = [demoLocalePack, localePackMinimal];
export const locales = (m: string): LocalePack | null =>
  LOCALES.find((l) => l.market === m) ?? null;
export const packMarket = (m: string): string => (locales(m) === null ? 'global' : m);

/** Every learner is past the age gate (1.7): the entitlement store's `learnerClear`. */
export const learnerClear = async (): Promise<boolean> => true;

export async function seedAccess(db: Db): Promise<void> {
  await seed(db);
  const A = teacherId('A');
  const B = teacherId('B');
  await db.insert(s.users).values({
    id: EVAL_STUDENT,
    name: '[eval] student',
    locale: 'en',
    market: 'test',
    role: 'student',
  });

  // agt_a v2 is live; the seed's sessions stay pinned to v1.
  await db.insert(s.agentVersions).values({
    id: 'av_a_2',
    teacherId: A,
    agentId: ids.agent('A'),
    version: 2,
    config: { ...agentConfig('A'), version: 2 },
  });
  await db
    .update(s.agents)
    .set({ liveVersion: 2 })
    .where(eq(s.agents.id, ids.agent('A')));
  await db.insert(s.packageVersions).values({
    id: 'pv_a_2',
    teacherId: A,
    packageId: ids.pkg('A'),
    version: 2,
    config: packageConfig('A', 2, [ids.module('A', 1), ids.module('A', 2)]),
  });

  await db.insert(s.agents).values([
    { id: 'agt_a_draft', teacherId: A, status: 'draft' },
    { id: 'agt_b_susp', teacherId: B, status: 'suspended', liveVersion: 1 },
  ]);
  await db.insert(s.agentVersions).values([
    {
      id: 'av_a_draft',
      teacherId: A,
      agentId: 'agt_a_draft',
      version: 1,
      config: { ...agentConfig('A'), id: 'agt_a_draft' },
    },
    {
      id: 'av_b_susp',
      teacherId: B,
      agentId: 'agt_b_susp',
      version: 1,
      config: { ...agentConfig('B'), id: 'agt_b_susp' },
    },
  ]);
  await db.insert(s.packages).values([
    { id: 'pkg_a_draft', teacherId: A, agentId: 'agt_a_draft', name: '[A] draft', liveVersion: 1 },
    { id: 'pkg_b_susp', teacherId: B, agentId: 'agt_b_susp', name: '[B] susp', liveVersion: 1 },
  ]);
  await db.insert(s.packageVersions).values([
    {
      id: 'pv_a_draft',
      teacherId: A,
      packageId: 'pkg_a_draft',
      version: 1,
      config: {
        ...packageConfig('A', 1, [ids.module('A', 2)]),
        id: 'pkg_a_draft',
        agentId: 'agt_a_draft',
      },
    },
    {
      id: 'pv_b_susp',
      teacherId: B,
      packageId: 'pkg_b_susp',
      version: 1,
      config: { ...packageConfig('B'), id: 'pkg_b_susp', agentId: 'agt_b_susp' },
    },
  ]);

  await db.insert(s.sessions).values([
    {
      id: 'ses_1a_ended',
      studentId: 'stu_1',
      teacherId: A,
      agentId: ids.agent('A'),
      agentVersion: 1,
      packageId: ids.pkg('A'),
      packageVersion: 1,
      endedAt: new Date('2026-10-17T09:00:00Z'),
    },
    {
      id: 'ses_1a_draft',
      studentId: 'stu_1',
      teacherId: A,
      agentId: 'agt_a_draft',
      agentVersion: 1,
      packageId: 'pkg_a_draft',
      packageVersion: 1,
    },
    {
      id: 'ses_preview_a',
      studentId: A,
      teacherId: A,
      agentId: ids.agent('A'),
      agentVersion: 2,
      packageId: ids.pkg('A'),
      packageVersion: 2,
    },
    {
      id: 'ses_preview_a_draft',
      studentId: A,
      teacherId: A,
      agentId: 'agt_a_draft',
      agentVersion: 1,
      packageId: 'pkg_a_draft',
      packageVersion: 1,
    },
    {
      id: 'ses_eval_a',
      studentId: EVAL_STUDENT,
      teacherId: A,
      agentId: ids.agent('A'),
      agentVersion: 2,
      packageId: ids.pkg('A'),
      packageVersion: 2,
    },
  ]);

  await db
    .update(s.subscriptions)
    .set({ status: 'paused' })
    .where(eq(s.subscriptions.id, ids.subscription('2A')));
  await db
    .update(s.subscriptions)
    .set({ status: 'ended' })
    .where(eq(s.subscriptions.id, ids.subscription('1B')));
}
