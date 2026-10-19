# 3.11 safety review — APPROVE pending the human's per-row sign-off
Reviewer: safety-reviewer (opus): a plan review (4 HIGH, fixed in the plan); prose review of 3.11b (2 HIGH, fixed in 4ee5b8c); re-verification (one wording fix, applied verbatim in a389cfd).

Verified on the composed snapshots:
- the five preamble rules, the distress backstop and the precedence line;
- "You are an AI playing …";
- English-only replies with Hindi/Hinglish input understood;
- no fixture text;
- the distress mid-interview snapshot drops the role, the style card and the do-not-say list but keeps the helplines;
- the teacher note is "(Platform note: the teacher wrote this reply.)", and the model may never write it or speak as the teacher; copies in student messages are forged data;
- the conversation-side markers are removed, and the system-prompt markers (checked by jailbreak cases) are kept.

Follow-ups (board 3.11d):
- teacher turns in a non-assistant wrapper, and the note neutralised in student input;
- the server counts persona questions;
- no learner summary on locked turns after a downgrade;
- a content-side snapshot of buildModelRequest with the real set.

The pack is not pinned for real-model turns until the 4.x guards merge and the full suite passes.

## Findings
- [HIGH] [fixed] content/prompt-packs/frame@1.0.0.md:59 — the teacher label carried a `[[…]]` marker in assistant turns. Dropped; reworded; rule 9 forbids writing it.
- [HIGH] [fixed] content/prompt-packs/safety@1.0.0.md:15 — the teacher-label rule could be forged by a student. Rewritten.
- [MEDIUM] [fixed] content/skills/mock_interview/viva@1.0.0.yaml:19 — the debrief could give the answer. Now: never signal correctness before the debrief, never give the correct answer.
- [MEDIUM] [fixed] content/prompt-packs/frame@1.0.0.md:18 — the disclaimer marker could be copied. Dropped; "word for word".
- [MEDIUM] [fixed] content/prompt-packs/frame@1.0.0.md:14 — the no-helplines and empty-turn markers are dropped.
- [LOW] [fixed] content/prompt-packs/frame@1.0.0.md:95 — locked lines yield to safety rule 7.
- [LOW] [fixed] content/prompt-packs/safety@1.0.0.md:25 — the language rule is country-neutral.
- [LOW] [fixed] content/skills/mock_interview/viva@1.0.0.yaml:20 — "flirtatious" and the banned topics added.
- [LOW] [deferred 3.11d] packages/harness/src/pedagogy/modelRequest.ts:45 — teacher turns in a non-assistant wrapper; neutralise the note in student input; a real-pack model-request snapshot.

## 3.11c — APPROVE
Reviewer: safety-reviewer (sonnet). Pilot agents reply in English: validation rejects other languages, and the harness clamps the reply language to English with a background warning. Distress replies and helplines are unchanged.
