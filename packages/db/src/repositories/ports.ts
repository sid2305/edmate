import {
  type Entitlement,
  EntitlementSchema,
  type EntitlementStore,
  type LocalePack,
  type PackageConfig,
  type TranscriptStore,
  type TurnConfigStore,
} from '@edmate/contracts';
import { RepositoryError } from './errors.js';
import type { Repositories } from './index.js';
import { studentScope, type StudentScope } from './scope.js';

/**
 * The frozen TranscriptStore port has no scope parameter, so the scope is a required constructor
 * argument: the caller (web route or worker) builds one store per turn from the signed-in student
 * and the agent's teacher. Another pair's session reads as empty and appending to it is
 * `not_found`.
 */
export function transcriptStoreFor(repos: Repositories, scope: StudentScope): TranscriptStore {
  const bound = studentScope(scope, 'transcriptStoreFor');
  return {
    history: (sessionId, limit) => repos.messages.history(bound, sessionId, limit),
    append: (sessionId, m) => repos.messages.append(bound, sessionId, m),
  };
}

/**
 * Trusted server state, bound when the composition root builds the store (task 3.2, plan Q2);
 * never taken from TurnInput.
 */
export interface EntitlementStoreOptions {
  /** The signed-in user's market. */
  market: string;
  /** The locale pack market for a user market: itself when a pack exists, else `global`. */
  packMarket(market: string): string;
  /** Studio preview: the package the teacher is previewing (its newest version is used). */
  preview?: { packageId: string };
  /** Eval runner: the teacher, package and version under test, and the market to run in. */
  eval?: { teacherId: string; packageId: string; version: number; market: string };
}

/**
 * EntitlementStore over the repositories (build plan § Access filter 1 and 7; ADR-0003 point 1).
 * - `subscription`: the live agent's teacher, the student's live (not ended) subscription with
 *   that teacher, and the package version it points at, which must be this agent's. Paused is
 *   returned as is; `entitle` refuses it.
 * - `teacher_preview`: only the agent's own teacher (the student id is the teacher's user id);
 *   drafts allowed; `opts.preview`'s package at its newest version. No subscription.
 * - `eval`: `opts.eval`'s package at its pinned version, of the agent's teacher. No subscription.
 * Allowed modules and skills are the package's; locked = the teacher's other modules.
 */
export function entitlementStoreFor(
  repos: Repositories,
  opts: EntitlementStoreOptions,
): EntitlementStore {
  const method = 'entitlementStore.resolve';

  async function build(x: {
    source: Entitlement['source'];
    studentId: string;
    teacherId: string;
    pkg: PackageConfig;
    market: string;
    status: Entitlement['status'];
    periodEnd: string;
    subscriptionId?: string;
  }): Promise<Entitlement> {
    const allowed = new Set(x.pkg.moduleIds);
    const all = await repos.modules.ids({ teacherId: x.teacherId });
    const parsed = EntitlementSchema.safeParse({
      source: x.source,
      ...(x.subscriptionId === undefined ? {} : { subscriptionId: x.subscriptionId }),
      studentId: x.studentId,
      teacherId: x.teacherId,
      agentId: x.pkg.agentId,
      market: opts.packMarket(x.market),
      packageId: x.pkg.id,
      packageVersion: x.pkg.version,
      status: x.status,
      periodEnd: x.periodEnd,
      allowedModuleIds: [...x.pkg.moduleIds],
      lockedModuleIds: all.filter((m) => !allowed.has(m)),
      skills: [...x.pkg.skills],
    });
    if (!parsed.success) throw new RepositoryError('integrity', method);
    return parsed.data;
  }

  return {
    async resolve({ studentId, agentId, source }, at) {
      if (source === 'subscription') {
        const owner = await repos.agents.owner({ agentId });
        if (owner === null) return null;
        const { teacherId } = owner;
        const sub = await repos.subscriptions.findLive({ studentId, teacherId });
        if (sub === null) return null;
        const pkg = await repos.packageVersions.getById({ teacherId }, sub.packageVersionId);
        if (pkg === null || pkg.agentId !== agentId) return null;
        return build({
          source,
          studentId,
          teacherId,
          pkg,
          market: opts.market,
          status: sub.status,
          periodEnd: sub.periodEnd,
          subscriptionId: sub.id,
        });
      }
      if (source === 'teacher_preview') {
        if (opts.preview === undefined) return null;
        // Scoped to the previewing user as a teacher: another teacher's agent reads as null.
        const agent = await repos.agents.get({ teacherId: studentId }, agentId);
        if (agent === null) return null;
        const pkg = await repos.packageVersions.latest(
          { teacherId: agent.teacherId },
          opts.preview.packageId,
        );
        if (pkg === null || pkg.agentId !== agentId) return null;
        return build({
          source,
          studentId,
          teacherId: agent.teacherId,
          pkg,
          market: opts.market,
          status: 'active',
          periodEnd: at,
        });
      }
      const ev = opts.eval;
      if (ev === undefined) return null;
      const agent = await repos.agents.get({ teacherId: ev.teacherId }, agentId);
      if (agent === null) return null;
      const pkg = await repos.packageVersions.get(
        { teacherId: agent.teacherId },
        { packageId: ev.packageId, version: ev.version },
      );
      if (pkg === null || pkg.agentId !== agentId) return null;
      return build({
        source,
        studentId,
        teacherId: agent.teacherId,
        pkg,
        market: ev.market,
        status: 'active',
        periodEnd: at,
      });
    },
  };
}

export interface TurnConfigStoreOptions {
  /** The locale pack for a market, or null. Until task 3.10 the composition root passes fixtures. */
  locales(market: string): LocalePack | null;
}

/**
 * TurnConfigStore over the repositories (ADR-0004). The session is read in the entitlement's
 * student x teacher scope and must be this agent's and open; the agent is loaded at exactly the
 * session row's server-set `agent_version`, the package at the entitlement's version, and the
 * style card row `agent.styleCardId` names (each version is its own immutable row).
 */
export function turnConfigStoreFor(
  repos: Repositories,
  opts: TurnConfigStoreOptions,
): TurnConfigStore {
  return {
    async load(e, sessionId) {
      const session = await repos.sessions.get(
        { studentId: e.studentId, teacherId: e.teacherId },
        sessionId,
      );
      if (session === null || session.agentId !== e.agentId || session.endedAt !== null) {
        return null;
      }
      const scope = { teacherId: e.teacherId };
      const agent = await repos.agentVersions.get(scope, {
        agentId: e.agentId,
        version: session.agentVersion,
      });
      if (agent === null) return null;
      const [pkg, styleCard] = await Promise.all([
        repos.packageVersions.get(scope, { packageId: e.packageId, version: e.packageVersion }),
        repos.styleCards.get(scope, agent.styleCardId),
      ]);
      const locale = opts.locales(e.market);
      if (pkg === null || styleCard === null || locale === null) return null;
      return { agent, pkg, styleCard, locale };
    },
  };
}
