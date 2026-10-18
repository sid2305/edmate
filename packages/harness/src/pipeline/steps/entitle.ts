// Step 2, entitle (build plan § Turn pipeline spec, § Access filter 1 and 7; ADR-0004). Fails
// closed: `no_access` or `limit_reached`. Everything is resolved server-side from the student,
// the agent and the composition root's source; package ids, module ids and skills a client sends
// are never read. The subscription is read fresh every turn.
import { EntitlementSchema } from '@edmate/contracts';
import { checkEntitlement, checkTurnConfig } from '../../access/entitlement.js';
import { isoAt } from '../clock.js';
import { TurnRejection } from '../errors.js';
import type { Steps } from '../types.js';

const noAccess = () => new TurnRejection('no_access', false);
const IdSchema = EntitlementSchema.shape.agentId;

export const entitle: Steps['entitle'] = async ({ input, deps }) => {
  const source = deps.entitlementSource;
  // Only these three fields reach the store: nothing else from the input is trusted.
  const req = { studentId: input.studentId, agentId: input.agentId, source };
  if (!IdSchema.safeParse(req.studentId).success || !IdSchema.safeParse(req.agentId).success) {
    throw noAccess();
  }
  const sessionId: unknown = input.sessionId;
  if (!IdSchema.safeParse(sessionId).success) throw noAccess();

  const ent = checkEntitlement(
    await deps.entitlements.resolve({ ...req }, isoAt(deps.clock.now())),
    req,
  );
  if (!ent.ok) throw noAccess();
  const e = ent.value;

  // A session id is never trusted on its own: `load` checks its owner; we check every object.
  const cfg = checkTurnConfig(e, await deps.turnConfig.load(e, sessionId as string));
  if (!cfg.ok) throw noAccess();

  // Rolling 24-hour message limit, subscriptions only (lead answer Q3). The take is the last
  // action, after every await, so a refused turn never counts and two concurrent turns can't
  // both take the last slot.
  if (source === 'subscription') {
    const key = `${e.studentId}:${e.packageId}`;
    if (!(await deps.limits.messages.tryTake(key, cfg.value.pkg.dailyMessageLimit))) {
      throw new TurnRejection('limit_reached', false);
    }
  }
  return { entitlement: e, ...cfg.value };
};
