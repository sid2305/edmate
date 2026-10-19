# 3.7 safety review — APPROVE
Reviewer: safety-reviewer (opus), two passes: the build (ISSUES), then a7bb329 (APPROVE)

Checked and fine:
- only offered, named and entitled tools run;
- skill events from unentitled skills are dropped;
- `replace ''` is sent before every retry and error, including on cancel and on the runner-bug path;
- `locked` names only the student's own package;
- traces and logs carry no text and no key;
- the TeacherQuestion opens with scrubbed text only;
- billing comes from the entitlement.

The first pass's HIGH, tool output reaching the model with the answer key, is fixed with a shared normalised check. No tools ship before 5.5. All findings are in review.md.

For later tasks:
- 4.5 extends answerKey.ts (`\p{Cf}`, digit folding) and adds the lockedLeak check at the tool seam;
- 9.4's client drops text from turns without `done`.
