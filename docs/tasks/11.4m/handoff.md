# Handoff: 11.4m — 11.4l review LOWs/MEDIUMs, test-hardening only

Status: DONE
Branch: `m13/11.4m-ffmpeg-test-hardening`
Worktree: `/tmp/edmate-build-11.4m`
Tool calls used: 24

## Acceptance evidence

```
$ corepack pnpm --filter @edmate/worker exec vitest run src/ingest/ffmpegBuild.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```
(run against the real, unmodified `apps/worker/Dockerfile`, after every mutation check below was
reverted.)

```
$ git diff apps/worker/Dockerfile
(empty)
```

Full gate (typecheck/lint/test for `@edmate/worker...`, secret scan, prettier) — see "Gate result"
below.

## Changes

`apps/worker/src/ingest/ffmpegBuild.test.ts` only:
- Added `runInstructions()` / `isMultiCommand()` helpers and a new `it` asserting every
  multi-command `RUN` in the `ffmpeg` stage starts with `set -eux;` (item 1).
- Tightened the sha256 pin test with a regex that pins the actual interpolated
  `echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c -` line, alongside the existing order
  asserts (item 2).
- Widened the `apk add` regex to `apk\s+(?:-{1,2}\S+\s+)*add\b[^;&|\n]*` so a flag before `add`
  (e.g. `apk --no-cache add ...`) is captured (item 3).
- `configureTokens()` now strips a leading/trailing quote from each split token before the
  `startsWith('--')` filter, so a quoted `'--enable-gpl'` is no longer silently dropped (item 4).
- Pinned the two licence-check `grep -q` banner lines (LGPL and GPL) to their actual temp-file
  names, instead of a loose `toContain` on the phrase alone (item 5).
- `configureTokens()`'s body-end bound now falls back to the next `\nRUN` instruction when
  `make -j` isn't found, instead of scanning to end-of-stage-text (item 6, helper robustness only,
  no new `it`).
- Added a regex pinning the `curl -fsSL --proto '=https' --tlsv1.2 -o ffmpeg.tar.xz` line, next to
  the existing loose `curl -fsSL` substring check (item 9).

No change to `apps/worker/Dockerfile` (confirmed clean at every step and at handoff — see Gate
result). No change to `ffmpegChunker.ts` / `ffmpegChunker.test.ts`.

## Mutation-check record (per item: (b) reintroduce gap in temp Dockerfile edit, (c) targeted
vitest run, (d) `git checkout --`, (e) re-run green)

1. **set -eux.** Dropped `set -eux; ` from the configure/make `RUN` block →
   `every multi-command RUN in the ffmpeg stage starts with set -eux` went red (regex mismatch on
   that exact instruction); the other 6 its stayed green. Reverted; suite green (7/7).
2. **sha256 interpolation.** Changed the echo line to a literal
   `echo "deadbeef...  ffmpeg.tar.xz" | sha256sum -c -` → the new pinned regex went red while the
   pre-existing order-only asserts (curl/check/untar) stayed green — exactly the gap the finding
   named. Reverted; suite green.
3. **apk add ordering.** Changed `apk add --no-cache ...` to `apk --no-cache add ... ffmpeg` →
   confirmed via a scratch `node -e` check that the old regex (`apk\s+add\b...`) captured zero
   commands from that line (it requires `add` to follow `apk` directly), so it would have missed
   the `ffmpeg` token entirely; the new regex captured the full command including `ffmpeg`, and
   "the runtime stage installs no distro ffmpeg" went red for the right reason (`ffmpeg` found in
   an apk command). Reverted; suite green.
4. **Quoted configure tokens.** Two runs: (a) wrapped `--disable-x86asm` in single quotes (benign)
   → stayed green with the fix, as expected. (b) added a synthetic `'--enable-gpl'` token to the
   `--enable-filter` line → with the fix in place, "configure is LGPL-only with no external
   library" went red (`--enable-gpl` correctly detected after quote-stripping) — this demonstrates
   the fix closes the real gap the finding named (the old, unfixed code would have left this token
   invisible). Reverted; suite green.
5. **Anchored grep lines.** Two runs: (a) renamed the LGPL grep's temp file
   (`/tmp/licence.txt` → `/tmp/lic.txt`) → the new pinned regex went red; the old loose
   `toContain` phrase check would have stayed green (phrase still present in the block). (b) same
   for the GPL-banner temp file (`/tmp/licence.txt` → `/tmp/lic2.txt`) → the new GPL-banner regex
   went red. Reverted after each; suite green both times.
6. **`configureTokens()` over-scan guard.** Scratch, uncommitted `node -e` script (no Dockerfile
   edit, nothing committed): built an in-memory copy of the Dockerfile text with
   `make -j"$(nproc)"` removed, and ran both the old bound (`indexOf('make -j', at)` → `-1` →
   `undefined` end) and the new bound (`make -j` else next `\nRUN` else `undefined`) against it.
   Old bound: `make -j` not found → scans to end of stage text → over-scan into the licence-check
   block's own `--enable-(gpl|nonfree|version3|lib)` literal is `true` (confirmed, over-scans).
   New bound: stops at the next `RUN` instruction (offset found, not `-1`) → over-scan is `false`
   (confirmed, does not over-scan). No Dockerfile touched for this item; `git diff
   apps/worker/Dockerfile` stayed empty throughout.
9. **curl TLS flags.** Dropped `--proto '=https' --tlsv1.2` from the curl line → the new pinned
   regex went red; the pre-existing `curl -fsSL` substring check (test 2) stayed green (it only
   checks the command exists, not its flags) — exactly the gap the finding named. Reverted; suite
   green.

After every mutation check, `git diff apps/worker/Dockerfile` was confirmed empty before moving to
the next item, and is empty now at handoff time.

## Item 7 (banner-join pin) — no change, restated as accepted

The existing
`expect(text).toContain("./ffmpeg -hide_banner -L | tr '\\n' ' ' > /tmp/licence.txt")` is an
intentionally brittle literal-string pin (code-reviewer, 11.4l). No edit made; this task does not
re-decide it, only records that no action was taken and why (already decided in 11.4l's review).

## Gate result

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...
```
3 tasks (typecheck, lint, test) successful for `@edmate/worker` and its dependencies; 7/7 tests
pass in `ffmpegBuild.test.ts`, `ffmpegChunker.test.ts` unchanged and green.

```
$ python3 .githooks/secret-scan.py --all
```
clean, no findings.

```
$ corepack pnpm exec prettier --check apps/worker/src/ingest/ffmpegBuild.test.ts docs/tasks/11.4m/handoff.md
```
both files formatted.

`git diff apps/worker/Dockerfile` — empty (byte-identical to main at handoff time).

## Decisions

### 5 Nov 2026 · 11.4m mirroring the pinned ffmpeg tarball deferred (item 8) · decided by planner · risk: low
Decided: `apps/worker/Dockerfile` keeps downloading the pinned ffmpeg source tarball from ffmpeg.org only; no mirror added, no change to `apps/worker/src/ingest/ffmpegBuild.test.ts` for this item.
Why: The sha256 pin already catches tampering, so this is an availability-only risk, not a trust one. Mirroring is deferred until the worker image itself is published/distributed somewhere a mirror would matter — not yet true, the image is built straight from this Dockerfile on the VM today (confirmed: no registry push step exists in `.github/workflows` or `infra/`).
Alternatives: Add a mirror now (rejected: no trigger condition met yet; premature).
Reversible: Yes — revisit as its own task once images are published.

### 5 Nov 2026 · 11.4m banner-join literal pin left unchanged (item 7) · decided by code-reviewer (11.4l), restated by planner · risk: low
Decided: `apps/worker/src/ingest/ffmpegBuild.test.ts`'s `expect(text).toContain("./ffmpeg -hide_banner -L | tr '\\n' ' ' > /tmp/licence.txt")` stays an intentionally brittle literal-string pin; no edit.
Why: Already decided in 11.4l's review as an accepted tradeoff, so a regression can't silently return. This task doesn't re-decide it, only records that no action was taken and why.
Alternatives: Loosen the pin (rejected in 11.4l: would weaken the exact protection it exists for).
Reversible: N/A — no change made.

### 5 Nov 2026 · 11.4m two typescript-reviewer LOWs left as wontfix · decided by lead · risk: low
Decided: Two theoretical LOW findings against `apps/worker/src/ingest/ffmpegBuild.test.ts` from this task's typescript-reviewer pass are left unfixed: the widened `apk add` regex can't distinguish a real flag from a package literally named like one (e.g. `apk add -- --fake-pkg`), and the sha256-interpolation regex doesn't also check `${FFMPEG_SHA256}` isn't overridden by a later literal elsewhere in the file.
Why: Both are not risks against the current Dockerfile — the reviewer's own verdict marked them "theoretical, no fix needed now" / "not a gap the original finding asked to close." Fixing them would add test complexity for scenarios the Dockerfile doesn't exhibit.
Alternatives: Fix anyway for defense-in-depth (rejected: no concrete gap, see `docs/tasks/11.4m/review.md`).
Reversible: Yes — revisit if the Dockerfile ever grows a package or interpolation shaped like these.
