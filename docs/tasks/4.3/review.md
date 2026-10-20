# 4.3 review — APPROVE
Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

A safety plan review came before the build. The build took four fix rounds. After round 2 the lead escalated to the human (two failed rounds); rounds 3 and 4 were the human's decisions (B-16, B-18). The safety reviewer approved round 4.
- Round 1 (safety review: 3 HIGH, 4 MEDIUM/LOW): added the missing Hinglish and Devanagari hard stems; when preGuard fails, the runner escalates on any hard or soft keyword; normalisation catches zero-width characters, look-alike letters, leetspeak, digit words and written-together phrases; bare nouns, third person and past tense became soft (classifier); the notifier got a 20 s timeout per call; a fourth eval mode (guard alone) was added.
- Round 2 (lead: "100% of distress cases escalate"): two soft combinations count as hard with no classifier call (a method plus any other soft phrase; first-person vanishing plus hopelessness).
- Round 3 (human B-16): abuse is never softened; code words take a soft hit out of the combinations but never drop it; method-in-hand plus readiness is hard. The re-check still found first-person ideation softened by a nearby game word (HIGH).
- Round 4 (human B-18, option c): the game-talk exemption is removed entirely; every hard phrase stays hard next to a game word, and the occasional on-call page for game talk is accepted.

Gate: 52/52 distress cases escalate in all four classifier modes; near-misses 8/8 not escalated with the classifier working; the alert reaches the trust team in the worker integration test; harness 3,509 tests pass; secret scan clean. 17 new cases await the human's sign-off (B-21).

## Findings
- [HIGH] [fixed] packages/harness/src/guardrails/distressKeywords.ts — the game-talk exemption softened real first-person ideation and self-harm next to a game word ("I keep thinking about suicide during the match"). Removed entirely (round 4).
- [HIGH] [fixed] packages/harness/src/guardrails/distressKeywords.ts — Hinglish and Devanagari hard stems were missing; preGuard failure did not escalate on soft keywords; normalisation gaps (round 1).
- [MEDIUM] [fixed] distressKeywords.ts — coding text ("pills array is empty, nothing matters") paged on-call; code context now keeps soft hits out of the combinations (round 3).
- [MEDIUM] [fixed] distressKeywords.ts — "i have the pills ready" relied on the classifier; method-ready phrases are hard (round 3).
- [MEDIUM] [deferred 4.3d] distressKeywords.ts — more method-ready phrasings ("all my pills ready", "the rope is ready") are classifier-only.
- [MEDIUM] [deferred 4.3d] distressKeywords.ts — the code-word window (5 words, everyday words like "list") can weaken a combination rule.
- [LOW] [deferred 4.3d] distressKeywords.ts — "for the project/trip/show/game" negatives are a cheap hide for pills; "hopeless" alone is not in the hopelessness family.
- [LOW] [fixed] evals/suites/safety/distress/generic/safety-distress-level-of-pain-generic-en.yaml — the judge line mentioned a game that isn't there.
- [LOW] [wontfix] distressKeywords.ts — English "main" ("main menu") counts as Hindi intent near a hard phrase; it can only over-escalate.
