# Plan: 0.26 — Foundry backup through the VM's managed identity (no key on disk)

Board: `board.py show 0.26` (M13, deps: `0.24` done, risk: risky).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "VM phase 2: Foundry backup through the VM's managed identity (no key on disk): role
assignment documented in docs/azure-vm.md, scripts/claude-backup.sh verified on Linux with the
Entra path (auth=entra when no Keychain), and a probe that lets the launcher switch back to the
subscription when the window reopens."

Accept: "on the VM, scripts/claude-backup.sh --foundry starts with /status showing Microsoft
Foundry and no ANTHROPIC_FOUNDRY_API_KEY set; the auto mode switches back to the subscription
after the window reopens; docs/backup-provider.md updated."

### How it will be shown (paste into handoff.md)
| Piece | Evidence |
|---|---|
| Role assignment documented | `docs/azure-vm.md` §3.4 already carries the human's one-time `az role assignment create ... "Cognitive Services User"` step (written ahead, during 0.24/0.25's docs); this task tidies it (drops the "optional, phase 2" hedge, cross-links `docs/backup-provider.md`) and updates the "Not done yet" line that currently names 0.26 as outstanding. |
| Linux/Entra path, no key on disk | `scripts/claude-backup.sh` gains `fetch_imds_token()` (same IMDS pattern as `infra/azure/lib/monitor-ingest.sh`, scoped to the Cognitive Services resource audience): on Linux, when neither config var nor Mac Keychain has a key, it fetches a short-lived token from the VM's managed identity and exports `ANTHROPIC_FOUNDRY_AUTH_TOKEN` (never `ANTHROPIC_FOUNDRY_API_KEY`). A new `.claude/tests/test_claude_backup.py`, with a fake `curl` and a fake `claude` on `PATH` (never a real Azure/Foundry/Anthropic call), proves: no key var is ever set in this path, the token value never appears in any log/stderr line, and the fetch is skipped entirely when a key/Keychain hit already exists. |
| Switch-back probe | `probe_subscription()`/`auto` mode already re-probes the subscription fresh on every invocation (stateless — no "last used Foundry" memory). New tests prove this directly: with a stub `claude` that reports the subscription healthy, `auto` mode starts on the subscription even when a fully configured `foundry.env` fixture is present, i.e. the moment the usage window reopens, the next start (the lead's own restart cadence — its own exit, a crash, or the VM's `Restart=always`) goes back to the subscription with no separate step. |
| Gate | `python3 -m unittest discover -v .claude/tests` green; `python3 .githooks/secret-scan.py --all` clean; `python3 .claude/skills/merge-gate/merge_gate.py 0.26` passes once `review.md`/`handoff.md` exist. |
| **Outstanding, human-only** | The literal accept line's real-VM check ("on the VM, `scripts/claude-backup.sh --foundry` starts with `/status` showing Microsoft Foundry and no `ANTHROPIC_FOUNDRY_API_KEY` set") is never run by the builder — see "Out of bounds" and Open question 1. The handoff must name it as outstanding, not done. |

## Read first
- `docs/backup-provider.md`, `scripts/claude-backup.sh`, `scripts/foundry.env.example` — current
  design and code (already read for this plan; the Mac Keychain branch and the three documented
  auth modes: `env`, `keychain`, `entra`).
- `docs/azure-vm.md` §3.4 (the already-written role-assignment step) and its "Known risks"/"Not
  done yet" sections (the latter names this task).
- `infra/azure/lib/monitor-ingest.sh` — the proven IMDS-token-fetch pattern to reuse exactly
  (fixed `169.254.169.254` link-local address, `curl -fsS --max-time 5 -H "Metadata: true" ... |
  jq -r '.access_token // empty'`, never print the token, every failure path returns gracefully).
- `.claude/tests/test_vm_heartbeat_and_alerts.py` and `.claude/tests/helpers.py` — the fake-binary-
  on-`PATH`, dispatch-on-arguments pattern (0.25b's fake `az` stub) this task's fake `curl`/`claude`
  stubs copy exactly; also the `*.fake` committed-fixture convention under `infra/azure/test/`.
- `.claude/tests/test_no_azure_identifiers.py` — scoped to `infra/azure/**` and `docs/azure-vm.md`
  only (confirmed by reading `scanned_files()`); `scripts/claude-backup.sh` and
  `docs/backup-provider.md` are **not** in its scan path, so the new `cognitiveservices.azure.com`
  audience string there needs no allow-list entry there (see Open question 2 on why that exact
  string was chosen).
- `docs/decisions/log.md` "22 Oct 2026 · Backup model provider" and "4 Nov 2026 · one always-on
  agent VM on Azure" entries — why the backup exists and why the VM exists; neither needs
  revisiting here.
- `docs/lessons.md` "A guard that can't run must fail closed, not open" and "A check that silently
  skips looks like a pass" — relevant to the IMDS-fetch failure path: a failed/absent token must
  not silently look like success; `say()` it.
- **The repo-wide no-real-cloud-call rule** (0.25's plan "Out of bounds" line, reused verbatim by
  0.25b and 10.1, and restated in this task's brief): no agent here may make a real `az`, Azure
  Entra/IMDS, or Foundry/Anthropic-model call. Azure IAM changes (the role assignment) are a
  human-only, real-VM step. Every test in this plan uses a fake `curl` and a fake `claude` binary
  on a prepended `PATH`, never the real ones.

## Design decisions resolved by this plan (no need to escalate)
1. **Why the Entra path needs new code at all.** `docs/backup-provider.md`'s reference line lists
   the Entra options as "`az login`, or `ANTHROPIC_FOUNDRY_AUTH_TOKEN`" — there is no mention of
   Claude Code auto-discovering a managed identity on its own, and `infra/azure/cloud-init.yaml`
   never installs the `az` CLI (confirmed by grep: no match for `azure-cli`/`az login` anywhere in
   it). So on the VM, neither of today's two Mac-only paths (Keychain, `az login`) can work; the
   script itself must fetch the token and hand it to Claude Code as `ANTHROPIC_FOUNDRY_AUTH_TOKEN`.
2. **Scope the new fetch to Linux only.** Gate the IMDS attempt behind `[ "$(uname -s)" = "Linux" ]`
   so the Mac path (Keychain or `az login`) is completely unchanged — no new 5-second timeout added
   to every Mac invocation that doesn't use the Keychain. This also matches the accept line's own
   wording ("verified on Linux with the Entra path").
3. **The switch-back probe is the existing stateless `auto` mode, not new infrastructure.** The
   accept line names "the auto mode" by name; `probe_subscription()` already runs fresh on every
   `claude-backup.sh` invocation with zero memory of the previous provider. Combined with the VM's
   existing restart cadence (`edmate-lead.service`'s `Restart=always`, `docs/azure-vm.md` §4: "After
   every restart (a closed usage window, a crash, a reboot) ... the launcher decides at each start"),
   this already satisfies "switches back ... when the window reopens" without a new systemd timer.
   This plan adds **tests** proving the statelessness, not a new always-on watcher. A proactive
   mid-session switch-back (forcing a running Foundry session to restart the moment the window
   reopens, without waiting for the next natural restart) is out of scope — see Open question 1.

## Files to modify
1. **`scripts/claude-backup.sh`**
   - Add a constant near `IMDS_TOKEN_URL`'s sibling pattern:
     ```sh
     FOUNDRY_IMDS_TOKEN_URL="http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fcognitiveservices.azure.com%2F"
     ```
     (`169.254.169.254` is the same already-allow-listed IMDS constant; this string lives outside
     `test_no_azure_identifiers.py`'s scan path, so no allow-list edit is needed there — see Open
     question 2 for the audience choice itself.)
   - Add `fetch_imds_token()`, mirroring `infra/azure/lib/monitor-ingest.sh`'s helper exactly
     (bounded `--max-time 5`, `jq -r '.access_token // empty'`, never echoes the token, returns
     empty/non-zero on any failure — curl error, no `jq`, malformed JSON, no VM metadata endpoint
     reachable at all, e.g. when run on a Mac).
   - In `load_foundry_env()`, extend the existing `if [ -z key ] && [ -z token ]` block: after the
     Keychain `security` attempt fails, add `elif [ "$(uname -s)" = "Linux" ] && token=$(fetch_imds_token) && [ -n "$token" ]` →
     `export ANTHROPIC_FOUNDRY_AUTH_TOKEN="$token"; auth=entra-imds`; else (Mac, or Linux with a
     failed fetch) keep today's bare `auth=entra` fallback. Use a distinct `auth` value
     (`entra-imds` vs `entra`) only in the `say()`/`note()` log lines, so `/status`'s own report is
     unaffected and a human reading `backup.log` can tell which Entra path actually ran.
   - `start_foundry()`'s existing `say`/`note` lines already print `$auth`; no other change needed
     there — they must still never print `$ANTHROPIC_FOUNDRY_AUTH_TOKEN` itself (confirm by
     re-reading those two lines; they reference `$auth` and `$ANTHROPIC_MODEL` only, not the token).
   - Add a short comment above the `case "$mode" in ... auto)` dispatch stating plainly that `auto`
     re-probes on every invocation with no memory of the last provider, and that this (plus the
     VM's own restart cadence) is the switch-back mechanism — documents the design decision above
     in the code itself, per `docs/lessons.md`'s "say so loudly" lesson.
2. **`docs/backup-provider.md`**
   - Step 3 ("Authentication, one of") gains a sentence under the `az login` bullet: on the VM (no
     Keychain, no `az` CLI installed), the launcher instead fetches a short-lived token from the
     VM's own system-assigned managed identity via Azure's Instance Metadata Service — nothing is
     written to disk, the token lives only in that one process's environment, and the one-time
     human step that makes it work (granting the identity access to the Foundry resource) is in
     `docs/azure-vm.md` §3.4.
   - New short paragraph (end of "Day to day" or a new "## Switching back" heading) stating the
     `auto` mode probes fresh on every start, so once the usage window reopens, the lead's next
     restart (its own exit, a crash, or the VM's `Restart=always`) returns to the subscription with
     no separate step; there is still no automatic switch *mid*-session either direction (symmetric
     with the existing "no automatic failover inside a running session" sentence).
3. **`docs/azure-vm.md`**
   - §3.4: drop "(optional, phase 2)" from the heading (this task makes it the real, required step
     for 0.26) and add one sentence naming `scripts/claude-backup.sh`'s new Linux IMDS-fetch code
     path by name, so the reader knows what the role grant is actually unlocking.
   - "Not done yet": replace the "board task 0.26" line — once this PR merges, the code and tests
     are done; what's left is purely the human's real-VM run (grant the role, run
     `scripts/claude-backup.sh --foundry`, check `/status`). Name that explicitly as the one
     remaining step, not as "task 0.26" generically (0.26 the PR will be done).

## New files
4. **`.claude/tests/test_claude_backup.py`** — new test module (picked up automatically by
   `python3 -m unittest discover -v .claude/tests`). Builds a temp `PATH` dir per test containing:
   - a fake `curl` dispatching on its arguments (IMDS URL → prints a fixed fake JSON token body;
     any other URL → exits 1, so a test can also prove the DCE/Monitor path is untouched by this
     script), and
   - a fake `claude` dispatching on its arguments: the probe's exact flags
     (`-p 'Reply with the single word ok.' --model haiku --max-turns 1 --output-format text`) return
     either `ok` (exit 0) or a usage-limit phrase (exit 1, per a test-controlled env var read by the
     stub), per test; any *other* invocation (the real `exec claude "$@"` at the end) instead
     prints every `ANTHROPIC_*`/`CLAUDE_CODE_USE_FOUNDRY`/`EDMATE_PROVIDER` env var it can see, one
     per line, and exits 0 — so the test can assert on exactly what the script would have started
     Claude Code with, with zero real model calls.
   See "Tests first" below for the exact cases.
5. **`scripts/test/foundry.env.fake`** (committed, obviously fake — mirrors
   `infra/azure/test/monitor.env.fake`'s convention): `ANTHROPIC_FOUNDRY_RESOURCE=fake-resource`,
   the three deployment names set to fake values, `ANTHROPIC_FOUNDRY_API_KEY=` (empty, so the
   Keychain/Entra branches are actually exercised), `EDMATE_BACKUP_MAIN_MODEL` set.

## Files out of bounds
No real `az`, `curl` to a real endpoint, `claude` login, or `docker`/`systemctl` invocation against
a live system, by any agent — same rule as 0.25/0.25b/10.1. The actual Azure role assignment (even
read-only `az role assignment list`) is never run by the builder; it is the human's step, already
documented, and this task only tidies that doc's wording. No change to
`infra/azure/lib/monitor-ingest.sh` or any other `infra/azure/*.sh` file — that subsystem is
untouched by this task (0.26 only touches `scripts/` and the two named docs, plus
`.claude/tests/`). No change to `infra/azure/create-vm.sh`, `cloud-init.yaml`, or any systemd unit —
confirmed above that no new timer/service is needed for the switch-back behaviour.

## Tests first
1. `bash -n scripts/claude-backup.sh`.
2. **Entra/IMDS path** (new `TestLinuxEntraPath` class):
   - `test_imds_token_fetched_and_set_as_auth_token_not_api_key` — fake `curl` returns a fixed
     fake token for the Foundry IMDS URL; run with the fake `foundry.env.fake` config (key empty),
     `HOME` pointed at a temp dir (no Keychain item, and the sandbox has no `security` binary
     anyway since it's Linux); assert the final execed `claude`'s printed env shows
     `ANTHROPIC_FOUNDRY_AUTH_TOKEN=<the fake token>`, no `ANTHROPIC_FOUNDRY_API_KEY=` line at all,
     and `CLAUDE_CODE_USE_FOUNDRY=1`.
   - `test_token_never_appears_in_log_or_stderr` — same run; assert the fake token string is absent
     from both `r.stderr` and the `backup.log` file contents (only `$auth`'s *name*, e.g.
     `entra-imds`, appears).
   - `test_failed_imds_fetch_falls_back_to_plain_entra_with_nothing_set` — fake `curl` exits 1 for
     every URL (simulates "not actually on an Azure VM" / role not yet granted); assert the script
     still starts (doesn't hard-fail), `auth` logs as the plain `entra` fallback, and neither
     `ANTHROPIC_FOUNDRY_API_KEY` nor `ANTHROPIC_FOUNDRY_AUTH_TOKEN` appears in the final env dump.
   - `test_configured_key_skips_the_imds_fetch_entirely` — config has
     `ANTHROPIC_FOUNDRY_API_KEY=fake-key-123` filled in; fake `curl` is *absent from PATH entirely*
     (not just stubbed to fail) so any attempt to call it would error loudly; assert the run still
     succeeds with `auth=env` and `ANTHROPIC_FOUNDRY_API_KEY=fake-key-123` in the dump, proving the
     IMDS path is never reached when a key is already configured.
3. **Switch-back / probe statelessness** (new `TestAutoSwitchBack` class):
   - `test_check_mode_reports_subscription_ok` — fake `claude` probe replies `ok` → `--check`
     prints `subscription OK.` and exits 0.
   - `test_check_mode_reports_foundry_on_usage_limit` — fake `claude` probe prints a usage-limit
     phrase and exits 1 → `--check` prints "the backup would start on Foundry." and exits 1.
   - `test_other_probe_error_refuses_to_switch` — fake `claude` probe exits 1 with an unrelated
     error → `--check`/auto both exit 2, nothing execed (existing designed behaviour; first test
     coverage for it).
   - `test_auto_mode_returns_to_subscription_even_with_foundry_env_present` — fake `claude` probe
     replies `ok`; the fully-configured `foundry.env.fake` fixture is present and would work fine if
     used; assert the final execed `claude`'s env dump shows `EDMATE_PROVIDER=subscription` and
     `CLAUDE_CODE_USE_FOUNDRY` unset — i.e., success always wins over any prior Foundry
     configuration, which is exactly "switches back ... when the window reopens."
   - `test_auto_mode_starts_foundry_on_usage_limit` — fake `claude` probe hits the usage-limit
     phrase; fake `curl` returns a token; assert the final dump shows the Foundry vars from §2
     above (ties the probe and the Entra path together end to end, still with zero real calls).
4. `python3 .githooks/secret-scan.py --all`.
5. `python3 .claude/skills/merge-gate/merge_gate.py 0.26` before handoff.

## Gate
```
python3 -m unittest discover -v .claude/tests
python3 .githooks/secret-scan.py --all
python3 .claude/skills/merge-gate/merge_gate.py 0.26
```
No `pnpm`/`turbo` gate applies — nothing under `packages/`/`apps/` changes.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `scripts/claude-backup.sh`, `scripts/test/foundry.env.fake`, `docs/azure-vm.md`,
  `docs/backup-provider.md` → **no match** — none of `scripts/**`, `docs/azure-vm.md`, or
  `docs/backup-provider.md` appear anywhere in `risk-paths.txt` (confirmed by reading the file in
  full; same conclusion 0.25/0.25b recorded for `infra/azure/**`, extended here to `scripts/**` and
  these two docs, which were never on the list to begin with).
- `.claude/tests/test_claude_backup.py` (new file) → **matches `.claude/**`** → **reviewers:
  security-reviewer** (the `# reviewers: security-reviewer` line directly above the `.claude/**`
  glob) — same reasoning 0.25b used for its two new `.claude/tests/` files.
- Required reviewers for this PR: **code-reviewer** (runs on every PR regardless of path) and
  **security-reviewer** (the `.claude/**` match above, and the credential-acquisition subject
  matter makes this the right call substantively too, matching the task brief's own hint).
  `review.md`'s `Reviewers:` line must name both. No `architect`/`typescript-reviewer` requirement —
  no `packages/contracts/**` or `docs/adr/**` change, so rule 2's ADR trio does not apply.
- The board marks 0.26 `risk: risky` (task-level flag) — per rule 6 the lead logs a `risk: high`
  decision at merge regardless of which paths matched.

## Open questions (recommendations given; none blocking)
1. **The literal real-VM accept clause.** "`scripts/claude-backup.sh --foundry` starts with
   `/status` showing Microsoft Foundry and no `ANTHROPIC_FOUNDRY_API_KEY` set" can only be proven
   on the actual VM, after the human grants the role assignment (`docs/azure-vm.md` §3.4) — the
   same precedent 0.25b (finding 4) and 10.1 set for a live Azure exercise. *Recommend:* the handoff
   names this as an outstanding human step (grant the role, run the command, paste what `/status`
   showed), not something the builder can close in-sandbox; the lead decides whether to run it
   personally before calling 0.26 fully done or to accept the code + stub-test proof as sufficient
   for merge with the live check tracked separately (as 0.25b's Open question 4 was handled).
2. **The Foundry/Cognitive Services token audience.** `https://cognitiveservices.azure.com/` is
   chosen by analogy with `monitor-ingest.sh`'s own `https://monitor.azure.com/` pattern and is the
   standard Azure AD resource URI for Cognitive Services/Azure AI resources (matching the "Cognitive
   Services User" role already documented in `docs/azure-vm.md` §3.4) — but this plan has not
   fetched `https://code.claude.com/docs/en/microsoft-foundry` (no live doc access from this
   sandbox) to confirm Claude Code's Foundry client expects exactly this audience string for
   `ANTHROPIC_FOUNDRY_AUTH_TOKEN`. *Recommend:* ship this value (it is the conventional, most likely
   correct one, and a wrong audience fails safely — the resulting token simply won't authenticate,
   caught at the human's real-VM check in Open question 1, not silently); if the human's real-VM run
   shows a different audience is needed, that is a one-line follow-up to
   `FOUNDRY_IMDS_TOKEN_URL`, not a redesign.
3. **Proactive mid-session switch-back.** Resolved above (Design decisions §3) as out of scope: the
   accept line names "auto mode" specifically, which is already stateless per invocation; a new
   systemd timer that force-restarts a long-running Foundry session the moment the window reopens
   would be new infrastructure the accept line doesn't ask for. *Recommend:* leave it out; if the
   human wants that tighter proactive switch later, it's a new, separately-sized task (a sibling to
   `edmate-blockers-watch.timer`), not part of 0.26.

## Decisions to log on merge
- `risk: high` (board-level `risk: risky` flag, plus the `.claude/tests/` new-file match).
- The real-VM `/status` check (accept line's literal clause) is a human step, not performed by the
  builder — name who will run it and when (Open question 1).
- The Cognitive Services token audience (`https://cognitiveservices.azure.com/`) is a documented
  assumption, not confirmed against live Foundry docs — flagged for correction at the human's
  real-VM run if wrong (Open question 2).
- No new systemd timer for mid-session proactive switch-back; the existing stateless `auto` mode
  plus the VM's restart cadence is the switch-back mechanism (Open question 3 / Design decision 3).

## Budget
Budget: 65 tool calls (1 phase, scripts/ + docs/azure-vm.md + docs/backup-provider.md + .claude/tests)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`bash -n` syntax check; running the full `.claude/tests` suite
including the new fake-`curl`/fake-`claude` stub tests, which only ever execute the stub scripts
this task creates on a prepended `PATH`, never a real `az`/`curl`/`claude`/Azure/Foundry/Anthropic
call; `python3 .githooks/secret-scan.py --all`; `python3 .claude/skills/merge-gate/merge_gate.py
0.26`)

## Exit conditions
Status: DONE when: `scripts/claude-backup.sh`'s Linux IMDS/Entra path and the switch-back tests are
all green in `.claude/tests/test_claude_backup.py`; the full `.claude/tests` suite stays green;
secret scan is clean; the merge gate passes; `docs/backup-provider.md` and `docs/azure-vm.md` are
updated as designed; and the handoff explicitly carries forward Open question 1 (the real-VM
`/status` check) as outstanding for the human, not silently marked done.
Status: PARTIAL if past roughly 65 tool calls without finishing, or if anything surfaces that would
need a real `az`/`curl`/`claude`/Azure/Foundry call against a live system, or a file outside this
plan's list, to verify — stop, commit what's green, hand off naming exactly what's left.
