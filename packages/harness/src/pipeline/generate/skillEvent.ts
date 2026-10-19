// `skill` events from tool results (task 3.7). A tool's `present` turns its output into a payload
// for the student's screen (a practice item, interview state). Fail closed: the event is sent only
// when the skill is entitled, the payload fits LIMITS.skillPayloadMaxJsonLength, and no do-not-say
// string (the answer key) appears in it, after normalising (answerKey.ts); 4.5 adds the robust one.
import { LIMITS, SkillSchema, type TurnContext, type TurnEvent } from '@edmate/contracts';
import { z } from 'zod';
import type { RegisteredTool } from '../tools.js';
import { errorName, HarnessError } from '../errors.js';
import { revealsAnswerKey } from './answerKey.js';
import { jsonSafe } from './toolMessages.js';

export type SkillDropReason =
  'present_failed' | 'invalid' | 'not_entitled' | 'too_large' | 'answer_key';

/**
 * Reported to `finished.background`; names the tool and a fixed reason, never the payload. A
 * caught error is kept as `cause` by name only (its message could quote the payload).
 */
export class SkillEventDropped extends HarnessError {
  override readonly name = 'SkillEventDropped';

  constructor(
    readonly tool: string,
    readonly reason: SkillDropReason,
    causeName?: string,
  ) {
    super(
      `skill event from tool "${tool}" dropped: ${reason}`,
      causeName === undefined ? undefined : { cause: { name: causeName } },
    );
  }
}

const PresentationSchema = z.strictObject({ skill: SkillSchema, payload: z.unknown() });

/** The event, `undefined` when the tool shows nothing, or why it was dropped. */
export function skillEvent(
  entry: RegisteredTool,
  output: unknown,
  ctx: TurnContext,
  mustNotReveal: readonly string[],
): Extract<TurnEvent, { type: 'skill' }> | SkillEventDropped | undefined {
  if (entry.present === undefined) return undefined;
  const drop = (reason: SkillDropReason) => new SkillEventDropped(entry.tool.name, reason);
  let shown: unknown;
  try {
    shown = entry.present(output, ctx);
  } catch (e) {
    return new SkillEventDropped(entry.tool.name, 'present_failed', errorName(e));
  }
  if (shown === undefined) return undefined;
  const p = PresentationSchema.safeParse(shown);
  if (!p.success) return drop('invalid');
  if (!ctx.entitlement.skills.includes(p.data.skill)) return drop('not_entitled');
  const json = jsonSafe(p.data.payload);
  if (!json.ok || json.json.length > LIMITS.skillPayloadMaxJsonLength) return drop('too_large');
  if (revealsAnswerKey(json.value, mustNotReveal)) return drop('answer_key');
  return { type: 'skill', skill: p.data.skill, payload: json.value };
}
