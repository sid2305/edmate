# Plan: 0.25b — the four 0.25 review findings deferred to a follow-up

Board: `board.py show 0.25b` (M13, deps: `0.25` done, `risk: risky`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "0.25 review findings (deferred, lead, 6 Nov 2026): infra/azure/lib/monitor-ingest.sh's
`. "$env_file"` can abort heartbeat.sh/blockers-watch.sh under `set -e` on a malformed monitor.env
line instead of degrading gracefully (code-reviewer MEDIUM); its curl calls (IMDS token, DCE POST)
have no `--max-time`, so a network stall leaves the unsupervised backgrounded heartbeat.sh process
hanging (code-reviewer MEDIUM); .claude/tests/test_no_azure_identifiers.py has no pattern for an
Azure hostname/FQDN (`*.cloudapp.azure.com`, `*.blob.core.windows.net`) or a bare resource name
without an embedded GUID, so one could slip into a commit silently (security-reviewer MEDIUM);
infra/azure/monitor-setup.sh's ensure_dcr()/grant_identity() build ws_id/dce_id/principal_id/dcr_id
as literal escaped strings and feed those into the real (DRY=0) az calls instead of the resolved
IDs, unlike the sibling alert scripts, so the DCR/role-grant step as written would not work against
a live subscription (security-reviewer LOW)."

Accept: "monitor-ingest.sh degrades gracefully on a malformed monitor.env line and its curl calls
have a bounded timeout; test_no_azure_identifiers.py also catches an Azure hostname/FQDN shape;
monitor-setup.sh's DCR/role-grant step uses the resolved IDs, not literal escaped strings, and is
exercised with DRY_RUN=0 against a disposable resource group at least once."

These four findings are already fully diagnosed in `docs/tasks/0.25/review.md` (two MEDIUMs, with
the review's own suggested fix text quoted below) and in this task's board title (the two
security-reviewer findings). This plan designs the exact, minimal edit for each; no new design
work, no exploration.

### How it will be shown (paste into handoff.md)
| Finding | Evidence |
|---|---|
| 1. `monitor-ingest.sh` source-abort | A malformed-`monitor.env` test case (new fixture) makes `monitor_post_row` return 0 and print a one-line stderr note, where today it would abort the caller. `heartbeat.sh`/`blockers-watch.sh`'s existing clean-fixture tests still pass unchanged. |
| 2. curl calls have no timeout | `grep -n -- '--max-time' infra/azure/lib/monitor-ingest.sh` shows two hits (one per curl call). Existing DRY_RUN tests unaffected (DRY_RUN never calls curl). |
| 3. FQDN pattern gap | `test_no_azure_identifiers.py`'s regression test now has a case for a `*.blob.core.windows.net` URL (and documents that `*.cloudapp.azure.com` was already caught, since it ends in `.azure.com`); `python3 -m unittest .claude/tests/test_no_azure_identifiers.py` green. |
| 4. literal-string IDs in the real path | A new fake-`az` stub test proves that with `DRY_RUN=0`, `ensure_dcr()`'s `dataCollectionEndpointId`/`workspaceResourceId` and `grant_identity()`'s `--assignee`/`--scope` are the stub's resolved id values, not the literal string `"$(az ... )"`. The **actual** live Azure exercise (DRY_RUN=0 against a disposable resource group) is a human step — see "Open questions" §4; the handoff names it as outstanding, not done by the builder. |
| Gate | `python3 -m unittest discover -v .claude/tests` green; `python3 .githooks/secret-scan.py --all` clean; `python3 .claude/skills/merge-gate/merge_gate.py 0.25b` passes once `review.md`/`handoff.md` exist. |

## Read first
- `docs/tasks/0.25/review.md` (the two MEDIUM findings' exact text and suggested fix for finding 1
  and 2, quoted above and reused verbatim below).
- `infra/azure/lib/monitor-ingest.sh`, `infra/azure/monitor-setup.sh`,
  `.claude/tests/test_no_azure_identifiers.py` — current content already read for this plan; no
  surprises expected, but re-read before editing since 0.25b has no exclusive lock on these files.
- `infra/azure/monitor-heartbeat-alert.sh` / `monitor-vm-down-alert.sh` — the sibling idiom finding
  4 must match: a `*_expr` (or equivalent) string built only for `DRY_RUN=1` display, and a
  separately resolved real variable (`WS_ID=$(...)`, `AG_ID=$(...)`) used in the real `az` call.
- `.claude/tests/test_vm_heartbeat_and_alerts.py` and `.claude/tests/helpers.py` — the existing
  `MonitorScripts` test class and `run()`/`ENV` helpers this task's new tests extend.
- `docs/tasks/0.25/plan.md`'s "Out of bounds" line: **"No real `az`, `curl` to a real endpoint, or
  `docker`/`systemctl` invocation against a live system, by any agent."** This still applies to
  0.25b's builder — see Open question 4 for how finding 4's live-exercise clause is handled.
- `docs/lessons.md` "A check that silently skips looks like a pass" — relevant to finding 3: the
  new FQDN pattern must actually widen coverage, proven by a regression test, not just look like it
  does.

## Scope check
Entirely `infra/azure/lib/monitor-ingest.sh`, `infra/azure/monitor-setup.sh`, and two existing test
files under `.claude/tests/`. No new files except possibly one new test fixture (a malformed
`monitor.env` for finding 1). Nothing in `apps/`, `packages/`, `content/`, `docs/azure-vm.md`
(no accept-line text asks for a doc change; the human-facing instructions in that doc are unchanged
by these four fixes).

## Files to modify

### 1. `infra/azure/lib/monitor-ingest.sh` (findings 1 and 2)
**Finding 1** — replace the bare `. "$env_file"` (current line 26) so a malformed line degrades
instead of propagating through `set -e`. The review's own suggested fix:
```
set +e; . "$env_file"; local rc=$?; set -e
[ "$rc" -eq 0 ] || { printf '...skipping\n' >&2; return 0; }
```
This task's version additionally disables `-u` for the same source call (not just `-e`): both
callers run `set -euo pipefail`, and a malformed line that references an unset shell variable
(e.g. a stray `$SOMEVAR` the human typo'd) trips `nounset`, which is a separate, unconditional
shell-exit mechanism `set +e` alone does not suppress. Concretely:
```sh
local rc
set +eu
. "$env_file"
rc=$?
set -eu
if [ "$rc" -ne 0 ]; then
  printf 'monitor-ingest: monitor.env failed to source (malformed); skipping the Monitor write\n' >&2
  return 0
fi
```
(`pipefail` is untouched — only `-e`/`-u` are toggled, and only around this one line.) Keep the
existing missing-field check right after unchanged.

**Finding 2** — add `--max-time` to both `curl` invocations (current lines 46 and 51):
- IMDS token request (line 46): `curl -fsS --max-time 5 -H "Metadata: true" "$IMDS_TOKEN_URL"` —
  IMDS is link-local (`169.254.169.254`), so 5s is already generous.
- DCE POST (line 51): `curl -fsS --max-time 10 -X POST "$url" ...` — a real network hop to the
  public Monitor ingestion endpoint, given more headroom than the IMDS call.
Both calls already treat a non-zero curl exit as "skip, don't fail" (lines 47-49, 51-53), so adding
`--max-time` changes only how long a stall can block the caller, not the pass/fail behaviour.

### 2. `infra/azure/monitor-setup.sh` (finding 4)
`ensure_dcr()` and `grant_identity()` today build `ws_id`/`dce_id`/`principal_id`/`dcr_id` as
literal strings containing the escaped text `"$(az ... )"` (e.g. `ws_id="\$(az monitor
log-analytics workspace show -g $RG -n $WORKSPACE --query id -o tsv)"`), used unconditionally —
in `DRY_RUN=1` this is fine (nothing calls `az` for real), but in the real `DRY_RUN=0` path these
literal strings are fed as-is into the DCR JSON body and the role-assignment command, which would
fail against a live subscription (no such literal resource id exists).

Fix, matching `monitor-heartbeat-alert.sh`/`monitor-vm-down-alert.sh`'s own split between a
dry-run-only `*_expr` string and a really-resolved variable:
```sh
ensure_dcr() {
  local ws_id dce_id
  RULE_FILE=$(mktemp)
  if [ "$DRY" = "1" ] || ! az monitor data-collection rule show -g "$RG" -n "$DCR" -o none 2>/dev/null; then
    if [ "$DRY" = "1" ]; then
      ws_id="\$(az monitor log-analytics workspace show -g $RG -n $WORKSPACE --query id -o tsv)"
      dce_id="\$(az monitor data-collection endpoint show -g $RG -n $DCE --query id -o tsv)"
    else
      ws_id=$(az monitor log-analytics workspace show -g "$RG" -n "$WORKSPACE" --query id -o tsv)
      dce_id=$(az monitor data-collection endpoint show -g "$RG" -n "$DCE" --query id -o tsv)
    fi
    cat > "$RULE_FILE" <<JSON
    ...   # unchanged body, still interpolates $ws_id / $dce_id
JSON
    run az monitor data-collection rule create -g "$RG" -n "$DCR" --rule-file "$RULE_FILE" -o none
  else
    say "DCR $DCR already exists"
  fi
}

grant_identity() {
  local principal_id dcr_id
  if [ "$DRY" = "1" ]; then
    principal_id="\$(az vm show -g $RG -n $VM --query identity.principalId -o tsv)"
    dcr_id="\$(az monitor data-collection rule show -g $RG -n $DCR --query id -o tsv)"
  else
    principal_id=$(az vm show -g "$RG" -n "$VM" --query identity.principalId -o tsv)
    dcr_id=$(az monitor data-collection rule show -g "$RG" -n "$DCR" --query id -o tsv)
  fi
  run az role assignment create --assignee "$principal_id" --role "Monitoring Metrics Publisher" --scope "$dcr_id" -o none
}
```
Note the restructure moves the resolve step inside `ensure_dcr`'s "don't already exist" branch
(rather than resolving on every call), avoiding two extra real `az ... show` calls when the DCR
already exists — a small efficiency improvement over resolving unconditionally, not a behaviour
change the accept line asks for; the builder may resolve unconditionally instead if that reads
simpler, as long as the real (`DRY_RUN=0`) path ends up using the resolved id, not the literal
string, in both functions. Either way is "minimal and mechanical"; don't over-engineer this.

### 3. `.claude/tests/test_no_azure_identifiers.py` (finding 3)
**In scope (required by the accept line):** `AZURE_FQDN_RE` currently matches only hostnames
ending `.azure.com`, so `*.cloudapp.azure.com` is **already caught** (it ends in `.azure.com`) —
confirm this with the existing `test_azure_fqdn_pattern_catches_real_examples` test and say so in
the handoff, no change needed for that half. `*.blob.core.windows.net` is **not** caught (it does
not end in `.azure.com`). Minimal fix: widen the one regex to an alternation over both suffixes:
```python
AZURE_FQDN_RE = re.compile(
    r"\b[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.(?:azure\.com|core\.windows\.net)\b",
    re.IGNORECASE,
)
```
Update the comment above it to name both suffixes and why (`*.core.windows.net` covers
blob/queue/table/file storage endpoints, the other common Azure resource-hostname shape). Add one
new case to `test_azure_fqdn_pattern_catches_real_examples`'s `caught` list, e.g.
`"https://fakestorageacct.blob.core.windows.net/container"`. Confirmed by grep (this plan) that
neither `core.windows.net` nor `cloudapp.azure.com` appears anywhere under `infra/azure/**` or
`docs/azure-vm.md` today, so this widening finds nothing new to flag in the existing repo content —
the gate stays green with no unrelated fallout.

**Out of scope (see Open question 2):** the "bare resource name without an embedded GUID" half of
the finding. 0.25's own review (the HIGH finding, now fixed) already made this call for
resource-group/VM names: *"edmate-agents/edmate-lead are the repo's own fixed, already-public
documented names, indistinguishable from a real secret by regex alone; not a gap worth a brittle
rule."* The same reasoning applies to a generic storage-account/workspace/DCE name. The accept
line's own wording narrows to "an Azure hostname/FQDN shape" only (singular), which this fix
satisfies; flag the narrower scope in the handoff rather than inventing a new detection rule.

### 4. `.claude/tests/test_vm_heartbeat_and_alerts.py` (new tests, findings 1, 2, 4)
Extend the existing `HeartbeatScript`/`MonitorScripts` classes (not a new file — same file 0.25
already tests these scripts in):
- A new malformed-`monitor.env` fixture under `infra/azure/test/` (e.g.
  `monitor.env.malformed`, one line like `EDMATE_MONITOR_DCE_ENDPOINT=$(false)` — a failing command
  substitution, obviously fake) and a test asserting `heartbeat.sh` with
  `EDMATE_MONITOR_ENV_FILE` pointed at it exits 0 and prints the new "failed to source" stderr
  note, proving finding 1's fix without needing `set -u` to trip (the `$(false)` form fails via
  `-e`'s normal path; optionally also test a bare unset-variable reference, e.g.
  `EDMATE_MONITOR_DCE_ENDPOINT=$EDMATE_UNDEFINED_VAR`, to prove the `-u` half too).
- `grep -n -- '--max-time' infra/azure/lib/monitor-ingest.sh` assertion (two hits) — a static check
  is sufficient for finding 2; there is no live network stall to simulate in this sandbox, and the
  existing DRY_RUN tests already prove curl is never called in DRY_RUN=1.
- A new fake-`az` stub test for finding 4 (see "Tests first" below) — proves the resolved-id fix
  without any real Azure call, consistent with the "no real `az` ... by any agent" rule.

## Files out of bounds
Anything under `apps/`, `packages/`, `content/`, `evals/`, `docs/azure-vm.md`. No change to any
`infra/azure/*.sh` file other than the two named above (the sibling alert/action-group/budget
scripts are not part of these four findings — don't "fix" anything in them). No real `az` or `curl`
call to a live endpoint, no `docker`/`systemctl` invocation against a real system, by the builder.

## Tests first
1. `bash -n` on both modified scripts.
2. `monitor-ingest.sh`/`heartbeat.sh`: the clean-fixture tests (`monitor.env.fake`, already in
   0.25's suite) still pass unchanged. Add the malformed-fixture case described above (finding 1).
3. Add a `--max-time` grep assertion for both curl lines (finding 2).
4. `.claude/tests/test_no_azure_identifiers.py`: add the `*.blob.core.windows.net` regression case;
   run the whole file, confirm still green against the real repo content (finding 3).
5. **Fake-`az` stub test (finding 4).** Build a small temp directory containing one executable
   named `az` (prepended to `PATH` for this test only) that dispatches on its arguments: for any
   `... show ... --query id -o tsv` / `--query identity.principalId -o tsv` call, echo a fixed fake
   id string unique to that resource (e.g. `fake-ws-id-0`, `fake-dce-id-0`, `fake-principal-id-0`,
   `fake-dcr-id-0`); for any `... show -g ... -n ... -o none` existence check (no `--query`), exit 1
   (so `ensure_workspace`/`ensure_dce`/`ensure_dcr` all take their "doesn't exist yet, create it"
   branch); for `account show`, exit 0 (and print a fake subscription name for `--query name`); for
   any `create`/`role assignment create` call, append its full argument list to a log file in the
   temp dir and exit 0. Run `monitor-setup.sh` with `DRY_RUN=0` and this `PATH`, fake `EDMATE_RG`/
   `EDMATE_VM`/etc. env overrides (same pattern `MonitorScripts.setUp` already uses), then assert
   the logged `data-collection rule create --rule-file <path>` call's `--rule-file` content contains
   the **fake resolved ids** (`fake-ws-id-0`, `fake-dce-id-0`) and not the literal substring
   `"$(az"`, and that the logged `role assignment create` call's `--assignee`/`--scope` are
   `fake-principal-id-0`/`fake-dcr-id-0`, not `"$(az"`. This is the proof that finding 4's code path
   is fixed, with zero real Azure calls — see Open question 4 for the literal "disposable resource
   group" clause.
6. `python3 .githooks/secret-scan.py --all` and `python3 .claude/skills/merge-gate/merge_gate.py
   0.25b` before handoff.

## Gate
```
python3 -m unittest discover -v .claude/tests
python3 .githooks/secret-scan.py --all
python3 .claude/skills/merge-gate/merge_gate.py 0.25b
```
No `pnpm`/`turbo` gate applies — nothing in `packages/`/`apps/` changes.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `.claude/tests/test_no_azure_identifiers.py` and `.claude/tests/test_vm_heartbeat_and_alerts.py`
  → both under `.claude/**` → **matches** → **reviewers: security-reviewer** (the `# reviewers:
  security-reviewer` line directly above the `.claude/**` glob).
- `infra/azure/lib/monitor-ingest.sh`, `infra/azure/monitor-setup.sh` → **no match** — `infra/
  azure/**` is not on `risk-paths.txt` at all (confirmed; same finding 0.25's own plan recorded for
  these paths).
- Required reviewers for this PR: **code-reviewer** (runs on every PR regardless of path, same
  baseline 0.25's own review used) **and security-reviewer** (the `.claude/**` match above) — i.e.
  the same two reviewers who originally raised these four findings. `review.md`'s `Reviewers:` line
  must name both.
- The board already marks 0.25b `risk: risky` (task-level flag). Per rule 6, the lead logs a
  `risk: high` decision at merge regardless of which paths matched, matching 0.25's own precedent.
- No `packages/contracts/**` or `docs/adr/**` change — rule 2 (ADR + architect/security-reviewer/
  typescript-reviewer) does not apply.

## Open questions (recommendations given; none blocking)
1. **Finding 1's exact fix scope.** The review's suggested snippet only disables `-e`. This plan
   recommends also disabling `-u` for the same `source` call (see "Files to modify" §1), since a
   malformed line referencing an unset variable is an equally plausible "malformed monitor.env
   line" and `nounset` is not suppressed by `set +e` alone. *Recommend:* do both; it's a one-line
   addition to the same fix, not a new design.
2. **Finding 3's "bare resource name" half.** Narrowed out of scope per the accept line's own
   wording ("an Azure hostname/FQDN shape") and 0.25's own prior HIGH-fix precedent for exactly this
   category of name. *Recommend:* leave uncovered, as designed in "Files to modify" §3; note this
   explicitly in the handoff so it isn't mistaken for an oversight.
3. **Finding 4's restructuring style.** The illustrative fix in "Files to modify" §2 moves id
   resolution inside `ensure_dcr`'s existence-check branch (avoiding extra `az` calls when the DCR
   already exists) rather than resolving unconditionally like the sibling alert scripts do.
   *Recommend:* either structure is acceptable; what matters is that the real (`DRY_RUN=0`) path
   never feeds a literal `"$(az ...)"` string into a live `az` call. Don't touch `ensure_workspace`/
   `ensure_dce`/`print_summary` — they already resolve correctly or have nothing to resolve.
4. **The accept line's literal "exercised with DRY_RUN=0 against a disposable resource group at
   least once" clause.** 0.25's own plan states "No real `az` ... invocation against a live system,
   by any agent" (its "Out of bounds" line), and task 10.1's plan sets the same precedent elsewhere
   in this repo ("No live provider calls by any agent... run by the human"). This task follows the
   same rule: the builder proves finding 4's fix with the fake-`az` stub test (item 5 above), never
   a real subscription call. *Recommend:* the handoff names the live `DRY_RUN=0` run against a real,
   disposable resource group as an outstanding step for **the human** to perform once, after merge,
   and reports back (one line in a future decision log entry, or a note added to this task's
   handoff by the lead) — not a gap the builder can close inside this sandbox. This is the one item
   in the accept line this plan cannot fully satisfy from inside the build; flagging it here so the
   lead can decide whether to run it personally before marking 0.25b fully done, or accept the code
   fix + stub-test proof as sufficient for merge with the live check tracked separately.

## Decisions to log on merge
- `risk: high` (board-level `risk: risky` flag, plus the `.claude/**` test-file match).
- Finding 3 scoped to the FQDN-shape half only (not the bare-resource-name half), per the accept
  line's own wording and 0.25's prior precedent for resource/VM names.
- Finding 4's live `DRY_RUN=0`-against-a-disposable-resource-group verification is a human step,
  not performed by the builder — name who will run it and when (see Open question 4).

## Budget
Budget: 60 tool calls (1 phase, infra/azure (2 scripts) + .claude/tests (2 files, 1 new fixture))

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`bash -n` syntax checks; running the existing and new tests
under `.claude/tests` including the fake-`az`-stub test, which only ever executes the stub script
this task creates, never a real `az`/`curl`/`docker`/`systemctl` call; `python3
.githooks/secret-scan.py --all`; `python3 .claude/skills/merge-gate/merge_gate.py 0.25b`)

## Exit conditions
Status: DONE when: all four findings' code fixes are made exactly as designed above; the full
`.claude/tests` suite is green including the new malformed-`monitor.env`, `--max-time`-grep, FQDN-
regression and fake-`az`-stub tests; secret scan is clean; the merge gate passes; and the handoff
explicitly carries forward Open question 4 (the live-exercise step) for the lead, rather than
silently marking it done.
Status: PARTIAL if past roughly 60 tool calls without finishing, or if anything surfaces that would
need a real `az`/`curl`/`docker`/`systemctl` call against a live system, or a file outside this
plan's list, to verify — stop, commit what's green, hand off naming exactly what's left.
