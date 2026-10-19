# 4.6 safety review — APPROVE
Reviewer: safety-reviewer (opus): a plan review (1 CRITICAL, 5 HIGH, fixed in the plan); the build (MEDIUM and LOW only)

Locked text is caught verbatim (8+ tokens) per sentence while streaming and on the full reply, and the whole reply is replaced. It runs before answerLeak, so no rewriter ever sees locked text. A student's own pasted text is excluded only by its own 8-token windows. Every call site fails closed.

Residual, by design and tracked in 4.6b:
- a short (under 8 tokens) locked phrase can flash before the replace;
- a fill-in-the-blank prompt can learn a few bits per turn from where the stream stops;
- formatting tricks (HTML, homoglyphs) are known misses.

The real index adapter must meet ADR-0007 (task 5.3).
