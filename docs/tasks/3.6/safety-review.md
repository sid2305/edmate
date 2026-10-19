# 3.6 safety review (safety-reviewer, opus)

Written by the team lead from safety-reviewer's two reports (18 Oct 2026). Merged by the lead under the human's standing decision that the lead approves every merge, child safety included; safety-reviewer's "human approval required" line reflects its agent file, which predates that decision.

## Checked and passing
- Locked chunk text never reaches the composed request in any move (canary tests).
- Distress turns use distress wording and the locale's helplines, and still work with the default pack that has no helplines.
- Per-move maxOutputTokens are respected.
- Persona, chunk text, style card and learner summary are fenced against delimiter forgery.

## Findings and outcome
- HIGH — the do-not-say list (with the answer key) was added on every move, so a student could go off-topic and ask the model to repeat its instructions. Fixed at 3f2ef24: only teaching/skill packs carry it; every closed mode is tested to contain no answer-key content. Re-verified.
- MEDIUM — distress turns said "Move redirect" and listed skills. Fixed: distress has its own decision line. Re-verified.
- MEDIUM — the request cache key covers neither help state nor learner summary. Fixed: documented as a provider caching hint only, never an app-level response cache key. Re-verified.
- LOW — fake `[n]` citations inside chunk text: grounding (4.7) must reject citation numbers above n.
- LOW — CommitRecord `next`/`decision` hold the answer key: commit (3.8) must never write systemPrompt, mustNotReveal or next to a transcript.

## Q4 verdict (answer key in the prompt)
Keep it, on teaching moves only. A hash can't let the model check a student's answer, and a paraphrase still gives it away. The real protection is the answerLeak post-guard (4.5): no real-model turn runs before 4.5 is merged and tested ("24,000", "24 hazaar", Devanagari digits, translation, base64, role-play). Task 3.9 now depends on 4.5.
