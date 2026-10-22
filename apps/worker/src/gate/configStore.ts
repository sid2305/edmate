// The gate's TurnConfigStore (task 8.7 Phase B). The production store (`turnConfigStoreFor`) reads
// a `sessions` row to find the agent version; the gate has no session rows (it writes nothing
// durable), so this store loads the candidate agent version the run's basis pins, directly, and
// only the package versions the basis pins. Reads only; another teacher's or agent's ids get null.
import type { LocalePack, TurnConfigStore } from '@edmate/contracts';
import type { Repositories } from '@edmate/db';
import type { GateBasis } from './input.js';

export interface GateTurnConfigOptions {
  repos: Pick<Repositories, 'agentVersions' | 'packageVersions' | 'styleCards'>;
  basis: GateBasis;
  locales(market: string): LocalePack | null;
  /** The in-memory help state saved for a gate session, or null for a fresh one. */
  helpState(sessionId: string): unknown;
}

export function gateTurnConfigStore(opts: GateTurnConfigOptions): TurnConfigStore {
  const { basis } = opts;
  return {
    async load(e, sessionId) {
      if (e.teacherId !== basis.teacherId || e.agentId !== basis.agentId) return null;
      const pinned = basis.packageVersions.find((p) => p.packageId === e.packageId);
      if (pinned === undefined || pinned.version !== e.packageVersion) return null;
      const scope = { teacherId: basis.teacherId };
      const agent = await opts.repos.agentVersions.get(scope, {
        agentId: basis.agentId,
        version: basis.agentVersion,
      });
      if (agent === null) return null;
      const [pkg, styleCard] = await Promise.all([
        opts.repos.packageVersions.get(scope, { packageId: pinned.packageId, version: pinned.version }),
        opts.repos.styleCards.get(scope, agent.styleCardId),
      ]);
      const locale = opts.locales(e.market);
      if (pkg === null || styleCard === null || locale === null) return null;
      return { agent, pkg, styleCard, locale, helpState: opts.helpState(sessionId) ?? null };
    },
  };
}
