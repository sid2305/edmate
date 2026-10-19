# 4.1 safety review — APPROVE
Reviewer: safety-reviewer (opus), two passes: 8f3b92b (ISSUES), then 8f315b7 (APPROVE)

Framework only. No pipeline step is wired yet, and the scrub, preGuard and postGuard stubs still fail closed, so student-facing safety behaviour is unchanged.

What was checked:
- Every failure path (throw, invalid result, timeout, cancel, unknown, wrong-phase, out-of-order, duplicate, empty list) ends non-ok, as `failed` or `block`, and never as `ok`.
- GUARD_ORDER matches the build plan's guard table.
- The trace and the outcome event carry no reason or student text.
- A rewrite is re-checked by every guard. An escalate on the second pass still escalates, so the alert isn't dropped (the runner already lets escalate beat block).

The first pass's HIGH, a later rewrite not being re-checked, is fixed. All findings are in review.md.

For the guard tasks:
- 4.2 onward: each rewriting guard must return ok on its own output.
- 4.3 and 4.5: save the escalate text but always reply with the caring template.
- 4.3: a chain `failed` must not suppress the distress keyword fallback.
