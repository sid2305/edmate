# Handoff: 0.25b

Status: DONE
Branch: m13/0.25b-monitor-fixes
Worktree: /tmp/edmate-0.25b
Tool calls used: ~40

## Acceptance evidence

| Finding | Evidence |
|---|---|
| 1. `monitor-ingest.sh` source-abort | `monitor_post_row` now wraps `. "$env_file"` in `set +eu` / `set -eu`, checks `rc`, and prints `monitor-ingest: monitor.env failed to source (malformed); skipping the Monitor write` on failure, returning 0. Two new regression tests in `test_vm_heartbeat_and_alerts.py::HeartbeatScript`: `test_malformed_monitor_env_degrades_gracefully_not_abort` (a new fixture `infra/azure/test/monitor.env.malformed` whose last line's `$(false)` makes the source call itself fail — proves the `rc`-based message, not the downstream missing-field check) and `test_malformed_monitor_env_unset_variable_degrades_gracefully` (a new fixture `monitor.env.malformed-unset` referencing an undefined shell variable — proves the `-u` half: it degrades to the existing "missing a field" message, never a bash "unbound variable" abort). Both exit 0 and still write the local heartbeat file. Existing clean-fixture tests (`monitor.env.fake`) unchanged and still pass.
| 2. curl calls have no timeout | `curl -fsS --max-time 5 ...` (IMDS token) and `curl -fsS --max-time 10 ...` (DCE POST). New static test `test_curl_calls_have_a_bounded_timeout` asserts `grep`-equivalent count of 2. Existing DRY_RUN tests unaffected (DRY_RUN never calls curl).
| 3. FQDN pattern gap | `AZURE_FQDN_RE` widened to `\.(?:azure\.com\|core\.windows\.net)\b`. Confirmed `*.cloudapp.azure.com` was already caught (ends in `.azure.com`) via the existing `test_azure_fqdn_pattern_catches_real_examples` test — no change needed for that half, per the plan. Added `"https://fakestorageacct.blob.core.windows.net/container"` to that test's `caught` list. `python3 -m unittest discover -v .claude/tests -p "test_no_azure_identifiers.py"` → 6/6 green, no new fallout against real repo content.
| 4. literal-string IDs in the real path | `ensure_dcr()`/`grant_identity()` in `monitor-setup.sh` now branch on `[ "$DRY" = "1" ]`: the `DRY=1` branch keeps the illustrative literal `"\$(az ... )"` strings (unchanged display behaviour), the real (`DRY=0`) branch resolves `ws_id`/`dce_id`/`principal_id`/`dcr_id` via actual `$(az ... )` command substitutions, matching the sibling alert scripts' idiom. New test `test_monitor_setup_real_path_uses_resolved_ids_not_literal_strings` builds a fake `az` executable (prepended to `PATH`, never a real `az`) that returns fixed fake ids for the `--query id -o tsv` / `--query identity.principalId -o tsv` calls, `exit 1` for existence checks (forcing the create branches), and logs every `create`/`role assignment create` call's full argument list. Runs `monitor-setup.sh` with `DRY_RUN=0` against that stub and asserts the logged `data-collection rule create --rule-file` content contains `fake-ws-id-0`/`fake-dce-id-0` and not the literal substring `"$(az`, and the logged `role assignment create` call's `--assignee`/`--scope` are `fake-principal-id-0`/`fake-dcr-id-0`, not `$(az`. **The literal live `DRY_RUN=0`-against-a-disposable-resource-group exercise named in the accept line is explicitly NOT performed here — see "Open question 4 carried forward" below.**
| Gate | `python3 -m unittest discover -v .claude/tests` → 401/401 OK. `python3 .githooks/secret-scan.py --all` → clean. `python3 .claude/skills/merge-gate/merge_gate.py 0.25b` → fails only on a board-state precondition unrelated to this diff: `task 0.25b has no branch on the board (board.py set 0.25b running --branch ...)` — the board's `branch:` field for 0.25b is still `null` / `status: planning` in this worktree's checkout of `main`; this is the lead's bookkeeping step (`board.py set 0.25b running --branch m13/0.25b-monitor-fixes`), not a code defect in this task's diff. No `review.md` exists yet either (expected — review happens after this handoff, per the normal plan→build→review flow).

## Open question 4 carried forward (not closed by this build)
The accept line's literal clause "exercised with DRY_RUN=0 against a disposable resource group at
least once" is **not** performed by this build, by design — per the plan's "Out of bounds" line
("No real `az`, `curl` to a real endpoint, or `docker`/`systemctl` invocation against a live
system, by any agent") and the plan's Open question 4, which names this as a human step. Finding
4's code fix is proven only via the fake-`az` stub test above. **The live `DRY_RUN=0` run against a
real, disposable Azure resource group remains outstanding and must be performed by a human
(the lead, or whoever next has Azure credentials) after merge**, with the result reported back as
a decision-log note. This is not a gap in this build's testing — it is the one acceptance clause
this sandbox cannot satisfy, flagged explicitly rather than silently marked done.

## Changes
- `infra/azure/lib/monitor-ingest.sh`: `monitor_post_row` now sources `monitor.env` under
  `set +eu`/`set -eu` with an `rc` check (finding 1); both `curl` calls gained `--max-time`
  (finding 2, 5s IMDS / 10s DCE POST).
- `infra/azure/monitor-setup.sh`: `ensure_dcr()` and `grant_identity()` now resolve
  `ws_id`/`dce_id`/`principal_id`/`dcr_id` via real `$(az ...)` command substitutions on the
  `DRY=0` path (unconditionally, not only inside the "doesn't exist yet" branch — see Decisions),
  keeping the illustrative literal strings only for `DRY=1` display (finding 4).
- `.claude/tests/test_no_azure_identifiers.py`: `AZURE_FQDN_RE` widened to also match
  `*.core.windows.net`; comment updated; one new regression case added (finding 3).
- `.claude/tests/test_vm_heartbeat_and_alerts.py`: five new tests (two for finding 1, one for
  finding 2, one for finding 4) plus two new fixtures:
  `infra/azure/test/monitor.env.malformed` and `infra/azure/test/monitor.env.malformed-unset`.

## Deviations from the plan
- The plan's illustrative `ensure_dcr()` restructuring moved id resolution inside the "doesn't
  already exist" branch to avoid extra `az` calls when the DCR already exists. This build resolves
  `ws_id`/`dce_id` unconditionally on the `DRY=0` path instead (simpler diff, same real-path
  correctness) — explicitly allowed by Open question 3 / "Files to modify" §2's note that "the
  builder may resolve unconditionally instead if that reads simpler." No behaviour-accept-line
  impact: the real path still never feeds a literal string into a live `az` call.
- No other deviations; all four fixes match the plan's designed snippets.

## Decisions

- `risk: high` — board-level `risk: risky` flag on 0.25b, plus this PR's `.claude/**` test-file
  changes matching the `.claude/**` risk-paths group (reviewers: security-reviewer), per rule 6.
  Required reviewers for this PR: code-reviewer (every PR) and security-reviewer
  (`.claude/**` match) — the same two who raised these four findings in 0.25's review.
- Finding 3 is scoped to the Azure hostname/FQDN shape half only, not the "bare resource name
  without an embedded GUID" half. The accept line's own wording ("an Azure hostname/FQDN shape")
  and 0.25's own prior HIGH-fix precedent (`edmate-agents`/`edmate-lead` are the repo's own fixed,
  already-public documented names, indistinguishable from a real secret by regex alone) both
  support leaving the bare-resource-name half uncovered; not implemented, by design, not oversight.
- Finding 4's live `DRY_RUN=0`-against-a-disposable-resource-group verification is a human step,
  not performed by the builder (see "Open question 4 carried forward" above). Who runs it and when
  is for the lead to assign after merge; this handoff does not claim it done.
