# Plan: 11.4m — 11.4l review LOWs/MEDIUMs, test-hardening only

Board: `board.py show 11.4m` (M13, deps 11.4l done, risk: low).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "11.4l review LOWs/MEDIUMs, test-hardening only (no Dockerfile behaviour change):
ffmpegBuild.test.ts assert set -eux is present on both multi-command RUN blocks (typescript-reviewer
MEDIUM); assert the sha256sum -c line actually interpolates ${FFMPEG_SHA256} rather than any literal
(typescript-reviewer MEDIUM); tighten the apk add/configure-flag/licence-grep regexes against apk
--no-cache add ordering, quoted --enable-gpl tokens, and an unpinned GPL-banner grep
(typescript-reviewer and code-reviewer LOWs); assert curl -fsSL carries --proto =https --tlsv1.2
(security-reviewer LOW); mirror the pinned ffmpeg source tarball once images are published, per LGPL
2.1 provenance (security-reviewer LOW, no code change yet, docs only)."
Accept: "every finding listed above has a new or tightened assertion in ffmpegBuild.test.ts (or, for
the mirroring item, a documented follow-up note) that fails against a reintroduced instance of the
original gap and passes against the current Dockerfile; @edmate/worker typecheck, lint and test stay
green; no Dockerfile behaviour changes."

## Source of the findings
`docs/tasks/11.4l/review.md`, the nine findings marked `[deferred 11.4m]` (lines 38-62). Quoted below
with the item label this plan uses:

| # | Finding (review.md) | Reviewer | Severity |
|---|---|---|---|
| 1 | Neither multi-command `RUN` block is checked for `set -eux`; a dropped `set -e` would silently pass the test while weakening the Dockerfile's own fail-closed behaviour. | typescript-reviewer | MEDIUM |
| 2 | The sha256 pin check only checks command order, not that the grep actually interpolates `${FFMPEG_SHA256}`. | typescript-reviewer | MEDIUM |
| 3 | The `apk add` regex misses `apk --no-cache add ffmpeg`. | typescript-reviewer | LOW |
| 4 | The configure-flag split doesn't strip quotes, so a quoted `"--enable-gpl"` would pass the test. | typescript-reviewer | LOW |
| 5 | The LGPL-phrase assertion doesn't anchor to the actual failing `grep -q` line, and the GPL-banner `if grep` isn't pinned by its own regex. | typescript-reviewer | LOW |
| 6 | `configureTokens()`'s end-of-text fallback would, in a hypothetical Dockerfile missing `make -j`, over-scan into the licence-check block's quoted grep pattern. | code-reviewer | LOW |
| 7 | The banner-join assertion is an intentionally brittle literal-string pin; accepted tradeoff, no action needed beyond noting it. | code-reviewer | LOW |
| 8 | Single-source download from ffmpeg.org with no mirror (availability risk only; sha256 pin already catches tampering). | security-reviewer | LOW |
| 9 | No assertion that the `curl` line keeps `--proto '=https' --tlsv1.2`. | security-reviewer | LOW |

Items 1-6 and 9 get a new or tightened assertion. Item 7 gets no code change (already an accepted
tradeoff — restate it in the handoff, don't touch it). Item 8 gets a documented follow-up note, not a
code or Dockerfile change (see "Item 8" below).

## Read first (done before writing this plan; re-read before editing)
- `apps/worker/src/ingest/ffmpegBuild.test.ts` (current, 165 lines) — the file this task edits.
- `apps/worker/Dockerfile` (current, 92 lines) — read-only reference; never edited by this task.
- `docs/tasks/11.4l/review.md` and `docs/tasks/11.4l/handoff.md` — the findings and the mutation-check
  pattern this task repeats (e.g. "with the download `curl` line deleted from a temporary copy of the
  Dockerfile, the pin test fails. The Dockerfile was restored afterwards.").
- Lesson "A check that silently skips looks like a pass" (`docs/lessons.md`) — the same class of bug
  as items 3, 4 and 6: a test that looks like it checks something but silently drops the thing it
  should have caught. Every new/tightened assertion in this task needs a mutation check proving it
  really fails on the gap, not just passes on main.

## Files to modify
1. **`apps/worker/src/ingest/ffmpegBuild.test.ts`** — every change below, in place. No new file, no
   new dependency (the file already imports only `node:fs`, `node:url`, `@edmate/gateway` and the
   package's own `vitest`/`ffmpegChunker.js`).

## Files out of bounds (stop at PARTIAL if any seems to need a change)
- `apps/worker/Dockerfile` — read-only. This task proves the test file catches the gaps; it never
  closes them in the Dockerfile. Any temporary mutation made to test the test (see "Mutation checks"
  below) is reverted with `git checkout -- apps/worker/Dockerfile` before the next step, and the gate
  is re-run clean on the real file before the handoff is written.
- `docs/adr/0016-ffmpeg-chunker.md` — not touched. Item 8's follow-up note lives in the handoff's
  `## Decisions` (see "Item 8" below), specifically so this task's file list stays off
  `docs/adr/**` (a `risk-paths.txt` group needing architect, security-reviewer and typescript-reviewer
  — out of proportion for a deferred LOW with no code change).
- `apps/worker/src/ingest/ffmpegChunker.ts` and `ffmpegChunker.test.ts` — unaffected by any item here;
  no change.
- `docs/board/tasks.yaml` — the lead owns it.

## Tests first (tightening order; tdd-guide pattern: red on the gap, green on main)

For every item below: (a) make the test change against the current, unedited Dockerfile and confirm
it is green; (b) temporarily reintroduce the original gap in a local, uncommitted edit of
`apps/worker/Dockerfile` (the exact wording the finding describes); (c) run only
`src/ingest/ffmpegBuild.test.ts` and confirm the one relevant `it` goes red, for the stated reason;
(d) `git checkout -- apps/worker/Dockerfile` to revert; (e) run the suite again and confirm green.
Record each (b)-(e) pair as a short "Mutation check" line in the handoff, as 11.4l's fix round did.
Do this per item, not once at the end — a later item's mutation could mask an earlier one's.

1. **Item 1 (set -eux on every multi-command RUN).** Add two small helpers above the `describe`
   block: `runInstructions(text)` — join backslash continuations
   (`text.replace(/\\\n/g, ' ')`) and return every `RUN ...` instruction via
   `[...joined.matchAll(/^RUN\s.*$/gm)].map((m) => m[0])`; and `isMultiCommand(run)` — true when the
   instruction, with one trailing `;` dropped, still contains a `;` (more than one shell statement).
   New `it('every multi-command RUN in the ffmpeg stage starts with set -eux', ...)`:
   `runInstructions(stage('ffmpeg')).filter(isMultiCommand)` must be non-empty (so the check can't
   pass by finding nothing) and every one of them must match `/^RUN\s+set -eux;/`.
   Mutation: drop `set -eux; ` from one of the three `RUN` blocks in the `ffmpeg` stage (pick the
   configure/make one) → this new `it` must go red; the other five its are unaffected.

2. **Item 2 (sha256 interpolation).** In the existing pin test, replace the loose
   `check = text.indexOf('sha256sum -c')` check with a regex pinned to the real interpolated line:
   `expect(text).toMatch(/echo "\$\{FFMPEG_SHA256\}\s+ffmpeg\.tar\.xz" \| sha256sum -c -/)`. Keep the
   existing `curl`/`check`/`untar` ordering asserts (still useful) alongside it, not instead of it.
   Mutation: change the echo line to a literal sha (e.g. `echo "deadbeef...  ffmpeg.tar.xz" | sha256sum -c -`)
   in the temporary copy → new assertion goes red; the old order-only asserts would stay green (that's
   exactly the gap the finding named).

3. **Item 3 (apk add ordering).** Widen the regex in "the runtime stage installs no distro ffmpeg"
   from `/apk\s+add\b[^;&|\n]*/g` to `/apk\s+(?:-{1,2}\S+\s+)*add\b[^;&|\n]*/g`, so a flag before
   `add` (`apk --no-cache add ffmpeg`) is captured into the command list, not silently dropped from it.
   Mutation: in the temporary copy, change the one real `apk add` line in the `ffmpeg` stage to
   `apk --no-cache add build-base curl tar xz ffmpeg` → confirm the old regex fails to capture the
   whole command (manually, via a scratch `node -e` check, documented once) so it would have missed
   the `ffmpeg` token entirely; then confirm the new regex catches it and the `it` goes red for the
   right reason (`ffmpeg` found in an apk command).

4. **Item 4 (quoted configure tokens).** In `configureTokens()`, strip a leading/trailing quote
   character from each split token before the `t.startsWith('--')` filter:
   `.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter((t) => t.startsWith('--'))`.
   Today a token written `'--enable-gpl'` keeps its quotes, fails `startsWith('--')`, and is dropped
   from the tokens list entirely — invisible to the `--enable-(gpl|nonfree|version3|lib)` assertion,
   not merely miscounted. Mutation: wrap one configure flag (not `--enable-gpl` itself, to keep the
   mutation realistic — wrap `--disable-x86asm` and separately, in a second run, wrap a synthetic
   `--enable-gpl` token) in single quotes in the temporary copy → with the old code the
   "configure is LGPL-only" `it` stays green even with an added `'--enable-gpl'` token (the real gap);
   with the fix it goes red.

5. **Item 5 (anchor the LGPL/GPL grep lines).** In "the image build fails closed on a GPL or
   incomplete ffmpeg", replace the loose `expect(text).toContain('GNU Lesser General Public License')`
   with a regex pinned to the actual failing line:
   `expect(text).toMatch(/grep -q 'GNU Lesser General Public License' \/tmp\/licence\.txt;/)`.
   Add a second, new regex for the GPL-banner check, which today is only implicitly covered by the
   LGPL substring check and has no pin of its own:
   `expect(text).toMatch(/if grep -q 'GNU General Public License' \/tmp\/licence\.txt; then [^;]*; exit 1; fi;/)`.
   Keep the existing `--enable-(gpl|nonfree|version3|lib)` regex and the `! grep` ban as they are —
   those two are already pinned; only the two `grep -q` banner lines were not.
   Mutation: change the LGPL grep's pinned variable name (e.g. `/tmp/licence.txt` → `/tmp/lic.txt`,
   leaving the rest of the Dockerfile's own shell consistent so the build itself would still work
   if rebuilt — this only has to fool the *old* regex-free `toContain` check, not actually build) →
   old `toContain` check still passes (the phrase string is still present somewhere in that RUN
   block); new pinned regex goes red. Do the same for the GPL-banner line's temp-file name.

6. **Item 6 (`configureTokens()` over-scan guard).** Bound the configure body's end at `make -j` when
   present, and otherwise at the next `\nRUN` line (never at end-of-stage-text), so a hypothetical
   Dockerfile missing `make -j` can't scan into the licence-check block's own quoted grep pattern
   (which contains `--enable-(gpl|nonfree|version3|lib)`-shaped text that would otherwise leak into the
   token set): `const nextRun = text.indexOf('\nRUN', at); const end = makeAt !== -1 ? makeAt :
   nextRun !== -1 ? nextRun : undefined;`. This is a defensive change to the test's own helper, not a
   new assertion — demonstrate it (not a committed test) by: in a **separate, scratch copy** of the
   function (or a throwaway script, never committed) temporarily delete `make -j"$(nproc)"` from a
   temporary Dockerfile copy, show the *old* bound (`text.indexOf('make -j', at)` → `-1` →
   `undefined` end → scans to end of stage text) pulls in the licence-check block's own
   `--enable-(gpl|nonfree|version3|lib)` literal as if it were an enabled flag, and show the *new*
   bound stops at the next `RUN` instead. Record this as a one-off demonstration in the handoff (not a
   new `it`, since "Dockerfile is missing `make -j`" is not itself a case any committed test asserts
   against — the fix is to the helper's robustness, per the finding).

7. **Item 7 (banner-join pin) — no change.** Restate the finding in the handoff as accepted, with no
   edit: the existing `expect(text).toContain("./ffmpeg -hide_banner -L | tr '\\n' ' ' > /tmp/licence.txt")`
   is an intentionally brittle literal pin so a regression can't silently return.

8. **Item 8 (mirror the tarball once images are published) — docs-only, no test or Dockerfile edit.**
   Add a dated entry under the handoff's `## Decisions` (risk: low, no action) stating: the worker
   image still downloads the pinned ffmpeg source tarball from ffmpeg.org only; the sha256 pin already
   catches tampering (this is an availability-only risk, not a trust one); mirroring is deferred until
   the worker image itself is published/distributed somewhere a mirror would matter (not yet true —
   the image is built straight from this Dockerfile on the VM today); revisit then, as its own task.
   This decision reaches `docs/decisions/log.md` at merge like any other (rule 8) — that is the
   "documented follow-up note" the accept line asks for. No new board task is opened now because the
   trigger condition (images being published) hasn't happened yet.

9. **Item 9 (curl TLS flags).** Add, alongside the existing pin test's `curl` check, a regex pinned to
   the full download line: `expect(text).toMatch(/curl -fsSL --proto '=https' --tlsv1\.2 -o ffmpeg\.tar\.xz/)`.
   Mutation: drop `--proto '=https' --tlsv1.2` from the `curl` line in the temporary copy → the
   existing `curl -fsSL` substring check (test 2, pre-existing) stays green (it only checks the command
   exists, not its flags); the new regex goes red.

## Gate
```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...
python3 .githooks/secret-scan.py --all
corepack pnpm exec prettier --check apps/worker/src/ingest/ffmpegBuild.test.ts docs/tasks/11.4m/handoff.md
```
`ffmpegChunker.test.ts` must stay green and unchanged (nothing here touches it). After every mutation
check, confirm `git diff apps/worker/Dockerfile` is empty before moving to the next item, and confirm
it is empty again right before running the final gate — the Dockerfile must be byte-identical to main
at handoff time.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `apps/worker/src/ingest/**` — **no match** (the only `apps/worker` glob on the list is
  `apps/worker/src/alerts/**`, untouched here).
- `apps/worker/Dockerfile` — not edited; even if it were, it isn't itself on the list (11.4l's own
  `risk-paths.txt` note: the Dockerfile needed architect/security/typescript review only because rule
  2, tech-stack change — not a path match, and this task makes no Dockerfile change at all).
- `docs/tasks/11.4m/*` — no match.
- No `docs/adr/**`, `.claude/**`, `packages/contracts/**`, safety, access, auth or `packages/db/**`
  path touched.
- **No `risk: high` decision needed.** Recommend `code-reviewer` (always required) plus
  `typescript-reviewer` and `security-reviewer` pass over the diff as a matter of continuity — they
  are the three reviewers who raised these nine findings in `11.4l/review.md` and are best placed to
  confirm each is actually closed — but this is a recommendation, not a `risk-paths.txt` requirement.

## Decisions to log in the handoff
- Item 8, as written above (risk: low, no action — mirroring deferred until images are published).
- Item 7, restated as accepted with no change (risk: low — already decided in 11.4l's review; this
  task doesn't re-decide it, only records that no action was taken and why).

## Open questions
None blocking. All nine items have a stated fix (items 1-6, 9), a stated no-action restatement (item
7) or a stated docs-only note (item 8); none requires touching the Dockerfile, the ADR or any
risk-paths.txt path.

## Budget
Budget: 45 tool calls (1 phase, @edmate/worker)

One file edited across nine small, independent changes, each needing a short mutation check
(temporary Dockerfile edit, targeted vitest run, revert, re-run). Well under the sizing thresholds
(fewer than 8 files, one package, no new guard or adapter).

## Allowed tools
Read, Grep, Glob, Edit, Write (for the new `docs/tasks/11.4m/handoff.md` only), Bash limited to:
`corepack pnpm --filter @edmate/worker exec vitest run src/ingest/ffmpegBuild.test.ts` (targeted
runs during mutation checks), the full gate command above, `git diff`/`git checkout --` on
`apps/worker/Dockerfile` only (to make and revert temporary mutations), and the secret scan.
**No `docker`, no `docker compose`, no `make`, no network call.**

## Exit conditions
`Status: DONE` once: every one of items 1-6 and 9 has a new or tightened assertion with a recorded
mutation check (red on the reintroduced gap, green on the real Dockerfile); item 7 is restated with no
change; item 8's decision is logged; `git diff apps/worker/Dockerfile` is empty at handoff time; the
full gate (`@edmate/worker` typecheck/lint/test, secret scan, prettier) is green; `ffmpegChunker.test.ts`
is unchanged and green.
`Status: PARTIAL`, stop and report, if: past ~45 tool calls; any mutation check can't be reverted
cleanly; any item turns out to need a real Dockerfile change to test correctly (it shouldn't — flag it
instead of editing the Dockerfile); or any file outside `apps/worker/src/ingest/ffmpegBuild.test.ts`
and `docs/tasks/11.4m/handoff.md` seems to need an edit.
