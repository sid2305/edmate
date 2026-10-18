# 0.4 review — APPROVE
Reviewers: architect (opus), security-reviewer (sonnet), typescript-reviewer (sonnet)

architect checked all four ADRs against the build plan, the decision log and the contracts: faithful, no new decisions. security-reviewer confirmed ADR-0003 matches `ports.ts`, `access.ts` and the TurnContext check, and the leak definition is verbatim. typescript-reviewer confirmed every code-level claim and ran the heading-check tests (10/10). The lead fixed the cheap wording findings in this PR, since ADR edits later need the same three reviewers. The "CLAUDE.md differs" note from typescript-reviewer was a stale copy in its context; main's CLAUDE.md already has the lead-approved rule.

## Findings
- [LOW] [fixed] docs/adr/0003-access-filter-by-construction.md:27 — did not say locked text never reaches logs or traces. Added, citing the trace contract.
- [LOW] [fixed] docs/adr/0001-tech-stack.md:19 — "as written" left out the table's Notes. Now says it is a summary of the full table.
- [LOW] [fixed] docs/adr/0003-access-filter-by-construction.md:36 — the "No probe" alternative had no source. Cites the 17 Oct 2026 build plan review.
- [LOW] [fixed] docs/adr/0003-access-filter-by-construction.md:23 — added the two 0.3 contract checks that back points 1 and 2.
- [LOW] [wontfix] docs/adr/check-headings.py:16 — duplicate headings are not flagged. See decision log 18 Oct 2026.
