# Lessons

Failed attempts and human corrections worth knowing before you plan or build. Each entry says what was tried, what went wrong and the fix. Its `Sources:` line cites a real `docs/decisions/log.md` heading (quoted, as `date · title`) or a `docs/tasks/<id>/review.md` file; `.claude/tests/test_digest.py` checks that every citation exists. Add an entry when a task needed a fix round or the human corrected a decision (closeout prints a reminder). Never add one without a real source.

## A guard that can't run must fail closed, not open

The content package checks locale-pack regexes in a worker thread with a time limit. A production web build bundled the package, so the worker file could not be found at run time. In 1.7 the review found that the PII patterns in the India pack then timed out and the pack was refused. The first fallback (meant for dev) ran the check in-process with no time limit, so a missing worker silently passed every pattern. The 1.7b fix round made a missing worker in production report every pattern as unsafe, and a build-smoke test now relocates the build to prove the worker survives it. Lesson: when a safety check's own machinery is missing, treat that as a failure; test the shipped build layout, not only the source tree.

Sources: log "20 Oct 2026 · 1.7b fix round: a missing/relocated safe-regex worker fails closed in production"; docs/tasks/1.7/review.md

## A practice item the model writes can't keep its answer secret

Under the first practice pack an item could be written by the model, and the 5.6 plan noted that the answer to a model-written item cannot be protected. Its first decision (ADR-0010) moved every item behind the `practice.next_item` tool: the key is looked up on the server by item id and never reaches the model on the issuing turn or the client. The 5.6 review still found a HIGH: bank items were served without a runtime check, and a dead `practiceAnswerKey` field meant one set of keys never reached the post guard. One fix round made item checks run at run time and fail closed. Lesson: an answer the model has seen can't be protected; keep keys server-side and check each served item at run time, not only in tests.

Sources: log "20 Oct 2026 · 5.6 Practice items come only from practice.next_item; keys stay on the server (ADR-0010)"; docs/tasks/5.6/review.md

## Red CI from changes that passed locally

Several changes that passed locally left CI red (the next entry is one that turned main red). In 5.6 the content snapshot was not regenerated after a prompt-pack rewording. In 1.7f a web test still expected the old age-flow result after the US pack was signed. In 1.7b a workflow file that GitHub could not parse broke CI until the lead fixed it, and that was counted as a miss for all three 1.7b reviewers. Lesson: before the handoff, run the full suite for every package the change touches, snapshots included, and treat a workflow or snapshot edit as code that needs its own check.

Sources: docs/tasks/5.6/review.md; docs/tasks/1.7f/review.md; log "21 Oct 2026 · 0.18 Phase B: registry prose comes from evidence only"

## Wall-clock bounds fail on shared CI runners

The stream-gate latency test asserted a 1 s wall-clock bound. Shared CI runners with coverage are 8 to 12 times slower than a laptop, so the bound turned main's CI red. The fix kept a loose 5 s bound as a gross-regression guard and asserted linear work by counting work, not by timing it. Lesson: don't gate CI on tight timings; count operations instead.

Sources: log "19 Oct 2026 · 0.14 Wall-clock latency bounds are gross-regression guards only"

## A check that silently skips looks like a pass

0.17 added a merge-gate check that compares a builder's tool-call count with the plan's budget. As first built, a budget written in prose (not a bare `Budget: N` line) was never parsed, so the check quietly did nothing. security-reviewer and code-reviewer both raised it as a HIGH, and fix round 1 taught the parser the prose forms. Lesson: when a parser can't read its input, say so loudly; a silent no-op is easy to miss in review and in tests.

Sources: log "21 Oct 2026 · 0.17 agent limits and merge-gate budget check (.claude, risky path)"

## Narrowing an exemption round after round: the human removed it

Distress detection let a hard self-harm phrase count as soft when it sat next to a game word ("killed myself in" a game). Three fix rounds narrowed that exemption to game-shaped phrases, but each version still left a path where a real hard phrase could be read as soft. The human removed the exemption entirely: every hard phrase escalates whatever words sit near it, and an occasional false page is accepted. Lesson: in a safety guard, prefer certainty over precision; if an exemption needs a third fix round, ask the human whether it should exist at all.

Sources: log "19 Oct 2026 · 4.3 The game-talk exemption is removed: every hard phrase stays hard near a game word"; log "19 Oct 2026 · 4.3 gets one more narrow fix round"

## A studio page that trusts a 200 response gets stuck

Two studio pages (8.4b style card, 8.3c outline) shipped the same HIGH bug: the client read the JSON of a 200 response without a catch, and the page set its "saving" or "drafting" flag without a `finally`, so a malformed reply or a network error left the buttons disabled for good. Lesson: every studio client wraps the body read in try/catch and returns an error code, and every page action uses try/catch/finally with a busy flag. UI briefs now say so up front.

Sources: docs/tasks/8.4b/review.md

## Chat UI state that is set but never cleared, and payloads that are cast

The 9.5a practice screen shipped two HIGH bugs in ChatView. `activeSkill` was set when a practice card arrived but never cleared, so every later plain message was tagged as practice. And the card's payload, which comes from the server as `unknown`, was cast to its type instead of checked. Lesson: every piece of chat state that tags outgoing turns needs a stated reset point, with a test for the turn after it; and a client reads every server event payload through a zod `safeParse`, falling back to a generic view when it fails. UI briefs for 9.5b, 9.6 and 9.7 say so up front.

Sources: docs/tasks/9.5a/review.md
