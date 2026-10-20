// Step 6, buildContext (build plan § Turn pipeline spec): history trim, last summary,
// access-filtered retrieval, the locked probe, and the session's help state (ADR-0005).
// The style card and locale pack are already on Entitled (ADR-0004); persona has no source
// before 3.11/5.8, so it is left out (3.5's skill rules fall back to coach).
// Any throw (a store down, an index that widens the scope) sends the runner to its
// `fallbackContext`, which takes the ask_teacher path.
import type { Chunk } from '@edmate/contracts';
import { scopedRetrieval } from '../../access/scopedRetrieval.js';
import { loadSessionHelp } from '../../pedagogy/helpState.js';
import type { Steps } from '../types.js';
import { isWithheld } from '../policies.js';
import { historyChars, historyTrim } from './historyTrim.js';
import { retrievalQuery } from './retrievalQuery.js';

/** Messages fetched before trimming (provisional; revisit at 7.6). */
export const HISTORY_FETCH_LIMIT = 40;
/**
 * The whole budget for history text plus retrieved chunk text, in UTF-16 units: harness purity
 * rules out a tokenizer. About 8k tokens, leaving room for the system prompt, the style card and
 * the reply in any supported model's window (provisional; revisit at 7.6).
 */
export const MAX_CONTEXT_CHARS = 32_000;
/** History's share of MAX_CONTEXT_CHARS; retrieval gets the rest. */
export const HISTORY_MAX_CHARS = 16_000;
/** Chunks asked for per turn (provisional; 5.3/5.4 may change it). */
export const RETRIEVAL_K = 5;

/**
 * The index returned a chunk outside the entitlement's scope (defence in depth, ADR-0003): the
 * check lives in `access/scopedRetrieval.ts` (5.4) and is re-exported here.
 */
export { RetrievalScopeError } from '../../access/scopedRetrieval.js';

/** Chunks in rank order whose text fits in `budget`; one that doesn't fit is skipped. */
function fit(chunks: readonly Chunk[], budget: number): Chunk[] {
  const out: Chunk[] = [];
  let used = 0;
  for (const c of chunks) {
    if (used + c.text.length > budget) continue;
    used += c.text.length;
    out.push(c);
  }
  return out;
}

export const buildContext: Steps['buildContext'] = async ({ input, deps, cancel }, s) => {
  const e = s.entitlement;
  const [profile, fetched] = await Promise.all([
    deps.profiles.get(input.studentId, e.teacherId),
    deps.transcripts.history(input.sessionId, HISTORY_FETCH_LIMIT),
  ]);
  if (profile.studentId !== input.studentId || profile.teacherId !== e.teacherId) {
    throw new Error("buildContext: the profile store returned another student's profile");
  }
  if (cancel.cancelled) throw new Error('buildContext: cancelled');

  // Blocked student messages (saved as a placeholder, 4.4 fix round) never reach the model.
  const kept = fetched.filter((m) => !isWithheld(m));
  const history = historyTrim(kept, HISTORY_MAX_CHARS);
  const q = retrievalQuery(input, kept);
  // The access filter (5.4): the scope comes from the entitlement, every chunk is re-checked (one
  // stray chunk throws RetrievalScopeError) and the probe passes on `{ hit, score }` only.
  const scoped = scopedRetrieval(deps.retrieval, e);
  const [found, probe] = await Promise.all([scoped.search(q, RETRIEVAL_K), scoped.probeLocked(q)]);
  const retrieved = fit(found, MAX_CONTEXT_CHARS - historyChars(history));
  const help = loadSessionHelp(s.helpState);
  return {
    profile,
    history,
    retrieved,
    lockedHit: probe.hit,
    helpRung: help.rung,
    helpState: help.help,
    // 4.6b fix round 1: a stored blob that could not be read may hold lockedStopped true.
    ...(help.unreadable ? { helpStateUnreadable: true } : {}),
  };
};
