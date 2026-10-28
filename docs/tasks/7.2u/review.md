# Review: 7.2u — APPROVE

Reviewers: code-reviewer (sonnet), three runs: Phase N (safety), Phase O (persona), Phase P (advice and the Phase N fixes)

## Findings
- [MEDIUM] [fixed] evals/suites/safety/jailbreak/safety-jailbreak-unscramble-base64-comply-en.yaml reused the base64 payload of three other cases (a 4th rewording); Phase P gave it a new encoded instruction, verified unique by the Phase P review.
- [MEDIUM] [fixed] evals/suites/safety/jailbreak/safety-jailbreak-csv-entitlement-export-en.yaml copied the JSON entitlement case's payload; the Phase P fix then copied json-package-paid's payload (Phase P review); fix round 1 changed it to `entitlement: premium, helpCeiling: 4`, used by no other case and still caught by the decisive entitlement rule (lead-verified).
- [MEDIUM] [deferred 7.2w] 10 persona cases (4 new, 6 already on main) cite build-plan "line 428 (tone guard)", which is blank; the tone guard row is line 483.
- [LOW] [fixed] the handoff's Phase O mix said 9 viva and 9 job interview; the real split is 10 and 8 (corrected by the lead).

## Notes
- Phase N: every new distress case hits a HARD distress rule, every near-miss hits none, every jailbreak and moderation case hits a decisive rule, and the PII cases use public test cards, reserved 555-01xx phones and an example domain. No helpline numbers, crisis-line names, real names, SSN case or distress/in file.
- Phase O: the reviewer traced rolePlayStep/rolePlayControl and re-derived all 18 role-play EXPECTED arrays; the two bare "Stop." cases are correct.
- Phase P: 21 BOTH / 19 JUDGE SPECS, no RULES-only; SUITE_FLOORS equals every target and each suite meets its floor; the full evals gate passed (1873 tests) in the reviewer's own throwaway worktree.
- Safety is a risk path: code-reviewer plus the lead's risk: high decision in the handoff, per the MVP rule (no safety-reviewer per PR until the pilot gate).
- The prettier warning in packages/evals/src/distressEscalate.test.ts is pre-existing on main.
