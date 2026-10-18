// Step 2, entitle (build plan § Turn pipeline spec, § Access filter 1 and 7; ADR-0004). Fails
// closed: `no_access` or `limit_reached`. Everything is resolved server-side from the student,
// the agent and the composition root's source; package ids, module ids and skills a client sends
// are never read. The subscription is read fresh every turn.
import { EntitlementSchema } from '@edmate/contracts';
import { checkEntitlement, checkTurnConfig } from '../../access/entitlement.js';
import { isoAt } from '../clock.js';
import { TurnRejection } from '../errors.js';
import type { FallbackReplies, Steps } from '../types.js';

/**
 * The built-in `limit_reached` text (task 2.5), used when no localised one is injected. English
 * and country-neutral; it names no ids and no limit, since the limit is the teacher's choice.
 */
export const DEFAULT_LIMIT_REACHED_REPLY =
  "You've used all of today's messages for this package. Messages free up on a rolling " +
  '24 hours, so you can pick up where you left off a little later. See you soon!';

/** The injected localised text, else the built-in one: a failing locale never hides the reason. */
function limitReachedText(replies: FallbackReplies, lang: string): string {
  try {
    const text: unknown = replies.limitReached?.(lang);
    if (typeof text === 'string' && text.trim() !== '') return text;
  } catch {
    // Fall through to the built-in text.
  }
  return DEFAULT_LIMIT_REACHED_REPLY;
}

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
  const loaded = await deps.turnConfig.load(e, sessionId as string);
  const cfg = checkTurnConfig(e, loaded);
  if (!cfg.ok) throw noAccess();

  // Rolling 24-hour message limit, subscriptions only (lead answer Q3). The take is the last
  // action, after every await, so a refused turn never counts and two concurrent turns can't
  // both take the last slot.
  if (source === 'subscription') {
    const key = `${e.studentId}:${e.packageId}`;
    if (!(await deps.limits.messages.tryTake(key, cfg.value.pkg.dailyMessageLimit))) {
      throw new TurnRejection(
        'limit_reached',
        false,
        limitReachedText(deps.fallbackReplies, input.lang),
      );
    }
  }
  // The session's raw help state, from the same ownership-checked load (ADR-0005); buildContext
  // parses it. Never validated here: any shape is safe because a bad one restarts the ladder.
  return { entitlement: e, ...cfg.value, helpState: loaded?.helpState };
};
