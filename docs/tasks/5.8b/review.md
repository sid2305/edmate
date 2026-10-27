# 5.8b review — APPROVE

Reviewers: architect, security-reviewer, typescript-reviewer, code-reviewer

## Findings
- [HIGH] [fixed] docs/adr/0013-roleplay-state.md — the Consequences "Coverage gate" bullet listed `ended` both as skipping and as meeting the gate (code-reviewer, typescript-reviewer, architect)
- [HIGH] [fixed] docs/adr/0013-roleplay-state.md — four places still said "pending human answer B-37" although the human answered B-37 on 21 Oct 2026 (architect)
- [MEDIUM] [fixed] packages/harness/src/pedagogy/skills.ts — pauseHasExtraText treated `/pause.` and `/pause!` as a pause with extra text (code-reviewer, security-reviewer)
- [MEDIUM] [wontfix] packages/content/src/personaTemplates.ts — readPersonaTemplateDir gained no throw; it collects issues by design, and the one throw in readPersonaLibrary is now a typed PersonaTemplateError (architect, resolved on re-review)
- [LOW] [deferred 5.8f] packages/harness/src/pedagogy/skills.ts — SkillInput's rolePlayStep and rolePlayStepPersonaId are two independent optional fields; join them into one (typescript-reviewer)
- [LOW] [wontfix] packages/harness/src/pedagogy/policy.test.ts — the B-37 row tests live in policy.test.ts, not roleplay.test.ts as planned; logged as a lead decision (code-reviewer)
