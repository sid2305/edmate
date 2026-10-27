# ADR-0017: Mistake-tag port extension

## Status

Proposed (27 Oct 2026). Task 6.3c Phase A. Reviewed by architect, security-reviewer and typescript-reviewer; the lead approves and logs it `risk: high`.

## Date

2026-10-27

## Context

- Build plan line 444: "tags from the teacher's list of common mistakes, plus auto-proposed tags the teacher approves; never a tag outside the list." Task 6.3 shipped `classifyMistakeTags(candidates, allowedTags)` (`packages/harness/src/memory/mistakeTags.ts`), a pure function that splits candidate mistake-tag observations into `known` (members of the teacher's list) and `proposed` (not members). It has no live caller anywhere in the codebase: 6.3 shipped the classification logic deliberately without one, and 6.3a's own plan (`docs/tasks/6.3a/plan.md`) documented the gap as open ("where a real `applyMistakes` caller gets `allowedTags`").
- 6.3b shipped `learnerProfilesRepo.applyMistakes(scope, patch, allowedTags)` (`packages/db/src/repositories/learner.ts`): it merges known mistakes into a profile under row lock, re-validates every tag against `allowedTags`, and enforces length caps. It also has no caller: `packages/db/src/repositories/ports.ts`'s `profileStoreFor` does not expose it on `ProfileStore` yet.
- No mechanism anywhere classifies free text into mistake tags; this task's "candidate tag" is a content-author-set field on a practice item (like `topicId` already is), not a model or keyword classifier.
- `ProfileStore` (`packages/contracts/src/ports.ts`) is a type-only port (ADR-0002); it is frozen except by ADR. 6.3c needs to add a caller for the already-shipped classification and repository methods, which means extending this port.
- This task is split into two phases: Phase A (this ADR, `packages/contracts` + `packages/harness`) and Phase B (`packages/db` + app adapters, a separate task run). Phase A must ship and gate green on its own, without breaking every existing structural implementer of `ProfileStore` across the harness test suite and the db/app adapters, before Phase B lands.

## Decision

1. **Two new, optional `ProfileStore` methods.** `packages/contracts/src/ports.ts`'s `ProfileStore` gains:

   ```ts
   interface ProfileStore {
     get(studentId: string, teacherId: string): Promise<LearnerProfile>;
     applyEvidence(e: EvidenceEvent[]): Promise<LearnerProfile>;
     applyMistakes?(
       scope: { studentId: string; teacherId: string },
       known: LearnerProfile['mistakes'],
       proposed: LearnerProfile['mistakes'],
     ): Promise<void>;
     recordProposedMistakes?(
       scope: { studentId: string; teacherId: string },
       proposed: LearnerProfile['mistakes'],
     ): Promise<void>;
   }
   ```

   Both are optional methods on an existing interface, not a new port and not a new Zod schema: `LearnerProfile['mistakes']`'s element shape (`{ tag, count, lastSeen }`) is already a registered contracts type, structurally identical to `classifyMistakeTags`'s `known`/`proposed` outputs, so no new contracts type is defined.
2. **Why optional, not required.** Making either method required would be a breaking change to every structural implementer of `ProfileStore` in the same PR: the harness test suite's `MemoryProfileStore`, `packages/db`'s `profileStoreFor`, and every app's no-op/in-memory adapter (`apps/worker/src/gate/ports.ts`, `apps/web/src/studio/testChat/deps.ts`, `apps/cli/src/commands/chat/deps.ts`, `apps/web/test/turn-backend.ts`). Optional methods let Phase A (this ADR plus the harness producer and `commit.ts`'s caller) ship and gate green alone; Phase B then wires the real adapters. `commit.ts` calls through the optional-chain (`profiles.applyMistakes?.(...)`), so an implementer that hasn't landed Phase B yet is a safe no-op, not a crash.
3. **Why on `ProfileStore`, not a new port.** The teacher's "list of common mistakes" and the classification result are learner-profile data, the same shape `applyEvidence` already writes; a new port would duplicate the scope type (`{ studentId, teacherId }`, already `applyEvidence`'s implicit scope) and give `commit.ts` a second profile-writing seam to call in the right order.
4. **The caller.** `packages/harness/src/pipeline/runner.ts` gains a private `mistakesFor(e, ctx)` method, parallel to the existing `evidenceFor` (6.4a): fires only when `ctx.attempt === 'wrong'` and the turn's skill is `'practice'`; reads the loaded help state's new `practiceMistakeTag` field; classifies it with the already-shipped `classifyMistakeTags` against `e.styleCard.mistakeTags` (the only runtime-queryable "teacher's list" today, per 6.3's own Q1); attaches the result to two new `CommitRecord` fields, `mistakesKnown?`/`mistakesProposed?` (both `LearnerProfile['mistakes']`, harness-internal, not a contracts change). `packages/harness/src/pipeline/steps/commit.ts` calls `profiles.applyMistakes?.(scope, known, proposed)` and, when `proposed` is non-empty, `profiles.recordProposedMistakes?.(scope, proposed)`.
5. **Candidate-tag source.** `PracticeItem.mistakeTag?: string` (`packages/harness/src/tools/practiceItems.ts`) is a content-author-set field, exactly like `topicId` already is -- never a classifier output. It threads through `IssuedItem.mistakeTag?` (`packages/harness/src/pipeline/tools.ts`) and `HelpState.practiceMistakeTag?` (`packages/harness/src/pedagogy/helpState.ts`), mirroring the existing `topicId`/`practiceTopicId` thread exactly (same optionality, same carry-over rules in `practiceFields`/`copyHelp`).
6. **Phase B (not this ADR's code, recorded here for the whole port surface).** `packages/db/src/repositories/ports.ts`'s `profileStoreFor` implements `applyMistakes` by calling the already-shipped `learnerProfilesRepo.applyMistakes(scope, known, allowedTags)`; `recordProposedMistakes` there is a documented no-op until 6.3a lands the real `mistake_tag_proposals` persistence (6.3a's own deps list already include 6.3c). No-op/in-memory implementations also land in the three apps' adapters and `packages/harness/src/testing/memoryPorts.ts`.

## Alternatives

- **A new `MistakeStore` port.** Not chosen: it would duplicate the `{ studentId, teacherId }` scope `ProfileStore` already carries and give `commit.ts` a third profile-writing seam alongside `applyEvidence`, for data that is conceptually part of the learner profile.
- **Required (non-optional) methods.** Not chosen: breaks every structural `ProfileStore` implementer in the same PR Phase A ships, forcing Phase A and Phase B to land atomically across `packages/contracts`, `packages/harness`, `packages/db` and three apps -- the opposite of this task's two-phase split (lead answer, sequencing).
- **One method taking only `known`, with `proposed` handled entirely by a future 6.3a port.** Not chosen: the design keeps `applyMistakes` taking both `known` and `proposed` (so a single classification call's full result is visible to one method's caller for logging/testing), while `recordProposedMistakes` is the separate persistence seam 6.3a will implement for real; this keeps `commit.ts`'s call shape stable once 6.3a lands, needing no further port change.
- **A keyword/model classifier for candidate tags.** Not chosen (out of scope): no such mechanism exists yet anywhere in the codebase; this task's candidate tag is a content-author-set field on a practice item, the same pattern as `topicId`.

## Consequences

- `packages/contracts`'s `ProfileStore` export changes (additive only: two new optional methods). Every existing structural test double across the harness test suite keeps typechecking unchanged (verified by Phase A's gate).
- `packages/contracts/test/spec-types.ts`'s `ProfileStore` spec type is updated to match, so the type-equality test (`types.test.ts`) stays accurate to the real port.
- Phase B (a separate task run) wires `packages/db`'s real adapter and the apps' no-op/in-memory adapters; until it lands, `applyMistakes`/`recordProposedMistakes` are safe no-ops everywhere outside the harness's own test doubles.
- `recordProposedMistakes`'s db-side persistence is a documented no-op in `packages/db` until 6.3a lands the real table and write path; nothing is lost in the meantime, since `applyMistakes`'s own classification already ran and the known half is durable (lead answer Q3).
- **Rollback:** Phase A adds an optional-method port extension and a harness-internal producer/consumer that call it only on a non-empty result; reverting it is free (no required caller, no migration, no data written anywhere until Phase B's real adapter lands).

## Reviewers

architect, security-reviewer, typescript-reviewer. The lead approves and logs it `risk: high`.
