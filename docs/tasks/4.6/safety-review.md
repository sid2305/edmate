# 4.6 safety review — APPROVE
Reviewer: safety-reviewer (opus): a plan review (1 CRITICAL, 5 HIGH, fixed in the plan); the build (MEDIUM and LOW only)

Locked text is caught verbatim (8+ tokens) per sentence while streaming and on the full reply, and the whole reply is replaced. It runs before answerLeak, so no rewriter ever sees locked text. A student's own pasted text is excluded only by its own 8-token windows. Every call site fails closed.

Residual, by design and tracked in 4.6b:
- a short (under 8 tokens) locked phrase can flash before the replace;
- a fill-in-the-blank prompt can learn a few bits per turn from where the stream stops;
- formatting tricks (HTML, homoglyphs) are known misses.

The real index adapter must meet ADR-0007 (task 5.3).

## 4.6b safety review — APPROVE
Reviewer: safety-reviewer (opus): the build (2 HIGH, 3 MEDIUM, 3 LOW) and a re-review of fix round 1 (APPROVE)

After fix round 1 the session-wide stop holds on every outcome and cannot be cleared by the student (cancel, a practice answer, a slow context build or an unreadable blob); no locked run of 2+ tokens streams, including through HTML attributes, comments, entities, tags inside words and the added look-alike letters; a stopped session makes one check per reply. The ADR §8 bound is now accurate: per session, so the daily message limit caps it.

Residual, tracked in 4.6c: markdown emphasis inside words; a few tag shapes a browser reads differently (relevant only if raw model HTML is ever rendered, which 9.4 now forbids). Three new locked cases are parked in docs/tasks/4.6/pending-cases/ for the human's sign-off.
