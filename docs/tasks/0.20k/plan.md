# Task 0.20k — walkthrough Save-button timeout on the at-cap path

Status: READY (small plan written by the lead, 27 Oct 2026)

## Acceptance (verbatim, `docs/board/tasks.yaml`)
teacher-packages-walkthrough.spec.ts passes 5 fresh local runs against next dev starting with the teacher already at PACKAGES_MAX, and 5 starting empty; apps/web typecheck, lint and test green.

## What we know
- 0.20j's fix round 1 ran the spec 6 times. Run 1 timed out waiting for `getByRole('button', { name: 'Save' })` on the reuse/edit branch of `createOrRenamePackage` (apps/web/e2e/teacher-packages-walkthrough.spec.ts:39–64). The call log shows only "waiting for", no intercepted click. Runs 2–6 passed. See docs/tasks/0.20j/handoff.md, "## Fix round 1".
- The reuse branch only runs once the demo teacher has `PACKAGES_MAX` (20) packages, which CI never reaches. So it is barely exercised, and its "Edit" → "Save" locators were written from reading the code, not from a run.

## Steps
1. **Reproduce first.** Bring the local demo teacher to the cap through the app's own flow: run the spec repeatedly, or use a small seed helper in apps/web/e2e that creates packages through the repository (`@edmate/db`, the same way fixtures.ts opens the database). Never use psql or docker. Then run the spec and capture the failure: the trace, the call log, and what the edit form renders.
2. **Find the real cause** from the trace. Candidates to check, not guesses to apply:
   - the edit form's submit button has a different accessible name;
   - the edit form opens somewhere the locator can't see (a dialog, another route, or a collapsed panel);
   - more than one "Save" button exists;
   - the Edit button picks a package whose form never opens.
3. **Fix in the spec** (apps/web/e2e) if the spec's locators are wrong. If the app itself is wrong (for example, the edit form never renders a submit button), stop and report BLOCKED with the evidence. Don't change apps/web/src or app/ without the lead.
4. Prove the acceptance: 5 fresh runs at the cap and 5 starting empty. "Empty" means a teacher under the cap. If there is no clean way to get under the cap without deleting rows, use a fresh teacher id the spec creates. Write how you did it in the handoff.

## Files
- apps/web/e2e/teacher-packages-walkthrough.spec.ts
- apps/web/e2e/fixtures.ts (only if a seed or fresh-teacher helper is needed)
- docs/tasks/0.20k/handoff.md

## Files out of bounds
apps/web/src/**, apps/web/app/**, packages/**, .github/**, .claude/**.

## Risky paths touched
None.

## Budget
Budget: 45 tool calls (1 phase)

## Exit conditions
DONE with the 10 runs recorded, or BLOCKED with the trace evidence if the cause is in app code.
