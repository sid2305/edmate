# ADR-0007: Locked leak check port (`RetrievalIndex.leakCheck`)

## Status

Accepted

## Date

2026-10-19

## Context

Task 4.6 builds `lockedLeak`, the guard that keeps locked teacher material out of what a student sees. The build plan defines a leak as "any span of 8 or more tokens from a locked chunk" (§ Access filter, point 8; guard table row `lockedLeak`: "Code only: n-gram overlap with the teacher's locked modules (leak = 8+ token span)") and asks for "answer and locked n-grams" to be checked on each sentence before it is sent (§ Streaming with post-guards, line 316).

ADR-0003 keeps locked material away from every model by construction: `RetrievalIndex.probe` "checks the locked modules in code and returns only `{ hit, score }`, never chunk text". No port gives the harness locked chunk text, and none should: once the text is in harness memory, one stray report, trace field or test snapshot could leak it. The harness can't hash text itself either (it may import only contracts, zod and mathjs; build plan rule 3, so no `node:crypto`).

The task plan (`docs/tasks/4.6/plan.md`) went through a safety review and an architect review. The architect proposed a port that returns the matched spans. The safety reviewer pointed out that spans, scores or counts turn the port into an oracle that reads out locked text a little at a time. The lead chose the safety reviewer's shape (19 Oct 2026, plan § Lead answers, risk: high). This ADR extends ADR-0003; it does not replace any of it.

## Decision

Add one method to `RetrievalIndex` in `packages/contracts/src/ports.ts` and the build plan's Core contracts block:

```ts
interface RetrievalIndex {
  // ...search and probe as before (ADR-0003)...
  // Code-only: true when any candidate shares an 8+ token span with this teacher's material outside allowedModuleIds; never text, spans or counts (ADR-0007).
  leakCheck(candidates: readonly string[], scope: { teacherId: string; allowedModuleIds: string[] }): Promise<{ hit: boolean }>;
}
```

1. **One boolean for the whole batch.** The result is `{ hit }` and nothing else: no span, no score, no count, no index of the candidate that hit. The harness sends every text it wants checked at once (a reply, a sentence with its carryover, the string leaves of a tool output) and gets one bit back.
2. **The scope is the complement.** Locked material is every chunk of `teacherId` whose module is *not* in `allowedModuleIds`: the package's locked modules, but also modules in no package yet and draft modules. The caller passes the entitlement's `allowedModuleIds`, the same list `search` takes, so there is no second list to keep in step. A span that also appears in an allowed chunk of the same teacher is ignored (the student may see it anyway).
3. **The match is the shared one.** Text is folded the way `answerLeak` folds it (NFKC, every decimal digit ASCII, invisible format characters dropped or read as a space, lower case) and split into word tokens (runs of letters, marks, digits and `_`). A hit is any 8 contiguous tokens of a candidate that also appear, contiguously, in a locked chunk. `packages/harness/src/guardrails/lockedLeak.ts` exports the tokeniser and shingle index (`LOCKED_LEAK_MIN_TOKENS = 8`); the in-memory adapter uses it and the real adapter must use it too, so the two can't disagree on what counts as a leak. The adapter shingles each module's text in source order, so a span that runs across two chunks of one module still matches.
4. **The adapter checks ownership and never logs.** It refuses a scope whose `teacherId` is missing or whose `allowedModuleIds` is not a list of strings, and it ignores allowed module ids that are not this teacher's (they can't widen what counts as allowed). It never logs, traces or stores a candidate; errors name the cause only.
5. **The adapter fails closed.** A timeout, an error or a response it can't vouch for is reported as `{ hit: true }`. The harness fails closed again on its side: a rejection, a timeout (`LOCKED_CHECK_TIMEOUT_MS`, 150 ms per call) or a result that is not exactly `{ hit: boolean }` withholds the sentence in the stream, fails the tool call (`failed('locked')`), drops the skill event (`drop('locked')`) and fails the post-guard chain, which sends the safe reply.
6. **Latency SLO.** p95 ≤ 50 ms and p99 ≤ 100 ms per call for a batch up to one full reply (8,000 characters), measured at the adapter. That is under the post-guard slice for each guard (`postGuardSliceMs`: 450 ms with the two post guards of task 4.6, 150 ms once all six exist) and under the harness's own 150 ms timeout, so a slow index degrades to the safe or locked reply rather than a slow turn. The stream calls it once per sentence.
7. **Cache keyed by package version.** The adapter may cache a teacher's shingle sets. The key is `(teacherId, packageId, packageVersion)` plus the teacher's material revision: any ingest, edit or deletion of a chunk of that teacher's must invalidate it, because the complement includes draft and unpackaged modules whose text changes without a new package version (ADR-0003 point 6).
8. **The residual oracle is bounded (fix round 1, task 4.6b).** The stream holds the last 7 checked tokens back until the next sentence passes its check or the attempt ends cleanly (`guardrails/lockedMatch.ts: carryStart`, `pipeline/generate/lockedStream.ts`), so a span that trips later is never shown even in part (0 locked tokens stream before a replace in the fixture suite). Within one turn, where the stream stopped still narrows the hit to one of the turn's sentence boundaries: about log2(N+1) bits for an N-sentence reply, once. After the first locked hit or failed check in a session, the harness stops streaming for the rest of that session (a flag in the session's saved help state, read before the next turn's attempt): every later reply is held whole and shown only once the full-reply check passes, the same path a non-streamed reply takes. So a session's oracle is bounded to about log2(N+1) bits once, from the turn that first tripped, then 1 bit per turn after that (whether that turn's reply was replaced), not a fresh positional guess every turn. What remains is further bounded by the package's daily message limit (default 20 a day) and is logged as a locked hit each time.

## Alternatives

- **Return the matched spans, so the harness can cut them out (the architect's proposal).** Not chosen: the spans are locked text, so the port would hand locked text to the harness, and a student could read the locked material out one span at a time. The lead also chose whole-reply replacement over surgical removal (task plan, lead answer 3), so the harness has no use for spans.
- **Return `{ hit, score }` like `probe`.** Not chosen: a score is a graded oracle. A boolean is all the guard needs.
- **Fetch the turn's locked chunks once and match in the harness.** Not chosen: it would be the first place outside the adapter layer that holds locked text, against ADR-0003's "kept away from the AI, not merely forbidden".
- **Fetch hashed shingles and match in the harness.** Not chosen: the harness can't hash without a tech-stack exception (no `node:crypto`), and short shingles are easy to reverse from public text.
- **A `moduleIds` list of locked modules, like `probe`.** Not chosen: the entitlement's `lockedModuleIds` is the other modules in a package, not every module, so draft and unpackaged modules would go unchecked. The complement of the allowed list covers them by construction.

## Consequences

- Every adapter of `RetrievalIndex` must implement `leakCheck` (the in-memory one does, task 4.6; the Postgres one comes with the real retrieval adapter). The type tests and the spec-drift test pin the shape.
- The harness checks every place text reaches a student or a model: each streamed sentence (with a 7-token carryover, so a span across sentences is caught), every tool output before the model sees it, every skill payload before it is sent, and the whole reply in the post-guard chain, where `lockedLeak` runs before `answerLeak` so the answer rewriter never receives a locked span.
- What it does not catch: spans under 8 tokens, filler words interleaved, reordered sentences, renamed variables in code, summaries, contractions written differently, and translation. `lockedLeak` is a verbatim backstop; those are judge-scored (task 4.5b).
- Each call is a round trip, once per sentence while streaming. A slow or failing index makes replies fall back to the locked or safe reply; it never lets text through.
- Changing the result shape (adding spans, scores or counts) needs a new ADR that supersedes this one.

## Reviewers

architect, security-reviewer, typescript-reviewer (task 4.6 PR). Shape chosen by the team lead after the safety-reviewer and architect plan reviews, 19 Oct 2026.
