// Fake answerLeak paraphrase judges for tests (task 4.5b). No model call (rule 4). The gateway
// wrapper answers only requests carrying answerLeak's fixed rubric; every other request goes to
// the inner gateway.
//
// `paraphraseJudge` is non-circular (plan Q3, lead review item 1): its verdict follows only from
// the request's own key and reply blocks (word overlap plus a small fixed confirmation-marker
// table, English and the Hinglish/Devanagari list `answerKey.ts`'s own confirmation check uses),
// never from any eval case's expectation.
import type { ModelChunk, ModelGateway, ModelRequest } from '@edmate/contracts';
import { usageSmall } from '@edmate/contracts/fixtures';
import { LEAK_JUDGE_SYSTEM } from '../guardrails/answerLeak.js';
import type { Clock } from './clock.js';

export const LEAK_VERDICT = '{"leak":true}';
export const CLEAN_LEAK_VERDICT = '{"leak":false}';

/** What answerLeak's judge request holds, read back from its two data blocks. */
export interface LeakJudgeInput {
  key: string;
  reply: string;
}

/** Decides the judge's raw text from the request. */
export type LeakVerdict = (input: LeakJudgeInput, req: ModelRequest) => string;

// The fence markers may carry a per-request token right after `<<<`/`>>>` (4.7b item 1, reused by
// 4.5b): either form still opens and closes exactly one block.
const BLOCK = /<<<[^\n]*\n([\s\S]*?)\n>>>[^\n]*/g;

/** Reads answerLeak's request: the hidden answer, then the reply. */
export function readLeakJudgeRequest(req: ModelRequest): LeakJudgeInput {
  const user = req.messages[0]?.content;
  const blocks = [...(typeof user === 'string' ? user : '').matchAll(BLOCK)].map(
    (m) => m[1] as string,
  );
  return { key: blocks.at(-2) ?? '', reply: blocks.at(-1) ?? '' };
}

/** Confirmation and agreement markers (English, romanised Hindi, Devanagari): a close paraphrase
 * is almost always introduced or confirmed by one of these. */
const CONFIRM =
  /(?<![\p{L}])(?:yes|yeah|yep|right|correct|exactly|that's it|that is it|haan|han|bilkul|sahi|हां|हाँ|सही|बिल्कुल)(?![\p{L}])/iu;

const WORD = /[\p{L}\p{M}\p{N}_]+/gu;
const STOP = new Set(['the', 'a', 'an', 'is', 'it', 'was', 'that', 'this', 'to', 'of', 'and']);

function words(s: string): string[] {
  return (s.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Share of the key's own content words that show up in the reply. */
const OVERLAP = 0.6;

/** The non-circular fake judge's decision: true when the reply paraphrases the key (plan Q3). */
export function paraphrasesKey(input: LeakJudgeInput): boolean {
  const keyWords = words(input.key);
  if (keyWords.length === 0) return false;
  const replyWords = new Set(words(input.reply));
  const overlap = keyWords.filter((w) => replyWords.has(w)).length / keyWords.length;
  return overlap >= OVERLAP || (overlap > 0 && CONFIRM.test(input.reply));
}

/** The non-circular fake judge (plan Q3): `{"leak":true}` only when the input says so. */
export const paraphraseJudge: LeakVerdict = (input) =>
  paraphrasesKey(input) ? LEAK_VERDICT : CLEAN_LEAK_VERDICT;

export interface LeakJudgeGateway extends ModelGateway {
  /** Copies of every leak judge request it answered, in order. */
  readonly leakJudged: ModelRequest[];
}

/**
 * `inner`, except answerLeak's judge requests, which `verdict` answers (after `delayMs` on
 * `clock`, when given), with one small-tier usage chunk.
 */
export function leakJudgeGateway(
  inner: ModelGateway,
  verdict: LeakVerdict,
  opts: { clock?: Clock; delayMs?: number } = {},
): LeakJudgeGateway {
  const leakJudged: ModelRequest[] = [];
  return {
    leakJudged,
    stream(req) {
      if (req.system !== LEAK_JUDGE_SYSTEM) return inner.stream(req);
      leakJudged.push(JSON.parse(JSON.stringify(req)) as ModelRequest);
      return (async function* (): AsyncGenerator<ModelChunk> {
        if (opts.clock !== undefined && opts.delayMs !== undefined) {
          await opts.clock.sleep(opts.delayMs);
        }
        yield { type: 'text', text: verdict(readLeakJudgeRequest(req), req) };
        yield { type: 'usage', usage: usageSmall };
      })();
    },
    generateObject: (req, schema) => inner.generateObject(req, schema),
    embed: (texts) => inner.embed(texts),
  };
}
