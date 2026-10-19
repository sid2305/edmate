# 4.7 safety review — APPROVE
Reviewer: safety-reviewer (opus): a plan review before the build; the build (1 HIGH, 4 MEDIUM, 4 LOW); a re-review of fix round 1 (APPROVE)

Every teaching and ask_teacher reply is judged against the retrieved material by a small-tier call with fenced data blocks and a strict 200-character `{grounded}` verdict. Answer-key chunks never reach the judge, and the number fix never writes the key. Every judge or chain failure fails closed. Fixed texts can't be imitated by the student or the model.

Fixed in round 1:
- Rule C no longer confirms a wrong answer;
- a judge outage no longer tells students "not covered" or pages teachers;
- claims planted in the student's message need support from the material;
- the escalation count survives every path.

Residual, accepted by the lead for the 13+ Python pilot:
- on well-covered turns an ungrounded sentence can be on screen for seconds before it is replaced. Locked text, answer keys and distress are checked before streaming, so only general-knowledge text can show. The web client must mark streamed text as provisional (9.4), and regulated-subject agents must hold every turn (4.8).

Five new grounding cases are pending the human's sign-off. The leftover Rule C praise forms and the LOWs are tracked in 4.7b.
