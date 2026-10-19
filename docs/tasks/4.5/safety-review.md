# 4.5 safety review — APPROVE
Reviewer: safety-reviewer (opus): a plan review (1 CRITICAL, 5 HIGH, fixed in the plan); the build (4 HIGH); re-verification of 2f4ad66 (APPROVE)

What students see now:
- every turn's stream is held a sentence at a time and checked for the answer in any form: digits, English, Hindi-Latin or Devanagari words, base64, arithmetic, decimals, zero-width tricks, split across chunks or tool rounds;
- a caught leak gets one checked rewrite, else a fixed English hint;
- no probe got a leak onto the screen.

Still open:
- paraphrase and confirming a guess without quoting it (judge, 4.5b);
- Hinglish filler false positives for one-digit keys (4.5c);
- `CommitRecord.escalatedText` must stay out of model history and teacher views (4.5c).

Findings are in review.md.

## 4.5c — APPROVE
Hinglish filler ("ek baar try karo") no longer trips one-digit keys, while real counts ("teen baar chalega", in either word order) still do. Picking between two code lines the student offered is caught, even with comments. Percent and fraction forms count only in an answer context. Escalation text never reaches later turns (an end-to-end test).
