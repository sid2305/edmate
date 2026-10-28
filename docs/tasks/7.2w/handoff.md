# Handoff: 7.2w
Status: DONE

## Summary
Re-pointed stale build-plan citations in 16 `evals/suites/persona/*.yaml` files, after the guardrail table moved by 55 lines (now `personaBoundary` at line 482, `tone` at line 483):
- `persona-admin-override-en.yaml`
- `persona-admin-override-hi-latin.yaml`
- `persona-are-you-human-en.yaml`
- `persona-chatgpt-norules-en.yaml`
- `persona-consent-override-en.yaml`
- `persona-consent-parent-override-en.yaml`
- `persona-dan-roleplay-deva.yaml`
- `persona-dan-roleplay-en.yaml`
- `persona-dan-roleplay-hi-latin.yaml`
- `persona-identity-reward-extracredit-en.yaml`
- `persona-prove-not-bot-en.yaml`
- `persona-prove-not-bot-voice-message-en.yaml`
- `persona-rule-override-developer-mode-en.yaml`
- `persona-rule-override-hypothetical-frame-en.yaml`
- `persona-rule-override-school-counselor-en.yaml`
- `persona-say-human-reward-en.yaml`

Mapping applied, only inside `source:` text, words in brackets unchanged:
- `line 427-428 (personaBoundary, tone)` → `line 482-483 (personaBoundary, tone)`
- `line 427 (personaBoundary ...)` → `line 482 (personaBoundary ...)`
- `line 428 (tone guard)` → `line 483 (tone guard)`

Applied with one `sed -i '' -E` command across `evals/suites/persona/*.yaml` (ordered: `427-428` first, then standalone `427`, then standalone `428`, each guarded against matching digits so `482`/`483` are never re-touched). `git diff --stat` confirms exactly 16 files changed, 1 line each (16 insertions, 16 deletions) — no turns, expectations, ids or file names touched.

Check script (scripted over every persona case's build-plan `line N` citation; verifies each cited span contains the named guard term, e.g. `personaBoundary`/`tone`, by reading the live line range out of `docs/edmate-harness-build-plan.md`):
```
Checked 16 citations across 100 files.
All citations verified against docs/edmate-harness-build-plan.md.
```
No other citation failed or needed re-pointing — the 16 files above are the only persona cases citing `docs/edmate-harness-build-plan.md` with a `line N` guard reference.

## Decisions
None.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals` → 6/6 tasks successful (typecheck, lint, test for 2 packages), 1873 tests passed, 31 test files passed.
- `python3 .githooks/secret-scan.py --all` → clean, no output, exit 0.

## Budget
Tool calls used: 14
