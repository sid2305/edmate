// jailbreak (task 4.4): the third `pre`-phase guard. Build plan guard table: "patterns +
// classifier across turns; block; strikes per student".
//
// 1. The rule table (jailbreakPatterns.ts) on the message, its decoded payloads and its ROT13 and
//    backwards readings, with the turn's package name for "pretend I'm on <package>". A hit
//    decides with no model call.
// 2. Otherwise one small-tier classifier call on the scrubbed message and the last 3 scrubbed
//    student messages, as data: that is where a build-up across turns (grooming, a story wrapper)
//    is judged. `none` passes.
// 3. A block records a strike: a safety event from `jailbreak` (awaited; a throw fails the chain,
//    still refused). Strikes are only counted for now (open human question B-12): the guard blocks
//    the same way however many came before. The code picks preGuard's reply.
// 4. A classifier throw, timeout, cancel or bad answer propagates: the chain fails closed. A
//    failure never records a strike.
import type { Guard } from './guard.js';
import { type JailbreakCode, matchJailbreak } from './jailbreakPatterns.js';
import type { PreGuardCtx } from './preGuardCtx.js';
import {
  askClassifier,
  buildJailbreakClassifierRequest,
  JailbreakVerdictSchema,
  SafetyGuardCancelledError,
} from './safetyClassifier.js';

const NAME = 'jailbreak';

async function block(ctx: PreGuardCtx, code: JailbreakCode, source: 'rule' | 'classifier') {
  await ctx.safetyEvents.record({
    studentId: ctx.entitlement.studentId,
    teacherId: ctx.entitlement.teacherId,
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    guard: NAME,
    code,
    source,
  });
  ctx.blocks.set(NAME, { code });
  return { result: { ok: false as const, action: 'block' as const, reason: code }, usage: [] };
}

export function createJailbreakGuard(): Guard<PreGuardCtx> {
  return {
    name: NAME,
    phase: 'pre',
    async run(text, ctx, cancel) {
      const code = matchJailbreak(text, { packageNames: ctx.packageNames });
      if (code !== null) return block(ctx, code, 'rule');

      if (cancel.cancelled) throw new SafetyGuardCancelledError(NAME);
      const earlier = await ctx.recentStudentTurns;
      if (cancel.cancelled) throw new SafetyGuardCancelledError(NAME);
      const v = await askClassifier(
        NAME,
        ctx,
        cancel,
        buildJailbreakClassifierRequest(text, earlier),
        JailbreakVerdictSchema,
      );
      if (v.category === 'none') return { result: { ok: true }, usage: [] };
      return block(ctx, v.category, 'classifier');
    },
  };
}
