# 5.7 review — APPROVE

Reviewers: architect (opus, ADR 0012), security-reviewer (sonnet, ADR 0012), typescript-reviewer (opus, Phase A; sonnet, Phase B), code-reviewer (sonnet, Phase B)

## Summary
- **ADR 0012 (feedback pack 1.1.0, frame move-feedback):** approved by the architect, the security-reviewer and the opus typescript-reviewer. The lead accepted it and logs it `risk: high`.
- **Phase A** (packs, compose and the loader): the typescript-reviewer found 1 MEDIUM and 3 LOWs, all fixed in the follow-up commit.
- **Phase B** (32 feedback cases and the mechanism test): the typescript-reviewer approved with two informational notes and no findings. The code-reviewer approved with no findings.
- **Set 1.1.0 snapshots:** byte-identical to main's (the diff against main is additive only).
- **Packs not yet signed:** `feedback@1.1.0`, `frame@1.1.0` and `set@1.2.0` stay `reviewed_by: pending`. The human's sign-off is B-36. The demo seed stays on 1.1.0 until a follow-up `packages/db` task moves it.

## Findings
- [MEDIUM] [fixed] packages/content/src/promptPacks.snapshot.test.ts:45 — composed snapshots covered only the new set; set 1.1.0 (the seed's) is now pinned under its old suite name, byte for byte main's.
- [LOW] [fixed] packages/harness/src/pedagogy/compose.ts:129 — move-feedback is now used only at rung 0; rungs 1 and 2 compose as before (tested).
- [LOW] [fixed] packages/harness/src/pedagogy/promptPacks.ts:318 — the frame is cast to `PromptPackSet['frame']`.
- [LOW] [fixed] packages/harness/src/pedagogy/promptPacks.ts:99 — `RequiredFrameSection` is exported and `moveSection` returns it.
