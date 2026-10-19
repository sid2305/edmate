# 3.11a review — APPROVE
Reviewers: safety-reviewer (sonnet), security-reviewer (sonnet)
Note: the merge gate reads task 3.11 for branch m3/3.11a-… (it drops letter suffixes), so 3.11a's handoff and review are copied here; 3.11b extends them.

security-reviewer confirmed:
- the risk-paths edit only adds personaTemplates.ts to the safety group, and the merge gate still parses it (122 harness tests pass);
- YAML loads with FAILSAFE;
- no directory traversal is possible from ids;
- the fixtures are synthetic.

safety-reviewer confirmed that the snapshots cover a persona dropping on distress, locked replies (name_package and generic) and the investing disclaimer fallback, and that the no-fixture test scans the directories 3.11b will fill. No real prose ships here.

## Findings
- [MEDIUM] [deferred 3.11b] packages/content/src/personaTemplates.ts:24 — style, mustNot and name have no size caps, and name isn't checked to be a role name (not "teacher" or "human"). Add caps and a name guard in the loader.
- [LOW] [deferred 3.11b] packages/content/src/personaTemplates.ts:42 — `reviewed_by: pending` validates. Reject pending when loading for real pack use.


## 3.11b (PR #44) — APPROVE (safety); human sign-off pending
Reviewer: safety-reviewer (opus), prose and re-verification. See safety-review.md for the findings. Content tests 159/159; 23 composed-prompt snapshots regenerated.
