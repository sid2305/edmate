// Fake grounding judges for tests (task 4.7). No model call (rule 4). The gateway wrapper answers
// only requests carrying grounding's fixed rubric; every other request goes to the inner gateway.
//
// `overlapJudge` is non-circular (lead answer 7): its verdict follows from the request it gets,
// never from the test's expectation. It reads the delimited blocks grounding sends (material, the
// student's message, the reply) and says grounded only when every claim sentence of the reply
// shares most of its content words with a material chunk or the student's message. The rubric's
// exemptions are mirrored: questions back, encouragement, and saying something is not covered or
// has gone to the teacher need no support; agreeing with the student ("yes", "haan") is a claim
// that the material alone must support.
import type { ModelChunk, ModelGateway, ModelRequest } from '@edmate/contracts';
import { usageSmall } from '@edmate/contracts/fixtures';
import { GROUNDING_JUDGE_SYSTEM } from '../guardrails/grounding.js';
import type { Clock } from './clock.js';

/** What grounding's judge request holds, read back from its data blocks. */
export interface JudgeInput {
  chunks: string[];
  studentText: string;
  reply: string;
}

/** Decides the judge's raw text from the request (e.g. `{"grounded":true}` or anything else). */
export type JudgeVerdict = (input: JudgeInput, req: ModelRequest) => string;

const BLOCK = /<<<\n([\s\S]*?)\n>>>/g;

/** Reads grounding's request: every block but the last two is material. */
export function readJudgeRequest(req: ModelRequest): JudgeInput {
  const user = req.messages[0]?.content;
  const blocks = [...(typeof user === 'string' ? user : '').matchAll(BLOCK)].map(
    (m) => m[1] as string,
  );
  return {
    chunks: blocks.slice(0, -2),
    studentText: blocks.at(-2) ?? '',
    reply: blocks.at(-1) ?? '',
  };
}

export const GROUNDED_VERDICT = '{"grounded":true}';
export const UNGROUNDED_VERDICT = '{"grounded":false}';

const STOP = new Set(
  (
    'the and for are but not you your yours with this that these those from into have has had was ' +
    "were will would can could should its it’s it's them they then than there their what when " +
    'which who how why also just only very some any all one each our out use using used get gets ' +
    'does doing done like make makes made about after before over under again more most here ' +
    'hai hain ka ki ke mein aur ko se ye yeh wo woh to hi bhi na kya nahi kar karo karte hota ' +
    'है हैं का की के में और को से यह वह तो ही भी ना क्या नहीं'
  ).split(/\s+/),
);
const WORD = /[\p{L}\p{M}\p{N}_]+/gu;
const AGREE =
  /^\s*(?:yes|yeah|yep|right|correct|exactly|haan|han|ha|sahi|bilkul|हां|हाँ|सही|बिल्कुल)(?![\p{L}\p{M}])/iu;
const CHEER =
  /^\s*(?:great|good|nice|well done|you've got this|keep going|let's|shabash|badhiya|बहुत बढ़िया|शाबाश)/iu;
const META =
  /(?:isn't|is not|not yet|aren't|are not) covered|not in (?:your|the) (?:teacher's )?material|(?:passed|sent|gone|going) (?:it |this |your question )?(?:on )?to your teacher|cover nahi|कवर नहीं/iu;
/** Share of a claim sentence's content words that must appear in its support. */
const OVERLAP = 0.6;

const words = (s: string): string[] =>
  (s.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function supported(sentence: string, support: Set<string>): boolean {
  const w = words(sentence);
  if (w.length === 0) return true;
  return w.filter((x) => support.has(x)).length / w.length >= OVERLAP;
}

/** The non-circular fake judge's decision: true when every claim sentence is supported. */
export function overlapGrounded(input: JudgeInput): boolean {
  const material = new Set(input.chunks.flatMap(words));
  const both = new Set([...material, ...words(input.studentText)]);
  return sentences(input.reply).every((s) => {
    if (AGREE.test(s)) return supported(s.replace(AGREE, ''), material);
    if (s.endsWith('?') || CHEER.test(s) || META.test(s)) return true;
    return supported(s, both);
  });
}

/** The non-circular fake judge (lead answer 7): `{"grounded":true}` only when the input says so. */
export const overlapJudge: JudgeVerdict = (input) =>
  overlapGrounded(input) ? GROUNDED_VERDICT : UNGROUNDED_VERDICT;

export interface JudgeGateway extends ModelGateway {
  /** Copies of every judge request it answered, in order. */
  readonly judged: ModelRequest[];
}

/**
 * `inner`, except grounding's judge requests, which `verdict` answers (after `delayMs` on `clock`,
 * when given), with one small-tier usage chunk.
 */
export function judgeGateway(
  inner: ModelGateway,
  verdict: JudgeVerdict,
  opts: { clock?: Clock; delayMs?: number } = {},
): JudgeGateway {
  const judged: ModelRequest[] = [];
  return {
    judged,
    stream(req) {
      if (req.system !== GROUNDING_JUDGE_SYSTEM) return inner.stream(req);
      judged.push(JSON.parse(JSON.stringify(req)) as ModelRequest);
      return (async function* (): AsyncGenerator<ModelChunk> {
        if (opts.clock !== undefined && opts.delayMs !== undefined) {
          await opts.clock.sleep(opts.delayMs);
        }
        yield { type: 'text', text: verdict(readJudgeRequest(req), req) };
        yield { type: 'usage', usage: usageSmall };
      })();
    },
    generateObject: (req, schema) => inner.generateObject(req, schema),
    embed: (texts) => inner.embed(texts),
  };
}
