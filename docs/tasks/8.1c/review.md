# 8.1c review — APPROVE

Reviewers: security-reviewer (sonnet, also as typescript-reviewer and code-reviewer), lead

`teacherProfiles.update` resets the status inside the same UPDATE: a CASE compares the row's current subject (read under the UPDATE's own row lock) with the new, bound subject, so there is no read-then-write window. `create` and `update` are the only writers of `subject`, and the strict `UpdateInput` schema has no `verificationStatus` key, so a teacher can't set the status through the patch. Bio-only, languages-only and same-subject edits (including surrounding whitespace) keep the status; db integration tests cover each case. The lead accepts the builder's decision that a rejected teacher who changes subject goes back to pending: it only puts them back in the staff queue and grants no publish right, because publishing still requires `verified`. The onboarding hint shows in edit mode only and is wired through `aria-describedby`.

## Findings

None.
