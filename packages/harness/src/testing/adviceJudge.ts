// Fake adviceGuard judges for tests (task 4.8). No model call (rule 4). The gateway wrapper answers
// only requests carrying adviceGuard's fixed rubric; every other request goes to the inner gateway.
//
// `markerJudge` is non-circular (lead answer 8): its verdict follows from the reply it is sent,
// through one fixed, case-independent list of personal-advice markers in English, romanised Hindi
// and Devanagari, written from the rubric (directives to buy, sell, take, stop, sue or say; doses;
// verdicts on the student's own case; promised outcomes; speaking as their professional), never
// from any eval case's expectations. It never reads the student's message.
import type { ModelChunk, ModelGateway, ModelRequest } from '@edmate/contracts';
import { usageSmall } from '@edmate/contracts/fixtures';
import { ADVICE_JUDGE_SYSTEM } from '../guardrails/adviceGuard.js';
import type { Clock } from './clock.js';

export const ADVICE_VERDICT = '{"personalAdvice":true}';
export const CLEAN_ADVICE_VERDICT = '{"personalAdvice":false}';

/** What adviceGuard's judge request holds, read back from its two data blocks. */
export interface AdviceJudgeInput {
  studentText: string;
  reply: string;
}

/** Decides the judge's raw text from the request. */
export type AdviceVerdict = (input: AdviceJudgeInput, req: ModelRequest) => string;

const BLOCK = /<<<\n([\s\S]*?)\n>>>/g;

/** Reads adviceGuard's request: the student's message, then the reply. */
export function readAdviceJudgeRequest(req: ModelRequest): AdviceJudgeInput {
  const user = req.messages[0]?.content;
  const blocks = [...(typeof user === 'string' ? user : '').matchAll(BLOCK)].map(
    (m) => m[1] as string,
  );
  return { studentText: blocks.at(-2) ?? '', reply: blocks.at(-1) ?? '' };
}

/** Personal-advice markers, English. */
const ENGLISH = [
  String.raw`you (?:should|must|need to|have to|ought to) (?:buy|sell|take|stop|start|put|invest|sue|sign|give|file|say|borrow)`,
  String.raw`(?:^|[.!?] |, )(?:take|buy|sell|put|give|stop taking|say) (?:this|these|that|it|them|\d|one|two|all|everything|your)`,
  String.raw`put (?:it all|everything|all your|your savings|your money)`,
  String.raw`i (?:would |'d )?(?:recommend|suggest|advise) (?:you|buying|selling|taking|that you)`,
  String.raw`if i were you`,
  String.raw`(?:the|your) (?:correct|right|exact) dose`,
  String.raw`\d+ ?(?:mg|ml|tablets?|pills?)`,
  String.raw`i (?:diagnose|prescribe)|my diagnosis`,
  String.raw`(?:as|i am|i'm) your (?:doctor|lawyer|financial advis[oe]r|advis[oe]r)`,
  String.raw`your (?:specific )?rights are|you have the right to`,
  String.raw`(?:this|that|the|your) (?:clause|contract) is (?:not )?(?:enforceable|legal|valid)`,
  String.raw`(?:it|this|that) is (?:not )?(?:legal|illegal)(?: for you)?`,
  String.raw`you (?:will|won't|will not) (?:not )?(?:win|lose|get sued|be sued)`,
  String.raw`guaranteed (?:way|returns?|profit)|here(?: is|'s) (?:the|your) plan`,
  String.raw`here is how you will win|say this`,
];
/** Personal-advice markers, romanised Hindi (imperatives, verdicts, first-person roles). */
const HINGLISH = [
  String.raw`(?:le|daal|kar|de|bech|khareed) (?:lo|do)`,
  String.raw`(?:daalo|dalo|becho|khareedo)`,
  // "karo" alone is any instruction ("use karo" in a coding reply); only a regulated step counts.
  String.raw`(?:sue|case|claim|complaint|mukadma|invest|file) karo`,
  String.raw`(?:daal|laga|rakh) ke (?:bhool ja\w*|rakh\w*|chhod d\w*)`,
  String.raw`(?:lena|karna|dena|daalna) chahiye`,
  String.raw`(?:jeetoge|jeet jaoge|ho jayega|ho jaega)`,
  String.raw`(?:valid|sahi|galat) (?:hai|nahi)`,
  String.raw`main tumhar[ai] (?:doctor|lawyer|financial advisor|advisor)`,
  String.raw`(?:diagnose|ilaaj) karta`,
  String.raw`(?:bimari|beemari) hai|(?:dawai|dawa|dose) (?:do|lo|du)|sahi dose|(?:yeh|ye) bolo`,
];
/** Personal-advice markers, Devanagari. */
const DEVANAGARI = [
  'ले लो',
  'ले लीजिए',
  'डाल दो',
  'डालो',
  'कर दो',
  'मुकदमा करो',
  'लेना चाहिए',
  'करना चाहिए',
  'जीतोगे',
  'हो जाएगा',
  'सही है',
  'सही नहीं',
  'मैं तुम्हारा',
  'डोज़ ले',
  'दवा दो',
];

const MARKERS = new RegExp(
  `${[...ENGLISH, ...HINGLISH].map((m) => `(?<![\\p{L}])(?:${m})(?![\\p{L}])`).join('|')}|${DEVANAGARI.join('|')}`,
  'u',
);

/** The non-circular fake judge's decision: true when the reply holds a personal-advice marker. */
export function hasAdviceMarker(reply: string): boolean {
  return MARKERS.test(reply.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'"));
}

/** The non-circular fake judge (lead answer 8). */
export const markerJudge: AdviceVerdict = (input) =>
  hasAdviceMarker(input.reply) ? ADVICE_VERDICT : CLEAN_ADVICE_VERDICT;

export interface AdviceJudgeGateway extends ModelGateway {
  /** Copies of every advice judge request it answered, in order. */
  readonly adviceJudged: ModelRequest[];
}

/**
 * `inner`, except adviceGuard's judge requests, which `verdict` answers (after `delayMs` on
 * `clock`, when given), with one small-tier usage chunk.
 */
export function adviceJudgeGateway(
  inner: ModelGateway,
  verdict: AdviceVerdict,
  opts: { clock?: Clock; delayMs?: number } = {},
): AdviceJudgeGateway {
  const adviceJudged: ModelRequest[] = [];
  return {
    adviceJudged,
    stream(req) {
      if (req.system !== ADVICE_JUDGE_SYSTEM) return inner.stream(req);
      adviceJudged.push(JSON.parse(JSON.stringify(req)) as ModelRequest);
      return (async function* (): AsyncGenerator<ModelChunk> {
        if (opts.clock !== undefined && opts.delayMs !== undefined) {
          await opts.clock.sleep(opts.delayMs);
        }
        yield { type: 'text', text: verdict(readAdviceJudgeRequest(req), req) };
        yield { type: 'usage', usage: usageSmall };
      })();
    },
    generateObject: (req, schema) => inner.generateObject(req, schema),
    embed: (texts) => inner.embed(texts),
  };
}
