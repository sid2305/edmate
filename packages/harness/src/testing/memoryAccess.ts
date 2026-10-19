// In-memory EntitlementStore and TurnConfigStore (task 3.2), with the same semantics as the db
// adapters in packages/db (`entitlementStoreFor`, `turnConfigStoreFor`). Synthetic data only.
import {
  type AgentConfig,
  type Entitlement,
  EntitlementSchema,
  type EntitlementStore,
  type LocalePack,
  type PackageConfig,
  type StyleCard,
  type TurnConfigStore,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoLocalePack,
  demoPackageFree,
  demoStyleCard,
  localePackMinimal,
} from '@edmate/contracts/fixtures';

export interface MemoryAgent {
  id: string;
  teacherId: string;
  status: 'draft' | 'live' | 'suspended';
  /** Every immutable version. */
  versions: AgentConfig[];
}

export interface MemorySubscription {
  id: string;
  studentId: string;
  teacherId: string;
  packageId: string;
  packageVersion: number;
  status: Entitlement['status'];
  periodEnd: string;
}

export interface MemorySession {
  id: string;
  studentId: string;
  teacherId: string;
  agentId: string;
  /** Set server-side when the session was created. */
  agentVersion: number;
  /**
   * The package version the entitlement resolved to when the session was created (task 3.16);
   * null only on a session that ended before the pin existed.
   */
  packageId: string | null;
  packageVersion: number | null;
  endedAt: string | null;
  /** sessions.help_state as stored (ADR-0005); unset reads as `undefined`. Never validated here. */
  helpState?: unknown;
}

export interface AccessWorld {
  agents: MemoryAgent[];
  /** Every immutable package version. */
  packages: PackageConfig[];
  /** Immutable rows; `agent.styleCardId` names exactly one. */
  styleCards: StyleCard[];
  modules: { id: string; teacherId: string }[];
  subscriptions: MemorySubscription[];
  sessions: MemorySession[];
  locales: LocalePack[];
}

/**
 * Trusted server state bound when the store is built (lead answer Q2), never from TurnInput:
 * the student's market, the studio's preview package, the eval run's pinned package.
 */
export interface AccessOptions {
  market: string;
  preview?: { packageId: string };
  eval?: { teacherId: string; packageId: string; version: number; market: string };
}

export interface MemoryEntitlementStore extends EntitlementStore {
  /** Every `resolve` argument, as received. */
  readonly calls: { x: unknown; at: string }[];
}

export interface MemoryTurnConfigStore extends TurnConfigStore {
  readonly calls: { e: Entitlement; sessionId: string }[];
}

/** The locale pack's market for `market`; an unknown market falls back to `global` (as 3.10). */
export function packMarket(world: AccessWorld, market: string): string {
  return world.locales.some((l) => l.market === market) ? market : 'global';
}

function buildEntitlement(
  world: AccessWorld,
  x: {
    source: Entitlement['source'];
    studentId: string;
    agent: MemoryAgent;
    pkg: PackageConfig;
    market: string;
    status: Entitlement['status'];
    periodEnd: string;
    subscriptionId?: string;
  },
): Entitlement {
  const allowed = new Set(x.pkg.moduleIds);
  // Like the db adapter, a row that cannot make a valid entitlement throws (an integrity error).
  return EntitlementSchema.parse({
    source: x.source,
    ...(x.subscriptionId === undefined ? {} : { subscriptionId: x.subscriptionId }),
    studentId: x.studentId,
    teacherId: x.agent.teacherId,
    agentId: x.agent.id,
    market: packMarket(world, x.market),
    packageId: x.pkg.id,
    packageVersion: x.pkg.version,
    status: x.status,
    periodEnd: x.periodEnd,
    allowedModuleIds: [...x.pkg.moduleIds],
    lockedModuleIds: world.modules
      .filter((m) => m.teacherId === x.agent.teacherId && !allowed.has(m.id))
      .map((m) => m.id),
    skills: [...x.pkg.skills],
  });
}

const newest = (pkgs: PackageConfig[]): PackageConfig | undefined =>
  pkgs.reduce<PackageConfig | undefined>(
    (a, p) => (a && a.version >= p.version ? a : p),
    undefined,
  );

export function memoryEntitlementStore(
  world: AccessWorld,
  opts: AccessOptions,
): MemoryEntitlementStore {
  const calls: { x: unknown; at: string }[] = [];
  return {
    calls,
    resolve(x, at) {
      calls.push({ x, at });
      // Async, so a bad row rejects like the db adapter instead of throwing synchronously.
      return Promise.resolve().then(() => resolveNow(x, at));
    },
  };

  function resolveNow(
    x: Parameters<EntitlementStore['resolve']>[0],
    at: string,
  ): Entitlement | null {
    const { studentId, agentId, source } = x;
    const pkgOf = (teacherId: string, packageId: string, version?: number) => {
      const versions = world.packages.filter(
        (p) => p.id === packageId && p.teacherId === teacherId && p.agentId === agentId,
      );
      return version === undefined ? newest(versions) : versions.find((p) => p.version === version);
    };
    let out: Entitlement | null = null;
    if (source === 'subscription') {
      const agent = world.agents.find((a) => a.id === agentId && a.status === 'live');
      const sub =
        agent &&
        world.subscriptions.find(
          (s) =>
            s.studentId === studentId && s.teacherId === agent.teacherId && s.status !== 'ended',
        );
      const pkg = agent && sub && pkgOf(agent.teacherId, sub.packageId, sub.packageVersion);
      if (agent && sub && pkg) {
        out = buildEntitlement(world, {
          source,
          studentId,
          agent,
          pkg,
          market: opts.market,
          status: sub.status,
          periodEnd: sub.periodEnd,
          subscriptionId: sub.id,
        });
      }
    } else if (source === 'teacher_preview') {
      // Only the agent's own teacher previews it; drafts allowed; newest package version.
      const agent = world.agents.find((a) => a.id === agentId && a.teacherId === studentId);
      const pkg = agent && opts.preview && pkgOf(agent.teacherId, opts.preview.packageId);
      if (agent && pkg) {
        out = buildEntitlement(world, {
          source,
          studentId,
          agent,
          pkg,
          market: opts.market,
          status: 'active',
          periodEnd: at,
        });
      }
    } else if (opts.eval) {
      const ev = opts.eval;
      const agent = world.agents.find((a) => a.id === agentId && a.teacherId === ev.teacherId);
      const pkg = agent && pkgOf(agent.teacherId, ev.packageId, ev.version);
      if (agent && pkg) {
        out = buildEntitlement(world, {
          source,
          studentId,
          agent,
          pkg,
          market: ev.market,
          status: 'active',
          periodEnd: at,
        });
      }
    }
    return out;
  }
}

export function memoryTurnConfigStore(world: AccessWorld): MemoryTurnConfigStore {
  const calls: { e: Entitlement; sessionId: string }[] = [];
  return {
    calls,
    load(e, sessionId) {
      calls.push({ e, sessionId });
      // ADR-0004 Decision 3: the session must be open and the entitlement's student, teacher, agent.
      const session = world.sessions.find(
        (s) =>
          s.id === sessionId &&
          s.studentId === e.studentId &&
          s.teacherId === e.teacherId &&
          s.agentId === e.agentId &&
          s.endedAt === null,
      );
      // Task 3.16: sessions follow the package. Pinned to another package or version: end it and
      // load nothing. (The db adapter also clears the pair's last summary; there is no profile
      // here.)
      if (
        session &&
        (session.packageId !== e.packageId || session.packageVersion !== e.packageVersion)
      ) {
        session.endedAt = new Date().toISOString();
        return Promise.resolve(null);
      }
      // Decision 4: the agent at exactly the session's server-set version.
      const agent = session
        ? world.agents
            .find((a) => a.id === e.agentId && a.teacherId === e.teacherId)
            ?.versions.find((v) => v.version === session.agentVersion)
        : undefined;
      const pkg = world.packages.find(
        (p) =>
          p.id === e.packageId && p.version === e.packageVersion && p.teacherId === e.teacherId,
      );
      const styleCard = agent
        ? world.styleCards.find((c) => c.id === agent.styleCardId && c.teacherId === e.teacherId)
        : undefined;
      const locale = world.locales.find((l) => l.market === e.market);
      return Promise.resolve(
        session && agent && pkg && styleCard && locale
          ? { agent, pkg, styleCard, locale, helpState: session.helpState }
          : null,
      );
    },
  };
}

// ---- a two-teacher world --------------------------------------------------------------------

export const T = { A: 'tch_a', B: 'tch_b' } as const;
export const S = { one: 'stu_1', two: 'stu_2', evalStudent: 'stu_eval' } as const;

function agentVersion(id: string, teacherId: string, version: number, styleCardId: string) {
  return {
    ...demoAgentConfig,
    id,
    version,
    teacherId,
    courseId: `crs_${teacherId}`,
    styleCardId,
  } satisfies AgentConfig;
}

function pkg(
  id: string,
  version: number,
  teacherId: string,
  agentId: string,
  moduleIds: string[],
  skills: PackageConfig['skills'] = ['explain', 'coach'],
): PackageConfig {
  return {
    ...demoPackageFree,
    id,
    version,
    teacherId,
    agentId,
    name: `${id} v${version}`,
    moduleIds,
    skills,
  };
}

/**
 * Teachers A and B, students 1 and 2. Agent `agt_a` is live at v2 and session `ses_1a` is pinned
 * to v1; `agt_a_draft` is a draft; `agt_b_susp` is suspended. Subscriptions: 1A active, 2A paused,
 * 1B ended, 2B trial. Every package has the seed's daily limit of 20.
 */
export function twoTeacherWorld(): AccessWorld {
  return {
    agents: [
      {
        id: 'agt_a',
        teacherId: T.A,
        status: 'live',
        versions: [agentVersion('agt_a', T.A, 1, 'sty_a'), agentVersion('agt_a', T.A, 2, 'sty_a')],
      },
      {
        id: 'agt_a_draft',
        teacherId: T.A,
        status: 'draft',
        versions: [agentVersion('agt_a_draft', T.A, 1, 'sty_a')],
      },
      {
        id: 'agt_b',
        teacherId: T.B,
        status: 'live',
        versions: [agentVersion('agt_b', T.B, 1, 'sty_b')],
      },
      {
        id: 'agt_b_susp',
        teacherId: T.B,
        status: 'suspended',
        versions: [agentVersion('agt_b_susp', T.B, 1, 'sty_b')],
      },
    ],
    packages: [
      pkg('pkg_a', 1, T.A, 'agt_a', ['mod_a1']),
      pkg('pkg_a', 2, T.A, 'agt_a', ['mod_a1', 'mod_a2'], ['explain', 'coach', 'practice']),
      pkg('pkg_a_draft', 1, T.A, 'agt_a_draft', ['mod_a3']),
      pkg('pkg_b', 1, T.B, 'agt_b', ['mod_b1']),
      pkg('pkg_b_susp', 1, T.B, 'agt_b_susp', ['mod_b2']),
    ],
    styleCards: [
      { ...demoStyleCard, id: 'sty_a', teacherId: T.A },
      { ...demoStyleCard, id: 'sty_b', teacherId: T.B },
    ],
    modules: [
      { id: 'mod_a1', teacherId: T.A },
      { id: 'mod_a2', teacherId: T.A },
      { id: 'mod_a3', teacherId: T.A },
      { id: 'mod_b1', teacherId: T.B },
      { id: 'mod_b2', teacherId: T.B },
    ],
    subscriptions: [
      sub('sub_1a', S.one, T.A, 'pkg_a', 2, 'active'),
      sub('sub_2a', S.two, T.A, 'pkg_a', 1, 'paused'),
      sub('sub_1b', S.one, T.B, 'pkg_b', 1, 'ended'),
      sub('sub_2b', S.two, T.B, 'pkg_b', 1, 'trial'),
    ],
    // Each pinned (task 3.16) to what its entitlement resolves to in the tests.
    sessions: [
      session('ses_1a', S.one, T.A, 'agt_a', 1, 'pkg_a', 2),
      {
        ...session('ses_1a_ended', S.one, T.A, 'agt_a', 2, 'pkg_a', 2),
        endedAt: '2026-10-17T09:00:00.000Z',
      },
      session('ses_1a_draft', S.one, T.A, 'agt_a_draft', 1, 'pkg_a_draft', 1),
      session('ses_2a', S.two, T.A, 'agt_a', 2, 'pkg_a', 1),
      session('ses_1b', S.one, T.B, 'agt_b', 1, 'pkg_b', 1),
      session('ses_2b', S.two, T.B, 'agt_b', 1, 'pkg_b', 1),
      session('ses_preview_a', T.A, T.A, 'agt_a', 2, 'pkg_a', 2),
      session('ses_preview_a_draft', T.A, T.A, 'agt_a_draft', 1, 'pkg_a_draft', 1),
      session('ses_eval_a', S.evalStudent, T.A, 'agt_a', 2, 'pkg_a', 2),
    ],
    locales: [demoLocalePack, localePackMinimal],
  };
}

function sub(
  id: string,
  studentId: string,
  teacherId: string,
  packageId: string,
  packageVersion: number,
  status: Entitlement['status'],
): MemorySubscription {
  return {
    id,
    studentId,
    teacherId,
    packageId,
    packageVersion,
    status,
    periodEnd: '2026-12-01T00:00:00.000Z',
  };
}

function session(
  id: string,
  studentId: string,
  teacherId: string,
  agentId: string,
  agentVersion: number,
  packageId: string,
  packageVersion: number,
): MemorySession {
  return {
    id,
    studentId,
    teacherId,
    agentId,
    agentVersion,
    packageId,
    packageVersion,
    endedAt: null,
  };
}
