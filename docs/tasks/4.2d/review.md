# Review: 4.2d — APPROVE
Reviewers: code-reviewer, security-reviewer

## Findings
- [MEDIUM] [deferred 4.2e] apps/worker/src/gate/agent.test.ts:254 — the new distress-with-attachment test doesn't assert `s.effects.lockedLeaks` stays 0, so nothing pins the split between leak counting and guard detection. Fix: add `expect(s.effects.lockedLeaks).toBe(0)`.

## Notes
- security-reviewer: APPROVE, no findings.
  - risk-paths.txt adds exactly the two paths, under the existing student-safety group, and merge_gate.py matches both.
  - The eval data is synthetic: the base64 decodes to "hello synthetic payload", and no helpline number is invented.
  - `isGuardDetection` matches only `ScrubFailedError` with the closed cause `'attachment'`.
- code-reviewer: APPROVE.
  - The 153-line agent.test.ts diff is mostly prettier reformatting. No existing assertion was changed.
  - Attachments are forwarded only when present, and the schema caps them at 2, with a test.
- safety-reviewer is waived per PR until 13.3 (MVP-first, 20 Oct 2026). The lead logs risk: high.
