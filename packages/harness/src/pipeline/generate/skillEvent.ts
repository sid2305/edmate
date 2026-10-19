// `skill` events from tool results (task 3.7). A tool's `present` turns its output into a payload
// for the student's screen (a practice item, interview state). Fail closed: the event is sent only
// when the skill is entitled, the payload fits LIMITS.skillPayloadMaxJsonLength, and no do-not-say
// string (the answer key) appears in it. This is a cheap substring check; 4.5 adds the robust one.
import { LIMITS, SkillSchema, type TurnContext, type TurnEvent } from '@edmate/contracts';
import { z } from 'zod';
import type { RegisteredTool } from '../tools.js';
import { jsonSafe } from './toolMessages.js';

export type SkillDropReason =
  'present_failed' | 'invalid' | 'not_entitled' | 'too_large' | 'answer_key';

/** Reported to `finished.background`; names the tool and a fixed reason, never the payload. */
export class SkillEventDropped extends Error {
  override readonly name = 'SkillEventDropped';

  constructor(
    readonly tool: string,
    readonly reason: SkillDropReason,
  ) {
    super(`skill event from tool "${tool}" dropped: ${reason}`);
  }
}

const PresentationSchema = z.strictObject({ skill: SkillSchema, payload: z.unknown() });

/** Every string in the value, keys included, plus numbers as text. */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      leaves(v, out);
    }
  }
  return out;
}

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
  } catch {
    return drop('present_failed');
  }
  if (shown === undefined) return undefined;
  const p = PresentationSchema.safeParse(shown);
  if (!p.success) return drop('invalid');
  if (!ctx.entitlement.skills.includes(p.data.skill)) return drop('not_entitled');
  const json = jsonSafe(p.data.payload);
  if (!json.ok || json.json.length > LIMITS.skillPayloadMaxJsonLength) return drop('too_large');
  const keys = mustNotReveal.map((k) => k.trim().toLowerCase()).filter((k) => k !== '');
  const texts = [json.json, ...leaves(json.value)].map((t) => t.toLowerCase());
  if (keys.some((k) => texts.some((t) => t.includes(k)))) return drop('answer_key');
  return { type: 'skill', skill: p.data.skill, payload: json.value };
}
