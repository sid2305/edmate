# 6.3d review — APPROVE

Reviewers: security-reviewer, database-reviewer, typescript-reviewer, code-reviewer

## Findings
- [LOW] [wontfix] ports.ts (packages/db/src/repositories/) resolveMistakeTagAllowList repeats the session → agent version → style card lookup that turnConfigStoreFor.load already did this turn; the frozen ProfileStore.applyMistakes signature (ADR-0017) leaves no way to pass it in (database-reviewer).
- [LOW] [wontfix] ports.ts (packages/db/src/repositories/) the session is resolved regardless of endedAt, so a tag write racing session end still lands; this is the plan's choice and is logged (database-reviewer).
- [LOW] [deferred 6.3e] ports.ts (packages/db/src/repositories/) applyMistakes declares two of the interface's three parameters; name the third _proposed so the omission reads as intentional (typescript-reviewer).
- [LOW] [deferred 6.3e] profile-store.int.test.ts (packages/db/test/) no case passes a non-empty proposed array to applyMistakes (typescript-reviewer).

## Fix round 1

CI on PR #379 failed the db coverage gate (src/repositories/** at 100%): the two integrity throws in `resolveMistakeTagAllowList` (ports.ts, missing agent version, missing style card) were untested. The fixer added two int cases in profile-store.int.test.ts that drive each throw and check nothing is written. Test only, no source change; the lead read the diff.

## Verdict
Pass. code-reviewer and security-reviewer found nothing. security-reviewer noted, for information, that no int test uses a real session id from another pair; sessions.get's scope filter covers that path.
