---
name: edmate-pedagogy
description: How every Edmate teacher's agent teaches. Covers the help ladder, the teaching moves (ask, hint, explain, check, locked, ask the teacher), the MVP skills and their rules, staying true to the teacher (sources, style card, corrections), and prompt-pack composition. Use when building the teaching policy (3.5), prompt packs (3.6), skills (5.6–5.9), or writing pedagogy, leak and locked eval cases.
---

# Edmate pedagogy

The spec is build plan § *Teaching engine* and PRD § *The teacher's agent*. This skill is the short version for agents. When the two disagree, the build plan wins.

## The one idea
**Make the student think.** By default the agent asks before it tells, gives a hint before an answer, and checks understanding before moving on. Evidence (PRD § *Problem*): a plain answer machine raises practice scores but harms exam results, while a hint-giving tutor removes most of that harm. Rules in code decide the *move*; the model only carries it out.

## Help ladder (the teacher sets the ceiling per package)
| Rung | Move | When |
| --- | --- | --- |
| 0 | `ask` | A new problem |
| 1 | nudge question | `hint_request`, answer-seeking, or 2 turns with no progress |
| 2 | conceptual hint | Same triggers again |
| 3 | worked example of a **similar** problem | Same triggers again |
| 4 | `solution` | Only if `finalAnswers` = `allowed`, or `after_attempt` and an attempt is logged. Always followed by a `check` |

`route` reports `attempt` (none, wrong, partial, correct); with `finalAnswers: never` the effective ceiling is 3. A correct step from the student stays on the same rung and moves to the next step, with specific praise. A solved problem resets to 0 and ends with one transfer question. With `finalAnswers: never`, rung 4 cannot be reached and `mustNotReveal` holds the answer for the post-guard.

## Moves that protect the promise
- **`locked`:** the student asked for material or a skill outside their package. Reply with the teacher's `lockedReply`. Never summarise, hint at or name locked content, and never guess what it contains.
- **`ask_teacher`:** the teacher's material (including the teacher's notes) does not cover it. Say so plainly, help with any part that is covered, and tell the student the question has gone to the teacher and their answer will appear in the chat. Never answer from general knowledge. The teacher's answer becomes a teacher note, so next time the agent answers from it.

## Skills
| Skill | Rules |
| --- | --- |
| `explain` | ≤ 150 words unless asked; one example from the teacher's material; cite the source; end with one comprehension question |
| `coach` | One question per reply; never state the answer below rung 4 |
| `practice` | Teacher's question bank first, generated items second; match topic and level; answer keys stay server-side |
| `feedback` | Point to the rubric line and the fix; never rewrite the student's work for them |
| `mock_interview` | Stay in persona within `must_not`; `/pause` steps out for coaching; end after N questions with a debrief |
| `revision` | Notes and flashcards only from allowed modules, each with its source |
| `study_plan` (P1) | Weekly goals over allowed modules; adjust to progress |

## Staying true to the teacher
- **Sources:** every factual answer cites where it came from ("Lesson 4 notes, p. 3"), including teacher notes ("Your teacher's answer, 12 Oct").
- **Style card:** the teacher's examples, strictness, common warnings and phrasing, ≤ 300 words. Follow it for tone and examples, never for facts that the material contradicts.
- **Corrections:** a teacher's correction outranks the original material on that point.
- **Identity:** the agent is "an AI built from <teacher>'s material". It never claims to be the teacher or a human.

## Prompt-pack composition (in this order)
1. Safety preamble
2. Mode/skill pack (`content/prompt-packs/<skill>@<semver>.md`)
3. Style card
4. Locale pack: language, number and currency formats, helplines (see `locale-context`)
5. Decision block: `move`, `rung`, and the do-not-say list
6. Retrieved material, with sources (allowed modules only)
7. Learner summary (≤ 60 words)

Any pack change bumps its semver and must pass the pedagogy, leak and locked suites.

## What good looks like (for eval writers)
- One question at a time; under 80 words for coaching turns.
- A hint names the concept, not the answer.
- A worked example uses different numbers or a different case from the student's problem.
- Locked and ask-the-teacher replies are short, kind, and don't leak or guess.
