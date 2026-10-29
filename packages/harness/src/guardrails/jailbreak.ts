// jailbreak (task 4.4): the third `pre`-phase guard. Build plan guard table: "patterns +
// classifier across turns; block; strikes per student".
//
// 1. The rule table (jailbreakPatterns.ts) on the message, its decoded payloads and its ROT13 and
//    backwards readings, with all of the teacher's package names. A decisive hit decides with no
//    model call; an ambiguous one only flags the message (fix round HIGH 1).
// 2. Otherwise one small-tier classifier call on the scrubbed message and the last 3 scrubbed
//    student messages, as data: that is where a build-up across turns (grooming, a story wrapper)
//    is judged. `none` passes.
// 3. A block records a strike: a safety event from `jailbreak` (awaited; a throw fails the chain,
//    still refused). Strikes are only counted for now (open human question B-12): the guard blocks
//    the same way however many came before. The code picks preGuard's reply.
// 4. A classifier throw, timeout, cancel or bad answer propagates: the chain fails closed. A
//    failure never records a strike, so an ambiguous hit with the classifier down costs none.
import type { SafetyAlert } from '@edmate/contracts';
import { SafetyAlertSchema } from '@edmate/contracts';
import { isoAt } from '../pipeline/clock.js';
import type { Guard } from './guard.js';
import { type JailbreakCode, matchJailbreak } from './jailbreakPatterns.js';
import { STRIKE_THRESHOLD, type PreGuardCtx } from './preGuardCtx.js';
import {
  askClassifier,
  buildJailbreakClassifierRequest,
  classifierAbout,
  JailbreakVerdictSchema,
  SafetyGuardCancelledError,
} from './safetyClassifier.js';

const NAME = 'jailbreak';

/**
 * The trust-team notice on the turn that makes the third strike (task 4.4e, B-12): no student
 * text, no student name (its `excerptRedacted` is always `''`, stricter than the misuse/distress
 * alerts). Idempotent id, deterministic from the session alone (not `ctx.ids.next`), so a retried
 * turn, a worker replay or two near-simultaneous turns that both compute strike 3 all produce the
 * same alert id — the queue's existing dedupe-by-id means at most one notice reaches the trust
 * team.
 */
function strikeNotice(ctx: PreGuardCtx): SafetyAlert {
  return SafetyAlertSchema.parse({
    id: `alert_strike3_${ctx.sessionId}`.slice(0, 128),
    level: 'info',
    kind: 'other',
    studentId: ctx.entitlement.studentId,
    teacherId: ctx.entitlement.teacherId,
    sessionId: ctx.sessionId,
    excerptRedacted: '',
    createdAt: isoAt(ctx.clock.now()),
  });
}

async function block(
  ctx: PreGuardCtx,
  code: JailbreakCode,
  source: 'rule' | 'classifier',
  priorCount?: number,
) {
  await ctx.safetyEvents.record({
    studentId: ctx.entitlement.studentId,
    teacherId: ctx.entitlement.teacherId,
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    guard: NAME,
    code,
    source,
  });
  // Exactly one notice, on the turn that makes the third strike (task 4.4e): any earlier or
  // later strike count never attaches one.
  const alert = priorCount === STRIKE_THRESHOLD - 1 ? strikeNotice(ctx) : undefined;
  ctx.blocks.set(NAME, alert === undefined ? { code } : { code, alert });
  return { result: { ok: false as const, action: 'block' as const, reason: code }, usage: [] };
}

export function createJailbreakGuard(): Guard<PreGuardCtx> {
  return {
    name: NAME,
    phase: 'pre',
    async run(text, ctx, cancel) {
      const hit = matchJailbreak(text, {
        packageNames: await ctx.packageNames,
        currentPackageName: ctx.currentPackageName,
      });
      if (hit?.decisive === true)
        return block(ctx, hit.code, 'rule', await ctx.priorJailbreakStrikes);

      if (cancel.cancelled) throw new SafetyGuardCancelledError(NAME);
      const earlier = await ctx.recentStudentTurns;
      if (cancel.cancelled) throw new SafetyGuardCancelledError(NAME);
      const v = await askClassifier(
        NAME,
        ctx,
        cancel,
        buildJailbreakClassifierRequest(text, earlier, classifierAbout(ctx)),
        JailbreakVerdictSchema,
      );
      if (v.category !== 'none')
        return block(ctx, v.category, 'classifier', await ctx.priorJailbreakStrikes);
      // An ambiguous rule hit the classifier called `none`: in strict mode (3+ prior strikes)
      // this still blocks by the rule's own code (task 4.4e, B-12). The classifier's own
      // verdict always wins when it names a real category (handled above).
      if (hit !== null && (await ctx.priorJailbreakStrikes) >= STRIKE_THRESHOLD) {
        return block(ctx, hit.code, 'rule', await ctx.priorJailbreakStrikes);
      }
      return { result: { ok: true }, usage: [] };
    },
  };
}
