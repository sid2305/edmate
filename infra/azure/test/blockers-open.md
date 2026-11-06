# Fixture blockers.md for the dry-run tests in .claude/tests/ -- obviously-fake, never the real
# file (infra/azure/test/ is excluded from .claude/tests/test_no_azure_identifiers.py; see that
# file's docstring and docs/tasks/0.25/plan.md "Tests first" item 3).
Local only (excluded from git; the repo is public).

## Open

### B-901 fake blocker, open
Fake entry text that must never leave this fixture file -- the watcher only ever posts a count.

### B-902 a second fake blocker, open
More fake entry text.

## Resolved

### B-900 an old fake blocker, already closed
