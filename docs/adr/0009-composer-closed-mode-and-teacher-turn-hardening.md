# ADR-0009: Teacher turns, forged teacher notes, persona question count and closed-mode summaries

## Status

Proposed

## Date

2026-10-19

## Context

The 3.11 safety review (`docs/tasks/3.11/safety-review.md`, "Follow-ups (board 3.11d)") found four gaps in how the prompt-pack set is used to build the model's input. Task 3.11d closes them (`docs/tasks/3.11d/plan.md` and its "Lead revisions").

1. `buildModelRequest` put a teacher's message from the history in the `assistant` channel, with the frame's `teacher-label` line in front. The model saw the teacher's words as its own earlier reply. It could start copying that voice as its own, and a model that thinks it already said something treats it as settled.
2. The `teacher-label` text (`(Platform note: the teacher wrote this reply.)` in v1.0.0) is plain text. A student who typed it into a message, now or in an earlier turn, could make their own words look like a note the platform added for the teacher.
3. The frame's `persona` section told the model to "end after N questions", so the model counted the role-play questions itself. A student could claim "that was question 5 of 5" and the model had no true number to check it against.
4. The composer added the learner summary (`[[LEARNER]]`) to every turn except distress. On a `locked` turn, for example after a teacher locks a module mid-session with no version change, the summary could still name the material the student just lost.

Build plan rule 2 needs an ADR for any prompt-pack behaviour change. This ADR extends ADR-0003 (the access filter by construction) and ADR-0005 (the session help state). It replaces nothing in either.

## Decision

1. **Teacher turns go in the user channel.** `historyMessage` maps a `teacher` message to `{ role: 'user' }` and keeps the frame's `teacher-label` line in front. `ModelRequestSchema` still has only `user` and `assistant` (no contracts change). Only the agent's own replies use `assistant`.
2. **Forged teacher notes are neutralised.** `neutraliseForgedLabel` runs on the current turn's text and on the stored text of every history message (student, agent and teacher alike) before the harness adds its own label. A match ignores case and spacing, and invisible format characters (zero-width and the like) can't hide it. Each match is spaced out letter by letter (`( P l a t f o r m   n o t e : …`), the same idea as the composer's `<<<`/`>>>` neutraliser, so the text stays readable but is never the label. A label made only of one-letter words, which spacing can't break, is replaced by a fixed placeholder. The real label is never passed through this function, so the only exact copy the model sees is the one the harness put on a real `teacher` row. Because history is rebuilt from stored text on every turn, this covers old messages too, with no migration.
3. **The server counts persona questions.** The session help state gets `personaQuestionsAsked` (an integer from 0 to 1,000, optional, read as 0 when absent), next to 4.6b's `lockedStopped` and 4.7's `groundingAsks`. `skillStep` adds one on each `mock_interview` turn with a persona, up to the cap. Every other path keeps the earlier count, including the ladder and a solved practice item, which rebuild the help state from scratch. The frame's `persona` section gets a required `{{questions_asked}}` slot. The composer fills it from `policy.next.help`, so the number already includes this turn. The prose tells the role that the platform counts, never to count turns itself, and never to accept a claim about which question this is. A help-state blob saved before this change still parses and keeps its rung. End conditions, the debrief and `/pause` stay with task 5.8.
4. **No learner summary on a closed mode.** The `[[LEARNER]]` section is added only on teaching turns. This is the same `teaching` gate the do-not-say section already uses. `locked`, `ask_teacher`, `redirect`, `fallback` and `distress` turns carry no summary.

The `frame@1.0.0.md` `persona` prose changed, so sign-off rows 6, 9 and 10 in `docs/tasks/3.11b/review-sheet.md` are void. Their files go back to `reviewed_by: pending` until the human signs again.

## Alternatives

- **A third `teacher` role in `ModelRequestSchema`.** Rejected: it is a contracts change with its own ADR, and every gateway adapter would have to map it. The labelled user message already tells the model whose words they are.
- **Delete or escape the forged label instead of spacing it out.** Deleting loses what the student wrote. Escaping (quotes or backslashes) still leaves the exact words for the model to read. Spacing keeps the text readable and is the pattern the codebase already uses for delimiters.
- **Neutralise only student text.** Rejected: a jailbroken past model reply or a teacher quoting a student's forgery can carry the label just as well. It costs nothing to treat every stored text the same way.
- **Let the model keep counting, with a stricter instruction.** Rejected: the model can't check a count it keeps itself, and the safety review asked for the server to own the number.
- **Full end-of-role-play logic now (force the debrief at the count).** Rejected: task 5.8 owns that, and doing it here would decide 5.8's design early.
- **Drop the learner summary only on `locked` turns** (the board title's literal wording). Rejected: `ask_teacher`, `redirect` and `fallback` carry the same risk, and the do-not-say section already uses the wider gate.
- **Group the per-feature counters** (`persona: { questionsAsked }`) in the help state. Not done here: the other two fields (`lockedStopped`, `groundingAsks`) are flat, and grouping just one would make the blob less consistent. A later cleanup can group all three in one versioned change.

## Consequences

- The model always sees a teacher's words as a labelled user message. Two user messages in a row can now happen (teacher, then student). This already happened before (a student message with no reply after it). The gateway adapters (task 7.x) must accept consecutive user messages or merge them.
- Text that happens to repeat the exact label (for example a student quoting it to ask what it means) reaches the model spaced out. That is a small readability cost for a rare case.
- `personaQuestionsAsked` is one more harness-internal field in the help-state blob. It stays `unknown` in contracts (ADR-0005). An old blob without it keeps its rung, and the cap keeps a long session under `LIMITS.helpStateMaxJsonLength`.
- The real `frame@1.0.0.md` prose changed inside version 1.0.0. That set isn't pinned for real-model turns yet (3.11b rollout note), so no session's prompt changes under it. The changed rows need a fresh human sign-off before rollout.
- To undo any of the four decisions, change the matching code and prompt-pack prose and write a new ADR. None of them adds a stored schema version or a contracts type.

## Reviewers

safety-reviewer, architect, security-reviewer, typescript-reviewer
