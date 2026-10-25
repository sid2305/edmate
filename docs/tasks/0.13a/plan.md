# 0.13a plan: agent-system follow-ups (lead-written)

Status: READY

## Goal
Close the two LOW findings left from the 0.13 and 0.11 reviews.

1. `.github/scripts/docs_only.py` gets a test and a docstring line covering a non-`.md` file under `docs/`, for example `docs/system-design.html`.
   - Behaviour stays as it is: **any path under `docs/` is docs-only**, whatever its extension.
   - Reason: `docs/` holds no code that the `node` job builds, types or tests. `docs/board/tasks.yaml` and the HTML explainers are read by people and by the python scripts, and the `python-harness` job is not skipped by this condition.
2. `.claude/agents/safety-reviewer.md` line 13 currently ends "the team lead saves it as `safety-review.md`". Reword it to say what that file does: the lead turns the reviewer's findings into `docs/tasks/<id>/safety-review.md`, and the merge gate reads that file. The reviewer itself still never writes files.

## Files (all risky: `.claude/**` and `.github/**`, reviewer: security-reviewer)
- `.github/scripts/docs_only.py`: docstring only. No logic change.
- `.claude/tests/test_workflows.py`: in `test_docs_only_classifier_matches_docs_and_rejects_code`, or a new test next to it:
  - `docs/system-design.html` is docs-only;
  - `docs/board/tasks.yaml` is docs-only;
  - `apps/web/docs/x.md` is not, because the path does not start with `docs/`;
  - a mix of `docs/system-design.html` and `apps/web/app/page.tsx` is not.
- `.claude/agents/safety-reviewer.md`: line 13 wording only.

## Gate
- `python3 -m unittest discover -s .claude/tests` (the python-harness tests) passes.
- `python3 .githooks/secret-scan.py --all` is clean.

## Reviewers
code-reviewer and security-reviewer. Run security-reviewer because the change touches `.claude/` and `.github/`.
