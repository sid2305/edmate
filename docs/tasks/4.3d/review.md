# Review: 4.3d — APPROVE

Reviewers: code-reviewer

## Findings
- [HIGH] [fixed] distressKeywords.ts, the new verb-less "ready" hard rule used every method item with no "for the experiment" lookahead, so "my rope is ready for the experiment", "my blade is ready for the practical" and "my razor is ready for the demo" escalated hard. Fix round 1 split it into the exempt (rope/blade/razor, with the lookahead) and non-exempt (pills/tablets/noose/poison) halves, with 8 new tests; the lead checked the diff.
- [MEDIUM] [wontfix] distressKeywords.ts CODE list: dropping the everyday words means "my blade object has no methods left, nothing matters" now escalates hard. The board asked for this trade; see the lead decision "4.3d code-word list over-escalation accepted".

## Notes
- No pre-existing assertion was weakened; the test diff only adds cases. distressEscalate.test.ts escalates 80/80 across the four classifier modes, and near-miss counts are unchanged.
- No backtracking risk: gaps are bounded, no nested quantifiers.
- The six new cases were signed by the lead (`reviewed_by: lead`) under the 20 Oct 2026 rule.
- Safety-reviewer did not run (pre-pilot MVP-first rule); 13.3 runs one whole-system safety review before the pilot.
