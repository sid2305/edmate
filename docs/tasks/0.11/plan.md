# Implementation Plan: Task 0.11 — Agent files: lead-approved merge policy and English-only pilot

## Acceptance
No agent file tells reviewers to require human approval; safety-reviewer still writes findings the lead turns into safety-review.md. Also update eval-author, pedagogy-author and locale-context skill for the English-only pilot decision (18 Oct 2026): write English only except safety cases, which keep Hindi/Hinglish input.

## Overview
Three decisions govern this task:
- **Lead-approved merge policy (18 Oct 2026)**: The lead merges after a clean merge gate and logs decisions; no `human-approved` label or "human sign-off" language.
- **English-only pilot (18 Oct 2026)**: No new Hindi/Hinglish teaching, prompt-pack or non-safety eval work; safety guards still recognise Hindi/Hinglish input.
- **MVP first (20 Oct 2026)**: The lead signs eval cases (`reviewed_by: lead`); prompt packs still need a named human.

## Files to Modify
1. `.claude/agents/safety-reviewer.md` (risky path: `security-reviewer`)
2. `.claude/agents/eval-author.md` (risky path: `security-reviewer`)
3. `.claude/agents/pedagogy-author.md` (risky path: `security-reviewer`)
4. `.claude/skills/locale-context/SKILL.md` (risky path: `security-reviewer`)

## Implementation Steps

### Phase 1: Update Agent Files (1 phase, ~40 builder calls)

1. **safety-reviewer.md**
   - Line 3 (description): Remove "Never gives final approval; it prepares the human sign-off."
   - Line 10 (first paragraph): Remove "and platform content still needs a named human's sign-off (rule 7)."
   - Line 13 (Edmate notes): Change "Return your review as text; the team lead saves it as `safety-review.md`." to make clear the lead converts findings to safety-review.md, which gates the merge.
   - Lines 44–46 (Output section): Replace "For the human approver" header with "For the lead"; remove "HUMAN APPROVAL REQUIRED (build plan rule 6)" and replace with language that the lead will review and decide the merge per the merge gate.

2. **eval-author.md**
   - Line 3 (description): Change "in English, Hindi (Devanagari), romanised Hindi and Hinglish;" to "in English during the pilot (18 Oct 2026 decision; after the pilot, multilingual suites can be added);"
   - Line 16 (template): Change `reviewed_by: pending        # a named human replaces this before merge (rule 7)` to `reviewed_by: lead        # the lead signs (MVP first); a named human may co-review`
   - Line 32 (language mix): Replace "Language mix per suite: about 50% English, 30% Hinglish or romanised Hindi, 20% Devanagari." with "Language: English only during the pilot (18 Oct 2026 decision); safety suites may include Hindi/Hinglish input for guard testing."

3. **pedagogy-author.md**
   - Line 23 (Language rule): Change "**Language:** write packs in English with an instruction to reply in the student's language. Mirror romanised Hindi if the student uses it." to "**Language:** write packs in English only during the pilot (18 Oct 2026 decision). A prompt pack instructs agents to reply in the student's language when multi-language support is enabled."
   - Line 24 stays: Prompt packs and templates still need a named human reviewer per MVP first.

4. **locale-context/SKILL.md**
   - Line 3 (description): Change "eval cases in other languages" to "eval cases (English only during the pilot)"
   - Line 49 (India section): Add a note: "During the pilot (18 Oct 2026), only English teaching and prompt-pack content are new. Safety eval cases may use Hindi/Hinglish input."

## Testing Strategy
- No new tests required; changes are documentation/guidance only.
- The merge gate will enforce that no PR says "human approval required" via a scan of agent files.

## Risky Paths Touched
- `.claude/agents/**` — group: `security-reviewer` (from risk-paths.txt line 45–46)
- `.claude/skills/**` — group: `security-reviewer` (from risk-paths.txt line 45–46)

All paths touched are under `.claude/`, which is risky. The PR must pass code-reviewer (runs on every PR anyway per MVP first) and log a `risk: high` decision.

## Success Criteria
- [ ] No agent file contains "human approval", "human sign-off", or "human-approved"
- [ ] safety-reviewer.md clearly states the lead decides merges and logs decisions
- [ ] eval-author.md default is English only; safety cases may include Hindi/Hinglish
- [ ] pedagogy-author.md notes English-only teaching for the pilot
- [ ] locale-context skill notes English-only pilot (safety cases keep multilingual input for guards)
- [ ] Build gate passes and secret scan is clean
- [ ] No confidential data, real names or contact details committed

## Open Questions
None. All decisions are from the decision log and MEMORY.md.

## Status
**READY** — All spec and decisions are clear. Plan is scoped to one phase (~40 builder calls updating agent guidance text). All files are risky paths requiring security-reviewer and logged as risk: high.

## Lead answers (20 Oct 2026)
These override the change list above where they differ.
- **Keep the named-human rule for platform content.** MVP first lets the lead sign **eval cases** only (`reviewed_by: lead`). Prompt packs, skill templates and persona templates still need a named human's sign-off (rule 7). Don't remove that from any agent file.
- **safety-reviewer.md line 3.** Replace "Never gives final approval; it prepares the human sign-off." with: "Never gives final approval: the team lead decides the merge. Prompt packs and templates still need a named human's sign-off."
- **safety-reviewer.md line 10.** Keep the rule-7 clause, scoped to prompt packs, skill templates and persona templates. Add that eval cases may be signed by the lead during the MVP.
- **safety-reviewer.md lines 44–46.** Heading "## For the lead". Replace "HUMAN APPROVAL REQUIRED (build plan rule 6)." with: "The lead decides the merge (rule 6). Prompt packs and templates also need a named human's sign-off (rule 7)."
- **pedagogy-author.md.** Drafts still need a named human reviewer. Only add the English-only pilot note. Don't add speculation about future multi-language support.
- **eval-author.md.** English only. Safety and guard cases keep Hindi, Devanagari and Hinglish inputs as a safety net. Use `reviewed_by: lead` during the MVP, and never a person's name.
- Don't touch `.claude/settings.json` or `.claude/hooks/*`.
