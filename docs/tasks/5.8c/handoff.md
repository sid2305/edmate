# 5.8c — Sign the prompt packs (B-36, B-38) and bump the seed: handoff

Status: DONE

## Summary
Signed the five prompt packs named in the B-36/B-38 answers (`reviewed_by: pending` →
`reviewed_by: sid2305`) and moved the seed's `PROMPT_PACK_VERSION` from `1.1.0` to `1.3.0` now
that every pack `set@1.3.0.yaml` pins is signed. No other line in those files changed, and no
other prompt pack was touched.

`set@1.1.0.yaml` is left `reviewed_by: pending` — no human answer covers it, per the plan.

## Files
- `content/prompt-packs/feedback@1.1.0.md` — `reviewed_by: pending` → `sid2305`
- `content/prompt-packs/frame@1.1.0.md` — `reviewed_by: pending` → `sid2305`
- `content/prompt-packs/frame@1.2.0.md` — `reviewed_by: pending` → `sid2305`
- `content/prompt-packs/set@1.2.0.yaml` — `reviewed_by: pending` → `sid2305`
- `content/prompt-packs/set@1.3.0.yaml` — `reviewed_by: pending` → `sid2305`
- `packages/db/src/seed.ts` — `PROMPT_PACK_VERSION` '1.1.0' → '1.3.0', PROVISIONAL comment
  updated to say B-36/B-38 signed the set
- `packages/db/test/seed.test.ts` — `promptPackVersion` expectation '1.1.0' → '1.3.0'; ran the
  suite against the still-'1.1.0' seed first and saw it fail on the mismatch before updating the
  test to match the new version
- `docs/tasks/5.8c/handoff.md` (this file)

Checked every pack `set@1.3.0.yaml` pins (safety, explain, coach, practice, feedback,
mock_interview, revision, locked, ask_teacher, redirect, distress, fallback, frame): all already
`reviewed_by: sid2305` after this change — no pack was still pending, so no BLOCKED.

Searched `packages/evals`, `packages/content` and `packages/db` test files for any other pin of
these five files' pending state or a hash of them: none found. The existing `pending`-check
tests in those packages exercise unrelated fixtures (safety/leak eval cases, locale packs,
privacy notices, persona templates) via their own local test fakes, not these five content
files, so none needed a change beyond `seed.test.ts`.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/db... --filter=@edmate/evals...`
  → 29/29 tasks successful (content, db, evals, plus their deps).
- `packages/db` integration tests run against a live Postgres (`docker compose -f docker/compose.yaml
  -f packages/db/test/compose.port.yaml up -d postgres`, then `corepack pnpm --filter @edmate/db test`):
  51 test files, 877 passed / 4 skipped (881 total) — all integration suites ran, including
  `seed.int.test.ts`. Postgres container stopped afterward.
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Decisions

### 21 Oct 2026 · 5.8c merge: prompt packs signed (B-36, B-38) and the seed on set@1.3.0 · decided by lead · risk: high
- Decided: merge 5.8c. feedback@1.1.0, frame@1.1.0, frame@1.2.0, set@1.2.0 and set@1.3.0 carry `reviewed_by: sid2305`, per the human's B-36 and B-38 answers (21 Oct 2026). The seed serves set@1.3.0. Every pack set@1.3.0 pins is signed. set@1.1.0 stays pending because no answer covers it. The CLI's run-time pick of the newest signed set is 5.8a Phase B.
- Why: code-reviewer (sonnet) approves with no findings. Only the sign line changed in each pack. Content, db and evals tests pass (db integration 877 passed).
- risk: high (prompt-pack behaviour now served).

### Sign the five packs as sid2305 per the human's answers
The human approved B-36 (feedback@1.1.0, frame@1.1.0, set@1.2.0) and B-38 (frame@1.2.0,
set@1.3.0) in `.claude/blockers.md` on 21 Oct 2026. This change makes those packs — and the
`set@1.3.0` combination the seed now serves — live content, so it is logged `risk: high` per
non-negotiable #2/#6 (prompt-pack behaviour change, risky path `content/prompt-packs/**`).

Tool calls used: 32 (the harness count; the builder counted 19)
