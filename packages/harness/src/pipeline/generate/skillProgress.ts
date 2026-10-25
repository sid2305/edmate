// Harness-computed `skill` progress events for feedback and mock-interview (task 13.skillpresent,
// lead answer Q1): neither skill has a model-callable tool (ADR-0012, ADR-0013 moved role-play
// state server-side, out of model control), so these events are built straight from state the
// policy already derived (`PolicyResult.skill`, `PolicyResult.rolePlay`), never from a tool's
// `present()`. Unlike `skillEvent.ts`'s tool-output events, there is deliberately no answer-key
// or locked check here: this payload is 100% harness-computed metadata (a phase, a count, a fixed
// marker) that the model never sees or writes, so nothing here can leak a locked chunk or an
// answer key. A future reviewer should not assume this needs the same checks as a tool's output.
// Fail closed, like `skillEvent.ts`: never throw; drop (return `undefined`) when the skill is not
// entitled or the payload is too large to send.
import { LIMITS, type PedagogyDecision, type Skill, type TurnContext, type TurnEvent } from '@edmate/contracts';
import type { RolePlay } from '../../pedagogy/roleplay.js';
import { jsonSafe } from './toolMessages.js';

type SkillTurnEvent = Extract<TurnEvent, { type: 'skill' }>;

/**
 * The mock-interview progress event from `DecideResult.rolePlay`, or `undefined` when there is
 * no role-play this turn, the student is not entitled to `mock_interview`, or the (small, fixed-
 * shape) payload somehow exceeds `LIMITS.skillPayloadMaxJsonLength`.
 */
export function rolePlaySkillEvent(
  rolePlay: RolePlay | undefined,
  ctx: Pick<TurnContext, 'entitlement'>,
): SkillTurnEvent | undefined {
  if (rolePlay === undefined) return undefined;
  if (!ctx.entitlement.skills.includes('mock_interview')) return undefined;
  const json = jsonSafe(rolePlay);
  if (!json.ok || json.json.length > LIMITS.skillPayloadMaxJsonLength) return undefined;
  return { type: 'skill', skill: 'mock_interview', payload: json.value };
}

/**
 * A confirmed feedback-verdict marker (lead answer Q2: `{ given: true }`, no score, no text
 * parsing — ADR-0012 bans a numeric score). Fires only on the feedback skill's `hint` move (the
 * move that carries the model's written verdict), so the web client no longer has to guess which
 * reply was the verdict from a one-shot client-side flag.
 */
export function feedbackSkillEvent(
  skill: Skill | null | undefined,
  move: PedagogyDecision['move'],
  ctx: Pick<TurnContext, 'entitlement'>,
): SkillTurnEvent | undefined {
  if (skill !== 'feedback' || move !== 'hint') return undefined;
  if (!ctx.entitlement.skills.includes('feedback')) return undefined;
  const json = jsonSafe({ given: true });
  if (!json.ok || json.json.length > LIMITS.skillPayloadMaxJsonLength) return undefined;
  return { type: 'skill', skill: 'feedback', payload: json.value };
}
