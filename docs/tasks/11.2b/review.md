# 11.2b review — APPROVE

Reviewers: security-reviewer (sonnet), lead

The security-reviewer read the student question route (`POST /api/live-classes/[id]/questions`), its new policy row, the /home ask form and the teacher's pre-class queue view. Authorization holds: 11.2a's `submit()` re-checks entitlement, class ownership and start time inside one locked transaction, every miss collapses to one generic `not_found`, the teacher scope comes from the session, and the queue carries no student id. Student text renders as plain React text (a hostile-markup test proves it), the body is a strict zod object with length and raw-byte caps, and errors return fixed messages. The new policy row is one exact pattern, one method, and widens nothing. One HIGH was found and fixed in a fresh fix round; the lead read the fix diff and its red-then-green test.

## Findings
- [HIGH] [fixed] apps/web/app/home/view.tsx — `AskQuestionForm` (a client component using `useTranslations`) had no `NextIntlClientProvider` ancestor, so /home would crash for a student with an upcoming live class; now wrapped like the teacher live-classes page, covered by `view.intl.test.tsx`.
