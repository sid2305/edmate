Status: DONE

## What changed

Reworded the header comment of `content/locales/US.yaml` (and the inline comment on
`parentalConsentRequired`, line 19) for the now-signed pack. No value, key or other line changed.

**Old header (lines 1-7):**

```
# The United States locale pack (task 1.7 Phase B): a DRAFT. Every "pending" value below waits for
# a person to check it. Board decision `min-age` (18 Oct 2026): learners are 13+, and US learners
# need no parental consent. That waiver (parentalConsentRequired: false) does NOT apply until a
# named person signs this pack's compliance block (reviewedBy): until then US learners aged 13 to
# 17 need parental consent too, like every other market (the age rule fails closed).
# `edmate content validate content/locales` fails on purpose until a person signs off.
# Agents must never fill in a helpline number, contact, law or reviewer here: only a person may.
```

**New header:**

```
# The United States locale pack (task 1.7 Phase B): signed on 21 Oct 2026 (reviewedBy below).
# Board decision `min-age` (18 Oct 2026): learners are 13+, and US learners need no parental
# consent; because this pack's compliance block is now signed, that waiver
# (parentalConsentRequired: false) applies. The `privacyLaw`, `dataRegion` and `grievance` values
# below are still `pending`: they wait for a person to check them. If `reviewedBy` is ever cleared
# or set back to `pending`, the age rule (packages/content/src/agePolicy.ts) fails closed again and
# US learners aged 13 to 17 need parental consent too, like every other market, with no other
# change needed to this pack.
# Agents must never fill in a helpline number, contact, law or reviewer here: only a person may.
```

**Old inline comment (line 19):** `# applies only once reviewedBy is signed (see the header)`
**New inline comment:** `# applies: reviewedBy below is signed (see the header)`

Checked `packages/content/src/agePolicy.ts` (`complianceSigned`, `agePolicyFor`) before writing
the "if `reviewedBy` is cleared" claim: the age rule reads `pack.reviewedBy` fresh each call and
treats it as unsigned when undefined or `pending` (case/whitespace-insensitive); there is no
separate flag or cache to reset, so the new header's claim that no other change is needed is what
the code does.

## Evidence

- `python3 .githooks/secret-scan.py --all` — clean, no output, exit 0.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/content...` — ran 3 times. Every
  run: all content-package tasks (typecheck/lint/test for `@edmate/content` and its dependents)
  passed; the only failure across all 3 runs was `@edmate/harness#test`, on
  `src/pipeline/runner.test.ts` ("a soft hit never escalates through the raw-text check alone"),
  which timed out at 2000ms in 2 of 3 runs and is unrelated to this comment-only YAML change (no
  file this task touches is imported by that test). Final run: `Tasks: 13 successful, 14 total`,
  only `@edmate/harness#test` failed.
- `node apps/cli/dist/index.js content validate content/locales` — skipped: `apps/cli/dist/index.js`
  does not exist in this worktree (CLI not built).

## Decisions

### 22 Oct 2026 · Pre-existing flaky harness test is out of scope · decided by builder · risk: low
- Decided: treated the `@edmate/harness#test` timeout on `runner.test.ts` (unrelated 4.3
  distress-check test) as a pre-existing flaky failure, not a regression from this change, and did
  not attempt to fix it.
- Why: this task only edits YAML comments in `content/locales/US.yaml`; the failing test exercises
  the pipeline runner's distress/escalation logic, has no import path through the file this task
  touches, and failed with the same timeout across repeated runs regardless of this change.
- risk: low

Tool calls used: 21
