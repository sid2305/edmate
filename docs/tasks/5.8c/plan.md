# 5.8c — Sign the prompt packs (B-36, B-38) and bump the seed: plan

Planned by the lead (small, mechanical task).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
The five packs carry reviewed_by sid2305; the live library and seed serve set@1.3.0; content, db and evals tests pass; no frame text change beyond the sign line.

## Human answers (21 Oct 2026, `.claude/blockers.md` Resolved)
- B-36 a): sign feedback@1.1.0, frame@1.1.0 and set@1.2.0 as sid2305 (reviewed_by: sid2305).
- B-38 a): sign frame@1.2.0 and set@1.3.0 as sid2305, with the B-37 defaults (all a) in the frame text. 5.8 already built the defaults for questions 1–7 into frame@1.2.0. Questions 8 and 9 are policy-code changes in 5.8b, not frame text, so no frame text changes here.

## Steps
1. In `content/prompt-packs/`, change `reviewed_by: pending` to `reviewed_by: sid2305` in `feedback@1.1.0.md`, `frame@1.1.0.md`, `set@1.2.0.yaml`, `frame@1.2.0.md` and `set@1.3.0.yaml`. Change no other line. Leave `set@1.1.0.yaml` alone (no human answer covers it); note it in the handoff.
2. Check every pack that set@1.3.0 pins is signed (no `pending`). If one isn't, stop and return BLOCKED.
3. `packages/db/src/seed.ts`: `PROMPT_PACK_VERSION` goes from '1.1.0' to '1.3.0', and the PROVISIONAL comment says why (B-36/B-38 signed). Update `packages/db/test/seed.test.ts` to match. Write the test change first and see it fail.
4. Fix any content, evals or db test that pins the pending state of these files or a pack hash. Change only the pinned values, never what a test checks.
5. Out of scope: the CLI's run-time pick of the newest signed set (5.8a Phase B) and the B-37 q8/q9 policy changes (5.8b).

## Files
- `content/prompt-packs/{feedback@1.1.0.md, frame@1.1.0.md, frame@1.2.0.md, set@1.2.0.yaml, set@1.3.0.yaml}`
- `packages/db/src/seed.ts`, `packages/db/test/seed.test.ts`
- any test that pins these files (list them in the handoff)
- `docs/tasks/5.8c/handoff.md`

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
- `content/prompt-packs/**`: code-reviewer is required, and the handoff logs a risk: high decision (prompt-pack behaviour now served).

## Tests
`corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/db... --filter=@edmate/evals...`, the db integration tests as the repo runs them, and `python3 .githooks/secret-scan.py --all`.

## Decisions (draft for the handoff)
- Sign as sid2305 per the human's B-36 and B-38 answers · risk: high (packs now live).

## Budget
Budget: 30 tool calls

## Exit conditions
DONE when the steps pass and the handoff is written. BLOCKED if a pinned pack is still pending, or if signing breaks a test whose fix would change behaviour.
