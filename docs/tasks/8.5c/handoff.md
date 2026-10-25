# 8.5c handoff (closed by the lead, no code)

**Status:** DONE

## What changed
Nothing in code. The three LOWs deferred from docs/tasks/8.5a/review.md are closed with a reason:

- **Composite (teacher_id, agent_id) index for listForAgent.** Not needed. The finding asks for it "if a bulk path uses it", and none does: the only caller is the teacher test-chat page, one agent at a time.
- **AGENT_PACKAGES_MAX truncates silently.** It can't truncate. `packages.create` caps a teacher at `PACKAGES_MAX` (20) packages across all agents, so `listForAgent` returns at most 20 rows against a limit of 100. A test at the cap can't be built without breaking the create cap.
- **teacherNoteParts runs twice in corrections.record.** It stays. `record` needs the trimmed parts of both texts (right and wrong) before the transaction. `insertTeacherNote` is shared with `chunks` and `teacherQuestions.answer` and must validate its own input, and the second call costs two string trims.

## Decisions

### 25 Oct 2026 · 8.5c closed without code · decided by lead · risk: low
- Decided: close the three 8.5a LOWs (composite packages index, AGENT_PACKAGES_MAX truncation, double teacherNoteParts) with no code change; if PACKAGES_MAX is ever raised above AGENT_PACKAGES_MAX, listForAgent must refuse (invalid) instead of truncating, like MODULE_CHUNKS_MAX.
- Why: no bulk path reads listForAgent; the per-teacher PACKAGES_MAX cap of 20 means the limit of 100 can never cut a list; and insertTeacherNote's own check is the shared helper's guard for its other callers, costing two string trims.

## Budget
Tool calls used: 0 (lead closure)
