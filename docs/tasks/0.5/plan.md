# Task 0.5 + 0.8: CI, secret scan, merge-gate check, risk labeller, PR template; remove the local squash-merge path

Board: `python3 .claude/skills/board/board.py show 0.5` and `show 0.8` · Milestone M0 · deps: 0.1 (done, 0.5), 0.7 (done, 0.8) · branch: `m0/0.5-ci` (one branch, one PR for both tasks: 0.8 is a 6-line doc follow-up from 0.7's review, too small for its own branch).

**Risky.** Every new/changed path is `.github/**` or `.claude/skills/*/SKILL.md`, both under the `.claude/**`/`.github/**` risk group. Reviewers: `security-reviewer` (required), plus the standard `code-reviewer`, `typescript-reviewer`. A `risk: high` decision is required in the handoff.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

**0.5** — Title: "GitHub Actions: CI, secret scan, merge-gate check (re-runs merge_gate.py --pr on every PR: required reviewers per risk group and a risk: high decision; no human label), risk labeller; PR template."
Accept: "CI blocks a failing test; the merge-gate check fails a risky PR whose review.md lacks the required reviewers or whose handoff lacks a risk: high decision."

**0.8** — Title: "Follow-up from 0.7 review: remove the local `git merge --squash` path from the merge-gate and team-lead skills (merges go through a PR and the gate); small doc fixes found in later reviews."
Accept: "Neither skill describes a local squash merge; the team-lead merge step is PR-only."

0.8's only identified source is `docs/tasks/0.7/review.md`'s one deferred finding: `[MEDIUM] [deferred 0.8] .claude/skills/merge-gate/SKILL.md — the local git merge --squash path skips the gate; remove it from both skills.` No other review has pointed at 0.8 yet (grepped `docs/` for `0.8`). Scope is exactly that finding; "small doc fixes found in later reviews" has nothing further to fold in right now (open question below).

### How each item is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| CI blocks a failing test | A throwaway commit on the branch with a failing `.claude/tests` case (or a deliberately broken `turbo run test`), screenshot/paste of the red check, then revert. |
| Merge-gate check fails a risky PR missing reviewers/decision | Open this very PR before `review.md`/`handoff.md` exist (or with `Reviewers:` missing `security-reviewer`): paste the failed "Merge gate" check's log. Then add them and show it turn green. |
| Risk labeller | Paste the PR's label list after the workflow runs (e.g. `needs:security-reviewer`), and confirm `risk_labels.py`'s output matches `risk-paths.txt` groups touched. |
| PR template | Screenshot or paste of the PR body auto-filled from `.github/pull_request_template.md`. |
| Neither skill describes local squash (0.8) | Diff of both `SKILL.md` files: the `git merge --squash` bullets removed, step 7 reads PR-only. |
| Tests pass | `python3 -m unittest discover -v .claude/tests` output, plus `python3 .githooks/secret-scan.py --all` on the new files. |

## Design

### 1. `.github/workflows/ci.yml` — triggers: `pull_request`, `push` (branches: `main`)
Two independent jobs (fast, parallel feedback), `permissions: contents: read` at the top level:

- **`node`**: `actions/checkout@<sha>` (pin; fetch-depth 1 is enough, no branch diffing needed here) → `corepack enable` → `actions/setup-node@<sha>` with `node-version: 22.x` and `cache: pnpm` (corepack's pnpm shim must be on PATH first, so `corepack enable` runs before `setup-node`'s cache step resolves the lockfile) → `pnpm install --frozen-lockfile` → `corepack pnpm turbo run build typecheck lint test`.
- **`python-harness`**: `actions/checkout@<sha>` (fetch-depth 1) → `actions/setup-python@<sha>` (3.x) → `pip install pyyaml` (the board tests need it; `git` and `jq` are preinstalled on `ubuntu-latest`) → `python3 -m unittest discover -v .claude/tests` → `python3 .githooks/secret-scan.py --all`.

Both jobs run on every PR and on push to `main` (covers the direct board/decisions-log commits the lead makes). No secrets are read; safe to run on fork PRs too, though GitHub's default "require approval for first-time contributors" setting should stay on (repo setting, not a workflow change — flagged under Open questions).

### 2. `.github/workflows/merge-gate.yml` — triggers: `pull_request` (`opened, synchronize, reopened, edited`)
`permissions: contents: read, pull-requests: read`. **Checks out `main`, not the PR branch**, then fetches the PR's head commit into a same-named local ref without touching the working tree:

```
actions/checkout@<sha>            # default ref = main, fetch-depth: 0 (merge_gate.py diffs against main)
run: git fetch origin "+refs/pull/${{ github.event.pull_request.number }}/head:${{ github.event.pull_request.head.ref }}"
run: GH_TOKEN=${{ github.token }} python3 .claude/skills/merge-gate/merge_gate.py --pr ${{ github.event.pull_request.number }}
```

Running `merge_gate.py` from `main`'s checked-out copy (never the PR branch's copy) means a PR cannot neutralise its own gate check by editing `merge_gate.py` — the script that runs is always the trusted, already-reviewed one on `main`. The PR's files are only ever read with `git show <branch>:<path>` (a plumbing read, not an execution), which is all the script already does. This is a deliberate hardening beyond what a plain `actions/checkout@ ref: head` would give.

**Expected to fail early and often:** `handoff.md`/`review.md` don't exist until the lead writes them near the end of the task (team-lead SKILL §3 step 4, just before step 6's gate run), so this check is red for most of a PR's life — same as running `merge_gate.py` locally today. That's correct, not a bug; see "Required checks" below.

### 3. Risk labeller — `.github/workflows/risk-label.yml`, `.claude/skills/merge-gate/risk_labels.py`
Single source of truth: `risk-paths.txt`, read through `merge_gate.py`'s own `risk_groups()`/`matches()`/`changed_paths()`/migration-detection — **no second glob list** (rejects `actions/labeler` + a parallel `labeler.yml`, which would duplicate `risk-paths.txt`'s globs and drift from it).

`risk_labels.py <task-or-branch>` (new module in the same folder, imports from `merge_gate`):
1. Computes the changed paths against `main` (reusing `changed_paths`).
2. For each touched risk group, collects its required reviewers (reusing `risk_groups`/`matches`), plus `database-reviewer` if a migration drops/deletes data (reusing the existing `MIGRATION_FILE`/`DESTRUCTIVE_SQL` check).
3. Prints one label per distinct reviewer as `needs:<reviewer>` (e.g. `needs:security-reviewer`, `needs:safety-reviewer`, `needs:architect`), plus `risk:touched` if the set is non-empty. Fixed, finite vocabulary (5 reviewer names in `risk-paths.txt` today), so labels can be pre-created once.

Workflow (triggers: `pull_request`, same safe main-checkout + `git fetch` trick as the gate job; `permissions: contents: read, issues: write, pull-requests: write` — label read/write is the Issues API even for PRs):
```
for l in needs:safety-reviewer needs:security-reviewer needs:architect needs:typescript-reviewer needs:database-reviewer risk:touched; do
  gh label create "$l" --color ... 2>/dev/null || true   # idempotent
done
want=$(python3 .claude/skills/merge-gate/risk_labels.py "$branch")
# add every label in $want, remove every label in the fixed vocabulary that is not in $want
```
Purely informational for the human/lead skimming the PR list — **the gate never reads PR labels** (confirmed: `merge_gate.py`'s `--pr` mode makes no label check; the stub `gh` in `test_merge_gate.py` even comments "labels ... which the gate ignores"). No `human-approved` label is created, read or referenced anywhere in any of the three workflows or the labeller's fixed vocabulary.

### 4. `.github/pull_request_template.md`
Sections: **Task** (`docs/board/tasks.yaml` id, one line), **Plan** (link to `docs/tasks/<id>/plan.md`), **Handoff** (link to `docs/tasks/<id>/handoff.md`, with its `## Decisions`), **Evidence** (the acceptance-criteria table, pasted from handoff), **Risky paths touched** (list, or "None (checked against risk-paths.txt)"), **Reviewers** (copy of `review.md`'s `Reviewers:` line). No checkbox for a `human-approved` label.

### 5. 0.8 — doc-only, same branch
- `.claude/skills/merge-gate/SKILL.md` checklist item 6: delete "or before GitHub, `git merge --squash` on `main`"; it now reads "exit 0 → merge (`gh pr merge <n> --squash`; the bash hook re-runs the gate)." Also update the "## Limits" line ("Until CI (0.5) re-runs the gate on GitHub...") to say CI now re-runs it on every PR (keep the sentence after it — the gate still can't judge whether reviews were *good*, only mechanical shape).
- `.claude/skills/team-lead/SKILL.md` §3 step 7: delete the "Without a PR: `git merge --squash`..." bullet; step 7 becomes PR-only (push, `gh pr create`, `gh pr merge <n> --squash`).
- No hook change: `guard-bash.sh` never specifically allowed or blocked a bare `git merge --squash` into `main` (it only intercepts `gh pr merge` and pushes); removing the skills' text does not by itself stop an agent from typing `git merge --squash` locally. That technical gap is real and flagged under Open questions — it is out of scope for 0.8 (doc-only, per its title) and for 0.5 (no hook edits listed in the acceptance).

## Files

### Create
- `.github/workflows/ci.yml`, `.github/workflows/merge-gate.yml`, `.github/workflows/risk-label.yml`
- `.github/pull_request_template.md`
- `.claude/skills/merge-gate/risk_labels.py`
- `.claude/tests/test_risk_labels.py` (reuses `helpers.py`'s temp-repo builder)
- `.claude/tests/test_workflows.py` (static checks on the three workflow files; no `act`/Docker runner needed)
- `docs/tasks/0.5/handoff.md`, `docs/tasks/0.5/review.md`

### Modify
- `.claude/skills/merge-gate/SKILL.md` (0.8's removal + the "CI now runs this" line)
- `.claude/skills/team-lead/SKILL.md` (0.8's removal)
- `docs/edmate-harness-build-plan.md` line ~529 (0.5's entry: it still says "verifies the human-approved label"; stale since 0.7 — the spec edit asks the human, as usual)
- `docs/architecture.html` (merge-policy section: mention CI now re-runs the gate on GitHub, drop any remaining "once 0.5 lands" phrasing)

### Out of bounds
- `.claude/hooks/*`, `.claude/settings.json` — no hook change in either task (see 0.8 note above). Editing them triggers Claude Code's own self-modification guard regardless.
- `risk-paths.txt`'s globs/reviewer lists — reused, not changed.
- `.devcontainer/` (task 0.6).
- `packages/**`, `apps/**`.

## Tests first (stdlib `unittest`, reusing `.claude/tests/helpers.py`'s temp-git-repo builder)

1. **`test_risk_labels.py`**: a change touching only `packages/payments/x.ts` → `needs:security-reviewer`, `risk:touched`; only `content/prompt-packs/x.md` → `needs:safety-reviewer`; `.claude/hooks/x.sh` → `needs:security-reviewer` (the `.claude/**` group); `packages/contracts/x.ts` → all three of `needs:architect`, `needs:security-reviewer`, `needs:typescript-reviewer`; a non-risky file only → no labels, no `risk:touched`; a destructive migration SQL file → `needs:database-reviewer` added on top of any path-matched group.
2. **`test_workflows.py`** (no YAML execution, just `yaml.safe_load` + regex over the three new files): every `uses:` line is pinned to a 40-hex-char SHA (not a tag like `@v4`); no workflow references `human-approved`; `merge-gate.yml` and `risk-label.yml` checkout `main` by default (no `ref:` override on the first `actions/checkout` step) and contain the `git fetch origin "+refs/pull/.../head:..."` line; `ci.yml` runs `turbo run build typecheck lint test` and `unittest discover .claude/tests` and `secret-scan.py --all` somewhere in its steps.
3. Existing `test_merge_gate.py`'s `PrMode` cases are unaffected (no code change to `merge_gate.py` in this task — only a new sibling module).

Run `python3 -m unittest discover -v .claude/tests` and `python3 .githooks/secret-scan.py --all` (workflow YAML containing `${{ secrets.* }}`/`${{ github.token }}` should not trip the "hard-coded secret" pattern — verify once written; if it does, use `secret-scan: allow` with a reason rather than weakening the pattern).

## Risky paths touched
- `.github/**` (new: 3 workflows, PR template) → group `.claude/**`, `.github/**` → **reviewers: security-reviewer**.
- `.claude/skills/merge-gate/risk_labels.py`, `.claude/skills/merge-gate/SKILL.md`, `.claude/skills/team-lead/SKILL.md`, `.claude/tests/*` → same group → **security-reviewer**.
- No SAFETY prefix, no access/payments/migration path, no contracts/ADR path touched, so no `safety-review.md`, no extra reviewer beyond `security-reviewer` (+ the always-on `code-reviewer`, `typescript-reviewer`).

## Decisions (draft, to copy into handoff `## Decisions`)

### 18 Oct 2026 · 0.5 CI reads scripts from main, not the PR · decided by planner · risk: high
Decided: `merge-gate.yml` and `risk-label.yml` check out `main` and `git fetch` the PR's head commit into a same-named ref, rather than checking out the PR branch. They never execute code from the PR; they only run `main`'s trusted `merge_gate.py`/`risk_labels.py` against the PR's files via `git show`/`git diff`.
Why: Checking out the PR branch directly would run whatever version of `merge_gate.py` the PR itself contains, letting a malicious or careless PR disable its own gate check.
Alternatives: Checkout the PR head directly (simpler, but the vulnerability above); `pull_request_target` (same trust model, more ceremony for no extra benefit here since we never need the PR's working tree).
Reversible: Yes.

### 18 Oct 2026 · 0.5 Risk labels are informational only · decided by planner · risk: high
Decided: The risk labeller adds `needs:<reviewer>` labels for visibility; the gate (local or CI) never reads PR labels, and no `human-approved` label is created or checked anywhere.
Why: Matches the 18 Oct 2026 human decision that the lead decides every merge; a label gate would reintroduce the removed human-approval step by the back door.
Alternatives: Gate on a label as 0.7 (pre-scope-change) drafted; rejected by the human already.
Reversible: Yes.

## Open questions (none block the build; each has a recommendation)

1. **Branch protection and "agents push main for board/log commits."** GitHub's required-status-checks branch protection, if it also binds admins, can block the lead's routine direct pushes of `docs/board/`/`docs/decisions/` commits to `main` (no PR exists for those pushes to attach a passing check to). **Recommendation:** enable protection on `main` with required status checks (`CI / node`, `CI / python-harness`, `Merge gate / check`) and `enforce_admins: false`, so the repo owner (sid2305, running as themself) can still push `main` directly, while any other contributor must go through a PR with green checks. Exact call for the lead to run once the workflow names exist (first run after this PR merges):
   ```
   gh api --method PUT repos/sid2305/edmate/branches/main/protection --input - <<'JSON'
   {"required_status_checks":{"strict":false,"contexts":["CI / node","CI / python-harness","Merge gate / check"]},
    "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,
    "allow_force_pushes":false,"allow_deletions":false}
   JSON
   ```
   Verify empirically with one real board-commit push after enabling — GitHub's exact handling of direct non-admin pushes vs. PR-only has edge cases this plan can't fully confirm without the live repo.
2. **Making `merge-gate` a required check means PRs sit red most of their life** (until `review.md`/`handoff.md` land). Recommendation: require it anyway — it mirrors today's local gate exactly, and a green `merge-gate` check right before merge is the whole point. Require `CI`'s two jobs too (they should be green much earlier and stay green).
3. **0.8's "small doc fixes found in later reviews."** No second source found (checked `docs/decisions/log.md` and every `docs/tasks/*/review.md` for "0.8"; only 0.7's one deferred finding exists). Recommendation: ship exactly that finding; if a later review turns up more, file a fresh board task rather than reopening 0.8.
4. **No hook stops a bare local `git merge --squash` into `main`.** 0.8 only removes the *documentation* of that path, per its own title/accept line. Recommendation: leave as is for this task; if the lead wants it technically blocked too, that is a `.claude/hooks/guard-bash.sh` change needing its own small risky task (hook edits are out of bounds here).
5. **Fork PRs and secrets.** `ci.yml`'s jobs run `pnpm install`/build on whatever a PR contains; GitHub already strips/limits the token for fork PRs on `pull_request`, but first-time-contributor workflow approval should stay enabled (Settings → Actions → "Require approval for first-time contributors"). Recommendation: confirm that repo setting is on; no workflow change needed for it.

## Lead answers (18 Oct 2026) — override the sections above

1. Branch protection: as recommended (required checks `CI / node`, `CI / python-harness`, `Merge gate / check`; `enforce_admins: false` so the owner account, which the agents use, can still push board/log commits to main; no force-push, no deletion). The lead applies it after merge; the builder only documents the exact `gh api` call in the handoff.
2. Require the merge-gate check: yes.
3. 0.8: ship only the local-squash-merge removal from both skills.
4. No hook change (hooks are out of bounds; auto mode blocks agent edits to them).
5. Fork PRs: no workflow change; the lead confirms the repo setting.
- Also wire `docs/adr/check-headings.py` into CI only if it exists on main when you build (task 0.4 is in flight in parallel); otherwise skip it and note it in the handoff.
- Out of bounds: `.claude/hooks/*`, `.claude/settings.json`, docs/adr/** (task 0.4).
