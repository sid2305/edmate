# 4.5c: answerLeak follow-ups

No planner for this sub-task: the spec is safety-reviewer's deferred list from `docs/tasks/4.5/review.md` and `docs/tasks/4.5/safety-review.md`. Full evidence, changes and decisions are appended under the `## 4.5c` section and the `## Decisions` entries in `docs/tasks/4.5/handoff.md` (the merge gate maps this lettered sub-task to the parent's docs).

Status: DONE.

Branch: `m4/4.5c-answerleak-followups`
Worktree: the agent's assigned worktree for this task

## Summary

1. "baar"/"times" are weak markers for a one-digit key's answer context: only count next to a run/print verb, never before an imperative.
2. No own-code exemption when the student's message offers two or more code lines that differ only at the key.
3. Added spelling variants (baiyaalis, byalis, beyalis for 42; unatees for 29) and spoken fraction, percentage and digit-by-digit decimal forms.
4. Confirmed `CommitRecord.escalatedText` never reaches history or a later turn's model request (no code change needed in `commit.ts`; added an end-to-end test).

See `docs/tasks/4.5/handoff.md` → `## 4.5c` for acceptance evidence and the full list of changed files, and its `## Decisions` for the four decisions this sub-task logged.

## Decisions

None
