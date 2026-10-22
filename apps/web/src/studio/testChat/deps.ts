// The test chat's turn composition (task 8.5 Phase B): a sibling of `../../turn/deps.ts`'s
// `turnDepsFor`, reused as is (same queued ports, metered gateway, pricing, logging and fallback
// replies) with two differences: the entitlement store is built fresh per turn for one preview
// package, and `entitlementSource` is `teacher_preview` (the teacher is the student; drafts are
// allowed; no subscription and no age gate).
import type { EntitlementStore, LocalePack, RetrievalIndex, TurnConfigStore } from '@edmate/contracts';
import {
  entitlementStoreFor,
  retrievalIndexFor,
  turnConfigStoreFor,
  type Repositories,
  type StudentScope,
} from '@edmate/db';
import type { PipelineDeps } from '@edmate/harness';
import { turnDepsFor, type TurnProcess } from '../../turn/deps';

/** What `testChatDepsFor` needs, built once per process. */
export interface TestChatProcess extends Omit<TurnProcess, 'entitlements'> {
  /** The market preview turns run in (as the student turn's `EDMATE_MARKET`). */
  market: string;
  packMarket(market: string): string;
}

/** The ports that are the same for every preview turn. Retrieval is full text (no embedder yet). */
export function testChatPorts(
  repos: Repositories,
  opts: { locales(market: string): LocalePack | null },
): { turnConfig: TurnConfigStore; retrieval: RetrievalIndex } {
  return {
    turnConfig: turnConfigStoreFor(repos, { locales: opts.locales }),
    retrieval: retrievalIndexFor(repos, {}),
  };
}

/**
 * A `teacher_preview` entitlement store for one package. `learnerClear` is only asked for a
 * `subscription` resolve, which a preview never makes; it answers false so that, if one ever
 * were made here, it fails closed rather than skipping the age gate.
 */
export function previewEntitlementsFor(p: TestChatProcess, packageId: string): EntitlementStore {
  return entitlementStoreFor(p.repos, {
    market: p.market,
    packMarket: p.packMarket,
    learnerClear: async () => false,
    preview: { packageId },
  });
}

/** One preview turn's `PipelineDeps` for the teacher (as the student) and one package. */
export function testChatDepsFor(
  p: TestChatProcess,
  scope: StudentScope,
  packageId: string,
): PipelineDeps {
  const entitlements = previewEntitlementsFor(p, packageId);
  return {
    ...turnDepsFor({ ...p, entitlements }, scope),
    entitlementSource: 'teacher_preview',
  };
}
