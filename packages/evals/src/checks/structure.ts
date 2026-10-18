// Structure checks: length limits and whether the reply cites a source.
import type { EvalAgentReply } from '../agent.js';
import { result, type CheckResult } from './result.js';

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Counts code points, so an emoji is one character. Same approach as countChars in
 * packages/contracts/src/limits.ts, which is not part of the contracts' public surface.
 */
export function countChars(text: string): number {
  return [...text].length;
}

export function checkMaxWords(reply: string, max: number): CheckResult {
  const n = countWords(reply);
  return result('max_words', n <= max, `${n} words > ${max}`);
}

export function checkMaxChars(reply: string, max: number): CheckResult {
  const n = countChars(reply);
  return result('max_chars', n <= max, `${n} chars > ${max}`);
}

export function checkMustCiteSource(reply: EvalAgentReply, expected: boolean): CheckResult {
  const n = reply.sources?.length ?? 0;
  return expected
    ? result('must_cite_source', n > 0, 'expected at least one source, got none')
    : result('must_cite_source', n === 0, `expected no sources, got ${n}`);
}
