// What generate and postGuard build for the locked checks (task 4.6): the check, scoped to the
// turn's entitlement, and the reply that replaces one holding locked material.
import { LIMITS, type TurnContext } from '@edmate/contracts';
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { createLockedCheck, lockedReplyText } from '../../guardrails/lockedLeak.js';
import type { StepEnv } from '../types.js';

/**
 * The locked check for this turn: the teacher and allowed modules from the entitlement (built
 * server-side, never from the client), the student's own (scrubbed) words allowed back.
 */
export function lockedCheckFor(env: StepEnv, ctx: TurnContext): LockedCheck {
  const studentText = env.input.text;
  return createLockedCheck({
    retrieval: env.deps.retrieval,
    teacherId: ctx.entitlement.teacherId,
    allowedModuleIds: ctx.entitlement.allowedModuleIds,
    clock: env.deps.clock,
    ...(studentText === undefined ? {} : { studentText }),
  });
}

/**
 * The locked reply: the locale's (`FallbackReplies.lockedReply`), else the built-in English one.
 * It names the student's own package only when the teacher chose `name_package` (decision Q6).
 * A failing or unusable locale text never hides the reply.
 */
export function lockedReplyFor(env: StepEnv, ctx: TurnContext): string {
  const name = ctx.pkg.lockedReply === 'name_package' ? ctx.pkg.name : undefined;
  try {
    const text: unknown = env.deps.fallbackReplies.lockedReply?.(env.input.lang, name);
    if (
      typeof text === 'string' &&
      text.trim() !== '' &&
      text.length <= LIMITS.modelTextMaxLength
    ) {
      return text;
    }
  } catch (error) {
    env.report(error);
  }
  return lockedReplyText(name);
}
