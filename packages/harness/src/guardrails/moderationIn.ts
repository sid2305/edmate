// moderationIn (task 4.4): the second `pre`-phase guard. Build plan guard table: "provider or local
// classifier; block with redirect; log safety_event" (decisions.moderation: provider moderation
// where available, a local classifier otherwise).
//
// 1. The rule table (moderationPatterns.ts) on the message, its decoded payloads and its ROT13 and
//    backwards readings. A hit decides with no model call.
// 2. No moderation hit but a jailbreak rule hit: pass. jailbreak, next in GUARD_ORDER, blocks it by
//    rule; asking this classifier first would only add a call (and, when the classifier is down,
//    turn a certain jailbreak block into a chain failure).
// 3. Otherwise one small-tier classifier call (safetyClassifier.ts) on the scrubbed message and
//    the last 3 scrubbed student messages, as data. `none` passes.
// 4. A verdict:
//    - `self_harm` escalates with a distress alert, never blocks (lead answer 1); no safety event.
//    - anything else records a safety event (awaited: a throw fails the chain, still refused),
//      leaves the code for preGuard's reply, and blocks with the code as the reason (no text).
//      `harm_to_others` also leaves a misuse alert for the runner to raise (lead answer 2).
// 5. A classifier throw, timeout, cancel or bad answer propagates: the chain fails closed.
import {
  type GuardResult,
  type SafetyAlert,
  SafetyAlertSchema,
  type SafetyAlert as Alert,
} from '@edmate/contracts';
import { isoAt } from '../pipeline/clock.js';
import { DISTRESS_EXCERPT_MAX } from './distressDetect.js';
import type { Guard, GuardRun } from './guard.js';
import { matchJailbreak } from './jailbreakPatterns.js';
import { matchModeration, type ModerationCode } from './moderationPatterns.js';
import type { PreGuardCtx } from './preGuardCtx.js';
import {
  askClassifier,
  buildModerationClassifierRequest,
  ModerationVerdictSchema,
  SafetyGuardCancelledError,
} from './safetyClassifier.js';

const NAME = 'moderationIn';

/**
 * A SafetyAlert about this turn: `kind` distress (self-harm) or misuse (harm to others). The
 * excerpt is at most DISTRESS_EXCERPT_MAX code points of the scrubbed text, as in distressDetect.
 */
export function preGuardAlert(text: string, ctx: PreGuardCtx, kind: Alert['kind']): SafetyAlert {
  return SafetyAlertSchema.parse({
    id: ctx.ids.next('alert'),
    level: 'alert',
    kind,
    studentId: ctx.entitlement.studentId,
    teacherId: ctx.entitlement.teacherId,
    sessionId: ctx.sessionId,
    excerptRedacted: Array.from(text).slice(0, DISTRESS_EXCERPT_MAX).join(''),
    createdAt: isoAt(ctx.clock.now()),
  });
}

async function verdict(
  text: string,
  ctx: PreGuardCtx,
  code: ModerationCode,
  source: 'rule' | 'classifier',
): Promise<GuardRun> {
  if (code === 'self_harm') {
    const result: GuardResult = {
      ok: false,
      action: 'escalate',
      alert: preGuardAlert(text, ctx, 'distress'),
    };
    return { result, usage: [] };
  }
  await ctx.safetyEvents.record({
    studentId: ctx.entitlement.studentId,
    teacherId: ctx.entitlement.teacherId,
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    guard: NAME,
    code,
    source,
  });
  ctx.blocks.set(
    NAME,
    code === 'harm_to_others' ? { code, alert: preGuardAlert(text, ctx, 'misuse') } : { code },
  );
  return { result: { ok: false, action: 'block', reason: code }, usage: [] };
}

export function createModerationInGuard(): Guard<PreGuardCtx> {
  return {
    name: NAME,
    phase: 'pre',
    async run(text, ctx, cancel) {
      let code = matchModeration(text);
      if (code === 'sexual') {
        // A minor marker may be in an earlier message ("im 15", then the request).
        code = matchModeration(text, await ctx.recentStudentTurns);
      }
      if (code !== null) return verdict(text, ctx, code, 'rule');
      if (matchJailbreak(text, { packageNames: ctx.packageNames }) !== null) {
        return { result: { ok: true }, usage: [] };
      }

      if (cancel.cancelled) throw new SafetyGuardCancelledError(NAME);
      const earlier = await ctx.recentStudentTurns;
      if (cancel.cancelled) throw new SafetyGuardCancelledError(NAME);
      const v = await askClassifier(
        NAME,
        ctx,
        cancel,
        buildModerationClassifierRequest(text, earlier),
        ModerationVerdictSchema,
      );
      // ModelGateway.generateObject reports no usage (4.3 plan Q3): the call is unmetered for now.
      if (v.category === 'none') return { result: { ok: true }, usage: [] };
      return verdict(text, ctx, v.category, 'classifier');
    },
  };
}
