// Step 6, buildContext (build plan § Turn pipeline spec): history trim, last summary,
// access-filtered retrieval, the locked probe, and the session's help state (ADR-0005).
// 3.4c: the locked probe and locked precedence run on the student's own words only; a second
// search widened by the agent's last reply can only add coverage, never dilute or inflate a
// locked verdict (retrievalQuery.ts's retrievalQueries, mergeByScore below).
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
import { retrievalQueries } from './retrievalQuery.js';

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

/**
 * Union of `own` (the student's own words) and `ctx` (the agent-widened query) by chunk id,
 * keeping the higher score for a chunk found by both. Sorted by score descending; an unscored
 * chunk sorts last and stays unscored, keeping `own`'s rank order (stable sort), then capped to
 * `k` (3.4c: the dilution fix).
 */
function mergeByScore(own: readonly Chunk[], ctx: readonly Chunk[], k: number): Chunk[] {
  const byId = new Map<string, Chunk>();
  for (const c of [...own, ...ctx]) {
    const prev = byId.get(c.id);
    if (prev === undefined || (c.score ?? -1) > (prev.score ?? -1)) byId.set(c.id, c);
  }
  return [...byId.values()]
    .sort((a, b) => {
      if (a.score === undefined && b.score === undefined) return 0;
      if (a.score === undefined) return 1;
      if (b.score === undefined) return -1;
      return b.score - a.score;
    })
    .slice(0, k);
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
  const { student, withContext } = retrievalQueries(input, kept);
  // The access filter (5.4): the scope comes from the entitlement, every chunk is re-checked (one
  // stray chunk throws RetrievalScopeError) and the probe passes on `{ hit, score }` only.
  const scoped = scopedRetrieval(deps.retrieval, e);
  // 3.4c: the locked probe and the student-only search run on the student's own words, never the
  // agent's reply, so the agent's words can neither inflate nor dilute them. The agent-widened
  // search only adds coverage, and only when the student's own words don't hit locked material
  // (locked precedence, below).
  const [own, probe, ctx] = await Promise.all([
    scoped.search(student, RETRIEVAL_K),
    scoped.probeLocked(student),
    withContext === student
      ? Promise.resolve<Chunk[]>([])
      : scoped.search(withContext, RETRIEVAL_K),
  ]);
  const found = probe.hit ? own : mergeByScore(own, ctx, RETRIEVAL_K);
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
