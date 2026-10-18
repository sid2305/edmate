# 0.5 + 0.8 handoff

Status: DONE
Branch: `m0/0.5-ci`
Worktree: `.claude/worktrees/agent-a69ef7e35dd0f6614` (under the main checkout)
Built by: tdd-guide

## Acceptance evidence

| Item | Command → trimmed output |
|---|---|
| Harness tests (incl. 17 new labeller + 14 workflow/template tests) | `python3 -m unittest discover -v .claude/tests` → `Ran 98 tests ... OK` |
| Root gates | `corepack pnpm turbo run build typecheck lint test` → `Tasks: 38 successful, 38 total` |
| Secret scan | `python3 .githooks/secret-scan.py --all` → no output, exit 0 |
| ADR checks (now in CI) | `python3 -m unittest discover -s docs/adr -p 'test_*.py'` → `OK`; `python3 docs/adr/check-headings.py` → exit 0 |
| YAML parses, pins, permissions | `test_workflows.py`: every `uses:` is `@<40-hex> # vN`, explicit minimal top-level `permissions`, no job-level widening, no `pull_request_target`, `persist-credentials: false`, gate and labeller check out `ref: main` and only `git fetch` the PR head, no attacker-controlled field inlined in `run:` |
| Risk labeller matches risk-paths.txt | `python3 .claude/skills/merge-gate/risk_labels.py m0/0.5-ci` → `needs:security-reviewer`, `risk:touched` (this branch touches only the `.claude/**`/`.github/**` group) |
| Gate fails a risky PR missing reviewers / decision | `python3 .claude/skills/merge-gate/merge_gate.py 0.5` before review.md/handoff existed → `FAIL ... review.md Reviewers: is missing security-reviewer`, `FAIL risky change: handoff ## Decisions needs a '### ... risk: high' entry`, exit 1. CI's `Merge gate / check` runs the same script on the PR. |
| 0.8: neither skill describes a local squash | `grep -n "merge --squash" .claude/skills/merge-gate/SKILL.md .claude/skills/team-lead/SKILL.md` → no match; team-lead step 7 is "Merge (PR only)". |

**Still to show on the live PR (needs the lead's PR, CI cannot run before one exists):**
1. *CI blocks a failing test:* push a throwaway commit with a failing `.claude/tests` case, paste the red `CI / python-harness`, then revert it.
2. *Merge-gate check:* the first run of `Merge gate / check` on this PR, before review.md lands, should be red with the same FAILs as above; after review.md (with `security-reviewer`) lands, it should turn green.
3. *Labels / template:* the PR should get `needs:security-reviewer` and `risk:touched`; the body is pre-filled from `.github/pull_request_template.md` when the PR is created in the web UI or with `gh pr create` without `--body`.

Caveats:
- GitHub takes a `pull_request` workflow's *file* from the PR, but its steps check out `main` and run main's scripts. On this first PR main has no `risk_labels.py` yet, so `Risk labels / label` will fail ("No such file") until 0.5 is merged; `merge_gate.py` is already on main, so `Merge gate / check` works now.
- Because the workflow file itself comes from the PR, a PR that edits `merge-gate.yml` could change what that check runs. Such a PR touches `.github/**`, so the gate (run by the lead and by the bash hook at merge time) still requires `security-reviewer` and a `risk: high` decision; reviewers of any `.github/workflows/` change must check this.

## Branch protection (lead applies after merge, once each check has run once)

```bash
gh api --method PUT repos/sid2305/edmate/branches/main/protection --input - <<'JSON'
{"required_status_checks":{"strict":false,"contexts":["node","python-harness","check"]},
 "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,
 "allow_force_pushes":false,"allow_deletions":false}
JSON
```

Check names: the PR page shows them as `CI / node`, `CI / python-harness`, `Merge gate / check` (the plan's names), but the context string branch protection matches is the check run's name, which for Actions is the **job name** (`node`, `python-harness`, `check`). Confirm with `gh pr checks <n>` on this PR before applying; if a check stays "expected, waiting", the context string is wrong. Also confirm Settings → Actions → "Require approval for first-time contributors" is on (plan question 5).

## Changes

- `.github/workflows/ci.yml`: jobs `node` (setup-node from `.nvmrc`, `corepack pnpm install --frozen-lockfile`, `turbo run build typecheck lint test`) and `python-harness` (PyYAML, `.claude/tests`, ADR tests + `check-headings.py`, secret scan). On `pull_request` and push to `main`; `contents: read`.
- `.github/workflows/merge-gate.yml`: job `check`; checks out `main` (full history), fetches `refs/pull/<n>/head` into `refs/heads/<head ref>`, runs `merge_gate.py --pr <n>` with `GH_TOKEN`/`GH_REPO`. `contents: read, pull-requests: read`.
- `.github/workflows/risk-label.yml`: same main-checkout pattern; creates missing labels from `risk_labels.py --vocabulary`, adds wanted, removes stale ones via the REST API. Skipped on fork PRs (read-only token).
- `.claude/skills/merge-gate/risk_labels.py`: imports `merge_gate`'s `risk_groups`, `matches`, `changed_paths`, `MIGRATION_FILE`, `DESTRUCTIVE_SQL`, `MIGRATION_REVIEWERS`; no second glob list.
- `.github/pull_request_template.md`: Task, Plan, Handoff, Evidence, Risky paths touched, Reviewers.
- `.claude/tests/test_risk_labels.py`, `.claude/tests/test_workflows.py`; `helpers.py` copies `risk_labels.py` into temp repos.
- 0.8: `merge-gate/SKILL.md` (step 6 and intro: PR only; Limits: CI now re-runs main's gate), `team-lead/SKILL.md` step 7 PR only.
- `docs/edmate-harness-build-plan.md` 0.5 entry now matches the board (no human label). `docs/architecture.html` §13 table and layout updated (no "once 0.5 lands"; labels are `needs:<reviewer>`, not `needs-human`).

## Deviations

- No pnpm cache in `setup-node` (`package-manager-cache: false`): its cache step needs pnpm on PATH before corepack can provide it; installs take a few extra seconds. Plan wanted `cache: pnpm`.
- Node version comes from `.nvmrc` (22) rather than a hard-coded `22.x`, so CI follows the repo pin.
- ADR checks wired into CI: `docs/adr/check-headings.py` exists on main (0.4 merged), per lead answer.
- Labels are synced through `gh api` REST calls instead of `gh pr edit`/`gh label create`, which need broader token scopes.
- Labeller also tests `--vocabulary` and fails closed (exit 1) on a glob with no reviewers line, like the gate.
- Pinned to the current majors: checkout v7.0.1, setup-node v7.1.0, setup-python v7.0.0.

## Decisions

### 18 Oct 2026 · 0.5 CI reads scripts from main, not the PR · decided by planner · risk: high
Decided: `merge-gate.yml` and `risk-label.yml` check out `main` and only `git fetch` the PR's head commit into a same-named branch; they run main's `merge_gate.py`/`risk_labels.py`, never code from the PR.
Why: Running the PR's own copy of the gate would let a careless or malicious PR switch off its own check.
Alternatives: Check out the PR head (simpler, but that hole); `pull_request_target` (more ceremony and a riskier token, no gain).
Reversible: Yes.

### 18 Oct 2026 · 0.5 Risk labels are informational only · decided by planner · risk: high
Decided: The labeller adds `needs:<reviewer>` and `risk:touched` labels for visibility; no gate reads PR labels, and no `human-approved` label is created or checked anywhere.
Why: The lead decides every merge (human decision, 18 Oct 2026); a label gate would bring back the removed human-approval step.
Alternatives: Gate on a label, as 0.5 was first written; already rejected by the human.
Reversible: Yes.

### 18 Oct 2026 · 0.5 Workflow hardening choices · decided by tdd-guide · risk: medium
Decided: Actions pinned by full commit SHA with a version comment, minimal top-level permissions, `persist-credentials: false`, PR branch names passed through `env:` rather than inlined in shell, and the labeller skipped on fork PRs. A test file enforces all of these.
Why: Stops tag-swap supply-chain attacks, script injection through a crafted branch name, and token reuse by later steps.
Alternatives: Tag pins like `@v7` (drift silently); `actions/labeler` with its own glob list (would duplicate risk-paths.txt).
Reversible: Yes.

### 18 Oct 2026 · 0.5 No pnpm cache in CI for now · decided by tdd-guide · risk: low
Decided: `setup-node` runs without its pnpm cache; pnpm comes from corepack at install time.
Why: The cache step needs pnpm on PATH before corepack provides it; getting the order wrong breaks the job, and installs take only seconds.
Alternatives: `cache: pnpm` after a separate corepack step; `actions/cache` on the pnpm store.
Reversible: Yes.
