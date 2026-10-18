<!-- One task, one branch (m<milestone>/<task-id>-<slug>), one PR. The merge gate check reads
     docs/tasks/<id>/review.md and handoff.md on this branch, not this description. -->

## Task

<!-- Board id and title from docs/board/tasks.yaml, e.g. "0.5 GitHub Actions: CI ..." -->

## Plan

<!-- docs/tasks/<id>/plan.md -->

## Handoff

<!-- docs/tasks/<id>/handoff.md (status, deviations, and its ## Decisions) -->

## Evidence

<!-- The acceptance table from the handoff: each acceptance item -> command -> trimmed output. -->

## Risky paths touched

<!-- Paths matching .claude/skills/merge-gate/risk-paths.txt and their group, or
     "None (checked against risk-paths.txt)". A risky PR needs a `risk: high` decision in the handoff. -->

## Reviewers

<!-- Copy of review.md's `Reviewers:` line; it must name every reviewer each risky group requires. -->
