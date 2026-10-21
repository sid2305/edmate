# 6.2 review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet)

## Findings
- [HIGH] [fixed] packages/db/src/repositories/ports.ts:105 — applyEvidence appended and folded in two transactions, so a rebuildMastery between them double-counted an event. Fixed in round 1: `evidenceEventsRepo.appendAndFold` locks the learner_profiles row before inserting and folds in the same transaction. A concurrent race test was added; typescript-reviewer verified.
- [MEDIUM] [fixed] packages/db/test/profile-store.int.test.ts:280 — the rebuild-vs-incremental agreement was not really tested (it compared with the same fold helper). It now replays the events through applyEvidence on a second scope and compares the result with rebuildMastery.
- [MEDIUM] [deferred 6.2a] packages/db/src/repositories/learner.ts:243 — rebuildMastery holds the profile row lock for the whole unbounded replay, with no (teacher_id, student_id, ts) index. Fine at pilot scale with no operational trigger; revisit before one is added.
- [LOW] [fixed] packages/db/src/repositories/learner.ts:263 — `locked!` replaced by an explicit RepositoryError guard.
- [LOW] [deferred 6.2a] packages/db/src/repositories/learner.ts:180 — applyEvidenceMastery still uses `locked!`.
- [LOW] [deferred 6.2a] packages/db/src/repositories/learner.ts:267 — document that a rebuild is a snapshot as of lock acquisition.
- [LOW] [deferred 6.2a] packages/db/test/repositories.int.test.ts:1120 — the isolation-grid case uses a Date.now()-based ts, because isolation-seed's evidence row has no explicit ts.
