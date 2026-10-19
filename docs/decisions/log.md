# Edmate decision log

Every decision the spec did not already make, in plain words, newest first. Agents write entries in their task's handoff, and the team lead copies them here when the PR merges. Your own decisions are logged too.

- **risk: low** · the agent decided and moved on
- **risk: medium** · the agent or lead decided; worth a skim
- **risk: high** · you decided, or the lead merged a risky change (contracts, ADRs, safety, access, payments, the harness) after its required reviewers; skim these first

Format and rules: `.claude/skills/merge-gate/SKILL.md`.

---

### 19 Oct 2026 · Repeated jailbreak strikes: stricter checks and a trust-team notice, no pause · decided by human (B-12) · risk: high
Decided: after 3 strikes in one session, the rest of that session gets stricter checks and the trust team gets one notice. The student is not paused, locked out or punished. Built as task 4.4e.
Why: repeated attempts are a signal worth a human look, but a 13+ learner poking at the rules should not lose access.
Alternatives: pause the session after N strikes; count only, with no consequence.
Reversible: Yes.

---

### 19 Oct 2026 · Distress alerts go by SMS to the on-call phone with email backup · decided by human (B-13) · risk: high
Decided: a distress alert is an SMS to the on-call phone plus an email backup (e.g. Twilio and Resend), re-paging every 15 minutes until someone acknowledges it. Revisit a paging service once there is a real on-call rota. Built in task 4.3c, behind a notifier port.
Why: the pilot needs a real person reached within minutes, without the cost and setup of a paging service for a one-person rota.
Alternatives: a paging service (PagerDuty or Opsgenie); email only; a chat app alert.
Reversible: Yes.

---

### 19 Oct 2026 · Crisis replies stay in English for the pilot · decided by human (B-14) · risk: high
Decided: a distressed student who writes in Hindi or Hinglish is still detected (the safety net), but the caring reply and helpline text stay in English for now. Decide after the pilot whether crisis replies follow the student's language.
Why: the pilot is English-only; a translated crisis reply needs human-verified wording and helplines first.
Alternatives: a Hindi crisis reply now; mirror the student's language.
Reversible: Yes.

---

### 19 Oct 2026 · 4.3 gets one more narrow fix round · decided by human (B-16) · risk: high
Decided: a third fix round on distress detection, limited to the HIGH (the game-talk exemption must never downgrade first-person intent or abuse) and the two MEDIUMs (coding text paging on-call; "I have the pills ready" relying on the classifier), then a re-check.
Why: rounds 1 and 2 fixed what they targeted; the remaining fix is small and well-defined, and the keyword approach is working.
Alternatives: only the HIGH now, MEDIUMs later; stop and rethink the keyword approach.
Reversible: Yes.

---

### 19 Oct 2026 · 4.5c "baar"/"times" are weak markers: a run verb next to them, never an imperative · decided by tdd-guide (safety-reviewer's deferred list) · risk: high
Decided: `numbers.ts` drops "baar"/"times"/"बार" from the always-on answer-word set and instead checks the token right next to them: it counts only when a run/print verb (chalega, chalegi, chalti, chalta, runs, prints, print, executes, execute, loops, loop, चलेगा, चलेगी, छपेगा) is adjacent, never when an imperative (karo, padho, socho, dekho, try, read, likho) is — the imperative check wins over a run verb on the other side, so "do baar chalega, socho" still never counts. "Ek baar try karo" and "Do baar socho" (an imperative right next to the count word) no longer trip a one-digit key; "Loop teen baar chalega" and "It runs three times" (a run verb right next to it, or a run-verb marker elsewhere in the sentence) still do.
Why: a bare count word ("ek baar", "do baar", "X times") is ordinary lesson Hinglish; only a verb that names the code running or printing turns it into an answer.
Alternatives: drop the markers to zero context (misses genuine "teen baar chalega" leaks); keep them unconditional (the false positives this task was opened for).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5c No own-code exemption when the student offered two code lines that differ only at the key · decided by tdd-guide (safety-reviewer's deferred list) · risk: high
Decided: before granting a code-shaped key the own-code exemption, `compileAnswerKeys` now also checks whether the student's message holds a second line, also clearly code, that is identical to the key's line except for a span covering the key (`if s.upper()...` next to `if s.lower()...`). If so, the key is never exempted (confirmation words or not): the student offered two options and picked neither yet, so quoting one back is still a leak. A single quoted line with no alternative stays exempt, as does a line the student repeated verbatim (not "two options").
Why: the fix-round-1 exemption (a clearly-code line, confirmed-context aside) let a tutor's "Keep s.lower()" through once the student had typed both branches as code, which is still telling the student the answer.
Alternatives: require the confirmation-word list to catch "keep"/"pick"/"wala lagao" too (an open-ended word list, always behind); drop the own-code exemption whenever the message holds more than one code line regardless of content (would also block a student who fixed a typo and resent the same line).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5c Spelling variants and spoken fraction, percentage and digit-by-digit decimal forms · decided by tdd-guide (safety-reviewer's deferred list) · risk: medium
Decided: `baiyaalis`/`byalis`/`beyalis` (42) and `unatees` (29) are added to the Hindi-Latin 21-99 table as explicit spellings, since `latinFold` folds them to a different value than the table's own spelling for 42/29 (the table's "never guess" rule means a fold collision is dropped, not guessed, so these needed listing by hand, not a fold change). `numbers.ts` also now reads spoken fractions ("five sixths", "5 out of 6"; numerator/denominator each one number word or digit), a percentage ("83%", "83.5%"; over 100, at its own written decimals plus two) and a decimal read digit by digit ("zero point eight three"; one number word for the whole part, then digit words after "point"), each matched against a key at the existing fraction/decimal precision rules (unchanged).
Why: these are ordinary ways a tutor or student would say a fraction, percentage or decimal answer, and the matcher already has the precision rules to compare them; only the forms that reach those rules were missing.
Alternatives: a judge model for paraphrase generally (4.5b, needs a live model, out of scope here); support multi-word whole parts for spoken decimals ("twelve point five") — narrowed to one word to avoid a greedy regex swallowing unrelated preceding prose ("the point eight three").
Reversible: Yes.

---

### 19 Oct 2026 · 4.5c `CommitRecord.escalatedText` was already out of history and the model; added the round-trip test · decided by tdd-guide (safety-reviewer's deferred list) · risk: high
Decided: no code change to `commit.ts` was needed — it already persists only `record.replyText` to the transcript store, never `record.escalatedText`. Added `runner.escalatedText.test.ts`: a real postGuard-escalate turn runs the real `commit` step against a real in-memory transcript store, then a real `buildContext` call (and a full second turn through the real `buildContext` and `generate` steps, with a scripted-gateway spy) confirms the escalated text is absent from the transcript store, from the next turn's `history`, and from the next turn's `ModelRequest`s.
Why: the safety review flagged this as still open; verifying it end to end (not just that `commit`'s own unit test omits the field) is what "never reaches a later turn's model request" means.
Alternatives: trust the existing `commit.test.ts`/`runner.answerLeak.test.ts` coverage (neither drives a second turn's `buildContext`/`generate` off a real transcript store, so neither proves the field can't leak back in through history).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5c fix round A spoken fraction, "out of", percentage or spoken decimal needs an answer context whatever the key's length · decided by build-error-resolver (PR #53 follow-up) · risk: medium
Decided: `numbers.ts` marks a mention from `FRACTION_WORDS`, `OUT_OF`, `PERCENT` or `SPOKEN_DECIMAL` as `weak`; `answerKey.ts`'s leak check now requires an answer context for a weak mention no matter how long the key's canonical value is, instead of letting any key longer than one digit through unconditionally. "83% of students passed the test." (key `0.83`) and "5 out of 6 tests passed." (key `5/6`) no longer trip; "the answer is five sixths" and "it's 83%" still do, same as a one-digit key's words and arithmetic already worked.
Why: these four forms are new enough (4.5c, this same task) that the house's existing one-digit answer-context rule had not been extended to them, and a bare "83% of students passed" or "5 out of 6 tests passed" is ordinary lesson/word-problem text, not an answer.
Alternatives: keep the key-length rule and widen the one-digit exception to "any key whose value came from one of these four forms" (same effect, more roundabout: ties the rule to the key instead of the mention, which is what varies); require context only for percentage and spoken-decimal, not spoken fraction/"out of" (inconsistent — all four are equally ordinary word-problem phrasing).
Reversible: Yes.

---

### 19 Oct 2026 · 3.14 No ADR; Redis over Postgres; harness-owned `TurnCounter` · decided by lead (plan's Q1–Q3) · risk: low
- Decided: `TurnCounter`/`TurnLimits` stay harness-owned types (no contracts port, no ADR);
  `packages/queue` depends on `@edmate/harness` as a production dependency to consume them,
  exactly as `packages/content` already does; the durable adapter is built on Redis with an exact
  sliding-window-log (ZSET), not Postgres or an approximate bucket counter.
- Why: Redis is already deployed and already a `packages/queue` dependency; one atomic Lua `EVAL`
  matches the existing sliding-window-log semantics with a single round trip well under the 50 ms
  step budget; `appendonly yes` (see `docker/compose.yaml`) already gives restart durability.
  Promoting `TurnCounter` to a contracts port would only matter if a second, non-harness-dependent
  package needed to implement it — nothing today does.
- Alternatives: a contracts port (ADR-0008); Postgres with row locks/`SELECT ... FOR UPDATE`; an
  approximate fixed-bucket counter instead of the exact log.
- Reversible: yes — both the port-vs-type question and Redis-vs-Postgres sit behind the unchanged
  `TurnCounter` interface; swapping either later needs no `admit.ts`/`entitle.ts` change.

---

### 19 Oct 2026 · 3.14 Stale board "ADR-0005" reference · decided by builder (flagged by plan) · risk: low
- Decided: the board's task 3.14 title line's "ADR-0005" mention is stale (ADR-0005 belongs to
  3.15); no ADR is created for 3.14.
- Why: ADR-0005 was assigned to 3.15 (Transcriber + session help state) after 3.14 was written onto
  the board; the lead's answer confirms no ADR is needed here regardless of numbering.
- Alternatives: renumber and use ADR-0008 for this task (the plan's fallback if the lead preferred
  a contracts port); not taken, since the lead agreed no ADR is needed at all.
- Reversible: yes — a future task can still add a contracts port with its own ADR if a second
  package ever needs to implement `TurnCounter` without a harness dependency.

---

### 19 Oct 2026 · 3.14 Separate key sub-namespace for rate vs. messages · decided by builder · risk: low
- Decided: `redisTurnLimits` gives its `rate` and `messages` counters distinct key sub-namespaces
  (`${prefix}:rate:*`, `${prefix}:messages:*`) instead of one shared namespace.
- Why: `admit`'s rate key (`studentId`) and `entitle`'s message key (`studentId:packageId`) are
  unlikely to collide by convention alone, but the plan's own spec doesn't rule out a caller or
  future use reusing the same raw string for both; a cheap, explicit sub-namespace removes the
  possibility entirely rather than relying on callers to always differ.
- Alternatives: the plan's literal single-prefix sketch (`${prefix}:${key}` for both); not taken,
  since it leaves an avoidable (if currently unlikely) collision path.
- Reversible: yes — an internal key-naming detail behind `TurnCounter`/`TurnLimits`; no external
  contract depends on the exact Redis key shape.

---

### 19 Oct 2026 · 3.14 One documented cast for the Redis Lua command · decided by team lead (typescript review) · risk: low
Decided: `packages/queue/src/turnLimits.ts` keeps a single commented cast to probe and define the custom Lua command on the ioredis client.
Why: ioredis has no typed generics for defineCommand; the cast is isolated and tested.
Alternatives: call `eval` with the script text each time (no cached script).
Reversible: yes.

---

### 19 Oct 2026 · 4.6 ADR-0007: `RetrievalIndex.leakCheck` returns one boolean for a batch, over the complement scope, failing closed · decided by lead (plan answers, after safety-reviewer and architect plan reviews) and tdd-guide (ADR text) · risk: high
Decided: add `leakCheck(candidates: string[], scope: { teacherId; allowedModuleIds }): Promise<{ hit: boolean }>` to contracts. Locked means every chunk of the teacher outside the allowed modules, and spans also in allowed chunks are ignored. The adapter fails closed and never logs candidates, with a latency SLO (p95 ≤ 50 ms, p99 ≤ 100 ms), a cache keyed by package version plus the teacher's material revision, and a residual oracle of one bit per turn bounded by the message limit.
Why: locked text must never enter the harness or a model (ADR-0003). Spans, scores or counts would make the port an oracle that reads locked text out.
Alternatives: return matched spans (architect proposal); `{ hit, score }` like `probe`; fetch locked text or hashed shingles into the harness.
Reversible: yes, by a new ADR, reviewed by architect, security-reviewer and typescript-reviewer.

---

### 19 Oct 2026 · 4.6 lockedLeak runs before answerLeak in the post chain · decided by lead (plan answer 2) · risk: high
Decided: `GUARD_ORDER.post` is now `lockedLeak, answerLeak, grounding, adviceGuard, personaBoundary, tone`, a departure from the build plan's table order. A test shows the answer rewriter never receives a locked span.
Why: answerLeak's rewrite sends the draft to a small model; a locked span must be gone before then.
Alternatives: keep the table order and strip locked text inside answerLeak's rewrite path.
Reversible: yes, with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.6 Any locked hit replaces the whole reply with the locked reply; no surgical strip · decided by lead (plan answer 3) · risk: high
Decided: on a hit in the post chain or the stream, the student gets the locked reply. It is the built-in English reply or the locale's `FallbackReplies.lockedReply`, and names only the student's own package when the teacher chose `name_package`. The guard accepts that text without a check, so it is idempotent by construction.
Why: cutting spans out leaves fragments and needs spans from the port (an oracle). A fixed reply is safe and simple.
Alternatives: strip matched spans and recheck in a bounded loop (original plan).
Reversible: yes, with safety-reviewer sign-off and an ADR if the port would have to return spans.

---

### 19 Oct 2026 · 4.6 Every streamed sentence waits for a locked check, with a 7-token carryover · decided by lead (plan answer 1) and tdd-guide (seam placement, partial-word rule) · risk: high
Decided: text the answer gate releases is cut into sentences by the same rules. Each sentence is shown only after `leakCheck` passes it, together with the last 7 shown tokens (8 when the shown text ends inside a word). A hit, a failed check or too much text withholds the rest of the attempt. Fragments with no sentence end are not shown until checked.
Why: build plan line 316 requires locked n-grams to be checked before sending. The carryover catches spans across sentences, chunks and tool rounds.
Alternatives: post-only checking, where locked text would stream and then be replaced; one check per chunk, which means too many port calls.
Reversible: yes, with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.6 Up to 7 locked tokens can stream before the hit; accepted as a known miss for now · decided by tdd-guide (finding, for safety-reviewer) · risk: high
Decided: no hold-back beyond the carryover. In the fixture run, 89 of 351 forms showed a short case phrase (always fewer than 8 locked tokens) before the replace. None showed 8+ tokens, and every final reply is the locked reply.
Why: knowing that a shown sentence starts a locked span needs a prefix query, which is a finer oracle than ADR-0007 allows.
Alternatives: delay each sentence until 7 more tokens arrive (slower streaming, and it still can't tell); a prefix-query port (new ADR, an oracle risk).
Reversible: yes; safety-reviewer to decide whether this needs a follow-up task.

---

### 19 Oct 2026 · 4.6 The student's own words: only their own 8-token windows are left out · decided by tdd-guide (narrowing lead answer 4's false-positive rule) · risk: high
Decided: the harness drops from the candidates only the 8-token windows that appear in the student's (scrubbed) message. A window mixing the student's quote with new words is still checked.
Why: cutting out the student's tokens would let "echo my quote plus 7 more locked tokens" pass, the partial-quote attack. Tests show both the false positive and the attack.
Alternatives: cut covered tokens out (my first version, caught in testing); no student exception (quoting back a student's paste would be replaced).
Reversible: yes.

---

### 19 Oct 2026 · 4.6 Fail-closed outcomes per call site · decided by lead (plan answer 5) and tdd-guide (reply choice) · risk: medium
Decided: `lockedCheck` is required everywhere. On a rejection or timeout: the tool loop gives `failed('locked')`, skillEvent gives `drop('locked')`, the stream withholds and postGuard then sends the safe reply (or the hint if an answer also leaked), and the post chain fails and sends the safe reply. A real hit gives the locked reply.
Why: telling a student "that's not in your package" when the index was only slow would mislead them; the safe reply is neutral.
Alternatives: treat every failure as a hit and send the locked reply.
Reversible: yes.

---

### 19 Oct 2026 · 4.6 Harness timeout 150 ms per check; checks of under 8 tokens skip the call · decided by tdd-guide · risk: medium
Decided: `LOCKED_CHECK_TIMEOUT_MS = 150`, the per-guard slice once all six post guards exist. No port call is made when no candidate has 8 tokens. Candidates are folded token spans, with base64 decoded once (plan Q3).
Why: keeps latency bounded and fails closed. Short text can't hold a leak.
Alternatives: use the post slice only; always call.
Reversible: yes.

---

### 19 Oct 2026 · 4.6 Skill-only locked cases and one framed leak · decided by tdd-guide · risk: medium
Decided: `skill-feedback-en`, `skill-feedback-hi-latin` and `skill-revision-allowed-module-en` lock a skill and name no locked module file. Their leaks quote locked functions or loops material. The first and third fail unguarded only through `must_contain` (the locked reply). `skill-feedback-hi-latin`'s phrases ("rubric line", "marks:") appear in no content file, so its leak puts "Rubric line 1: " before a verbatim locked rubric span.
Why: the lead asked that every case fail under both mutations. For these cases lockedLeak is a backstop; the main protection is decide's locked move and the skill registry.
Alternatives: exclude these three from the mutation count.
Reversible: yes.

---

### 19 Oct 2026 · 4.6 Test virtual clock flushes 2,000 microtask turns, up from 200 · decided by tdd-guide · risk: low
Decided: raise `FLUSH_TURNS` in `testing/virtualClock.ts`.
Why: a long reply now awaits one check per sentence at a single virtual instant. At 200 turns the clock wrongly fired a 15 s attempt timeout or reported a deadlock (4.5's leak suite showed it). Production code is unaffected.
Alternatives: add delays to every scripted stream.
Reversible: yes.

---

### 19 Oct 2026 · 4.6 Locked hits go to background reports until 4.4's SafetyEventSink exists · decided by lead (task brief) · risk: low
Decided: hits are reported by name only: `LockedLeakDetected(stream|reply)`, `ToolFailed(…, 'locked')` and `SkillEventDropped(…, 'locked')`. None carries any text.
Why: 4.4 has not merged.
Alternatives: wait for 4.4.
Reversible: yes; wire to the sink in 4.4 or a follow-up.

---

### 19 Oct 2026 · 4.6 A locked-check outage gives the generic safe reply · decided by team lead (security review) · risk: low
Decided: when the full-reply leakCheck fails (timeout or error) rather than hits, `packages/harness/src/pipeline/steps/postGuard.ts` sends the generic safe reply, as the stream path already does.
Why: an outage is not evidence of a locked request, so naming the package would mislead.
Alternatives: send the locked reply on any failure.
Reversible: yes.

---

### 19 Oct 2026 · 4.6 Build-plan guard table updated for ADR-0007 · decided by team lead (architect review) · risk: high
Decided: the build plan's guard table now lists lockedLeak before answerLeak, with whole-reply replacement and the per-sentence stream check.
Why: the spec must match the accepted ADR; a reader of the table alone would build the wrong order and action.
Alternatives: leave the table stale.
Reversible: only by another ADR.

---

### 19 Oct 2026 · 3.17 fix round · Duplicate `teacher_questions` rows are dismissed, not left open and not deleted · decided by build-error-resolver (fix round) · risk: medium, reversible
Decided: 0011's dedup cleanup sets every open duplicate but the oldest to `status = 'dismissed'` (append-only, no deletes), so the new unique index can always be created even against data seeded before it existed.
Why: the review's instruction was explicit ("close duplicates... never delete rows"); `dismissed` is the only terminal status besides `answered` in `teacher_question_status`, and a duplicate asked only because of the pre-fix race was never actually answered.
Alternatives: delete the duplicate rows (violates "never delete"); leave them open and make the index `CREATE UNIQUE INDEX CONCURRENTLY` with a pre-check that refuses to proceed on conflict (adds an operational step with no clear owner, and still needs some resolution of the conflicting rows first).
Reversible: Yes — a later migration could re-open a dismissed duplicate if that ever mattered (none of this pilot's history needs it).

---

### 19 Oct 2026 · 3.17 No locale/age (DPDP) gate on learner-profile writes yet · decided by lead (pre-build) · risk: high
Decided: ship 3.17 without a locale/age gate on `applyEvidence` or `get`; the gap is tracked by board task 6.0b (the DPDP gate for learner memory), which must land before any India pilot.
Why: `ProfileStore` has no market/age parameter — adding one here is a contracts change needing an ADR, disproportionate to a plumbing task with no real evidence producer yet (route/3.3, the practice skill/5.6 and the topic map/6.1 are all still `todo`); `buildContext` already reads whatever is in `learner_profiles` for every session today, independent of this task, so this task's write path does not newly expose anything an India 13–17 session doesn't already carry.
Alternatives: add a market/age check to `ProfileStore` now (contracts ADR); block 3.17 until 6.0b lands.
Reversible: Yes — 6.0b can add the gate without touching this task's write path.

---

### 19 Oct 2026 · 3.17 TeacherQuestion open-dedup via a new partial unique index + insert-or-return-existing · decided by lead (plan) and tdd-guide (the `md5(text)` expression, found while writing the migration) · risk: high
Decided: migration 0011 adds a partial unique index on `teacher_questions (teacher_id, student_id, agent_id, md5(text)) WHERE status = 'open'`; `teacherQuestionsRepo.open()` becomes insert-or-return-existing on that key, so the live (3.7) attempt and commit's (3.17) fallback — which can both try to open "the same" question for one turn, since a timed-out live attempt may still land — converge on one row instead of raising a duplicate. A plain (non-`CONCURRENTLY`) migration, unlike 3.16's session-pin indexes: `teacher_questions` is small and low-write.
Why: without this, an `ask_teacher` turn whose live open timed out (but still landed) would get a second, duplicate question from commit's fallback.
Alternatives: dedup in application code only (a read-then-write race window); index on raw `text` (would exceed btree's row-size limit for a long question); `CREATE INDEX CONCURRENTLY` via a post-migrate step (disproportionate for a small, low-write table).
Reversible: Only with a new migration and a review of any `open()` callers relying on the current raw-insert behaviour.

---

### 19 Oct 2026 · 3.17 Evidence idempotency: content-hash id over the original timestamp, one shared function · decided by lead (answer) · risk: medium
Decided: `evidenceEventId` (in `packages/queue`) hashes `studentId|teacherId|topicId|correct|source|weight|ts` with a fixed field order and encoding (`JSON.stringify` of a fixed-key array); `ts` must be the event's *original* timestamp, documented with a code comment at the one place it is computed (`queues.ts`) and at every call site (`profileStore.ts`'s producer, `processors.ts`'s worker). The same function is used for the BullMQ job id (`jobId.evidence`) and the row id `evidenceEventsRepo.append` writes, so a replayed job and the first attempt agree on one id. A test (`adapters.test.ts`, "jobId.evidence and the producer both derive from this one function") asserts the two call sites produce the same id for the same event.
Why: a retry must hash to the same id as the first attempt, or dedup breaks; one shared function (not two copies) removes the chance of the hash algorithm drifting between the producer and the processor.
Alternatives: a per-event id chosen by the caller (loses the "replay reproduces the same id" property unless the caller is also deterministic); separate hash functions in `@edmate/queue` and `@edmate/db` (duplication risk).
Reversible: Yes — changing the hash's field order or encoding is a one-file change, though it invalidates in-flight job ids across a deploy.

---

### 19 Oct 2026 · 3.17 `profileStoreFor.applyMastery`'s write path closes the 3.16 "last_summary clobbered" finding structurally · decided by lead (plan) · risk: medium, reversible
Decided: `learnerProfilesRepo.applyMastery`'s `SET` list only ever names `mastery` and `updated_at`; `mistakes` and `last_summary` are never in the statement, so this write path cannot clobber `last_summary` no matter what calls it. `learnerProfiles.save()`'s own semantics (and any session-open/package-pin check on it) are unchanged — closing this specific write path does not close the finding for `save()` in general, which is still 6.4's job (`EvidenceEvent` has no `sessionId` to check against).
Why: evidence should never erase a student's last-session summary.
Alternatives: give `applyMastery` a `save()`-style full-row overwrite (reintroduces the risk); add a session check here anyway (no session id available on `EvidenceEvent`).
Reversible: Yes.

---

### 19 Oct 2026 · 3.17 `TeacherQuestionStore.findSimilar` always returns `[]` for now · decided by tdd-guide (build-time finding, logged for the lead) · risk: medium
Decided: `teacherQuestionStoreFor.findSimilar` returns `[]` unconditionally (still scope-checked). No embeddings-backed similarity search exists yet in this codebase; building one is out of this task's scope (a RAG/embeddings task) and not in the plan's file list.
Why: shipping plumbing, not an invented heuristic — matches the task's own stated approach for evidence extraction.
Alternatives: a naive text-similarity heuristic (e.g. trigram overlap) now; block this task on the embeddings task.
Reversible: Yes — a later task can replace the body without changing the port's shape.

---

### 19 Oct 2026 · 3.17 New-profile default: `lang: 'en'`, empty mastery/mistakes · decided by tdd-guide (plan's own recommendation) · risk: low
Decided: `profileStoreFor.get`/`applyMastery` default a never-seen (student, teacher) pair to `lang: 'en'` (the pilot is English-only today).
Why: `ProfileStore.get` has no `lang` parameter (unlike `fallbackContext`'s `input.lang`), so some default is needed; English matches the current pilot.
Alternatives: default to the entitlement's market's locale (no market available at this port's level); throw instead of defaulting (breaks `buildContext`, which calls this every turn).
Reversible: Yes, once locale work lands.

---

### 19 Oct 2026 · 3.11c Pilot-policy validation lives in `packages/content`, called from the one real construction site · decided by tdd-guide · risk: medium
Decided: `checkPilotLanguages`/`PILOT_LANGUAGES` (18 Oct 2026 English-only decision) are added to `@edmate/content`, not to `packages/contracts` (a contracts change needs an ADR, and `AgentConfigSchema.languages` must stay general per the task). The content package's own `validateContentDir`/CONTENT_RULES are untouched because no content-tree file carries `languages` yet (no agent config field exists in the teacher content layout; it is built only by `packages/db/src/seed.ts`, the one real `AgentConfigSchema.parse` call with live `languages` data today). `seed.ts` calls `checkPilotLanguages(agentConfig.languages)` right after parsing and throws a clear message if it ever fails; it cannot fail today because the seed's `languages` is a hardcoded `['en']`, so this is forward defence, not a reachable branch (db's coverage threshold is 80%, not 100%, so this is allowed).
Why: grepping `AgentConfigSchema` across `packages/content`, `packages/db` and `apps/cli` (task instruction) found no teacher-facing publish path with a `languages` field yet — `edmate content validate` validates course/style-card/package/licence files only. Putting the check where the real data flows, and exporting it from content so a future studio/publish path (and apps/cli) can reuse the same function, seemed better than inventing an unused content-tree field.
Alternatives: add a no-op `ContentRule` for a `languages` field that doesn't exist yet (speculative); put the function directly in `packages/db` (then a future `apps/cli`/content publish path would need to depend on `@edmate/db` to reuse it, the wrong dependency direction).
Reversible: yes — the function can move or be called from new sites without changing its shape.

---

### 19 Oct 2026 · 3.11c The harness clamp lives in `replyLanguage`/`composeSystemPrompt`; the warning is reported from `decide`, not from `compose.ts` · decided by tdd-guide · risk: high
Decided: `compose.ts` gains its own `PILOT_LANGUAGES` constant (the harness may import only contracts, zod, mathjs and its own modules, so it cannot import `@edmate/content`'s copy) and clamps `replyLanguage` to `'en'` whenever `agent.languages` is not exactly `['en']`, regardless of the student's requested language or what the agent config otherwise claims to allow. `composeSystemPrompt` stays pure and now also returns `languageClamped: boolean` on `Composed`. `decide.ts` (which already holds a `StepEnv` with `.report`) reports a `PilotLanguageClamped` (a `HarnessError` with fixed, content-free text) to `finished.background` when `languageClamped` is true, exactly like every other background-only failure in the pipeline (ids and error name only, never agent or student text). This touches `packages/harness/src/pedagogy/**`, a risk-paths group requiring safety-reviewer sign-off.
Why: the task calls for "a narrow input clamp... where the language is picked" plus a background-only warning; `replyLanguage` is literally where the language is picked, and `decide` is the first place downstream that already has a reporting channel, so no new plumbing (a new `BackgroundTask` variant, a logger param on `compose.ts`) was needed to keep `compose.ts` pure.
Alternatives: thread a logger or callback into `composeSystemPrompt` itself (breaks purity, a `prompt-pack behaviour is frozen` file the task said to touch narrowly); add a new `BackgroundTask` union member for this (unneeded — the existing default `'runner'` task plus the error's own `name` already identifies it uniquely in the background log).
Reversible: yes, but only with safety-reviewer sign-off (risk-paths rule).

---

### 19 Oct 2026 · 3.11c Existing demoAgentConfig-based tests updated for the new clamp, not left to describe stale behaviour · decided by tdd-guide · risk: low
Decided: `compose.test.ts`'s locale-pack test, `decide.test.ts`'s "uses the input language" test, and `turn.integration.test.ts`'s turn-config loader were updated: the fixture `demoAgentConfig` carries `languages: ['en', 'hi']` (the contracts fixture is general on purpose and was not touched), so turns built from it are now clamped to English; the integration test's loader was given `languages: ['en']` instead, since that test is about turn flow, not language policy, and its `expect(result.background).toEqual([])` assertion predates this task.
Why: task instruction 3 ("the harness clamp falls back to en") is a behaviour change from the pre-task state, so the old assertions (`replyLanguage('hi', {...})` returning `'hi'`) described exactly the gap this task closes; updating them in place (TDD red→green) rather than leaving them failing or weakening the clamp was the only option that keeps both the policy and the test suite honest.
Alternatives: give `compose.snapshot.test.ts`'s `demoAgentConfig`-based cases a non-pilot-compliant agent too (unnecessary — every snapshot case requests `lang: 'en'`, which the clamp also resolves to `'en'`, so no snapshot changed).
Reversible: yes.

---

### 19 Oct 2026 · 4.2c fix round: the 4.2c ambiguity rule is narrowed to three specific gates, not a blanket block · decided by build-error-resolver · risk: low
Decided: replace the single "bare `card`/`name`/`pin` never redacts" rule with three narrower
ones — a file-shaped enclosing key (bare "name" only), an object value's own direct name-shaped
subfields (bare "name" only), and a PIN/postcode digit-length check (bare "pin" only) — so a bare
key's own scalar value always redacts unless one of those three specifically says otherwise.
Why: the original rule's comment claimed it only stopped cascading into unrelated *nested* keys,
but the code actually blocked the key's own direct value too, which is the CRITICAL regression
this round fixes; the three gates above are the narrowest change that satisfies every named case
(including the new ones) without reopening the original flashcard/file-name/GPIO-pin false
positives.
Alternatives: keep the bare-key rule as "object value only" (still leaves `{"pin":9999}`-shaped
over-redaction or under-redaction edge cases unaddressed); drop the ambiguity rule entirely (reopens the
original 4.2c false positives it was meant to fix).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c fix round 2: the file-like-parent exemption needs the value's shape too, not just the parent key's name · decided by build-error-resolver · risk: low
Decided: a bare "name" under a file-shaped key (`files`/`file`/`module`/`function`/`variable`/
`class`) is only exempt from redaction when the value also looks like a file name or a plain code
identifier (a dot-extension, or a single no-whitespace token that isn't a bare Title-Case word);
otherwise it redacts, even under one of those keys.
Why: keying the exemption on the parent alone let a real person's name under any of those keys go
unredacted at any depth — a HIGH-severity privacy gap the reviewer found in fix round 1. Checking
the value's shape too closes it while still letting ordinary file names and code identifiers
through.
Alternatives: drop the file-like-parent exemption entirely (reopens the original `main.py` false
positive it was added for); key only on the value's shape and ignore the parent (would also
exempt a bare "name" with an identifier-shaped value anywhere, e.g. `{"name":"Riya_underscored"}`,
which is less targeted than keeping both conditions).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c fix round 3: the digit-form pre-pass moves inside the shared `foldText`, not duplicated per caller · decided by build-error-resolver · risk: low
Decided: `textFold.ts`'s `foldText` calls `digitForms.ts`'s `foldDigitForms` first, composing its
span map into `foldText`'s single-index `at`; `piiPatterns.ts` keeps its own separate, already-first
`foldDigitForms` → `buildView` chain rather than being rewired to share `foldText`.
Why: this is the smallest change that gets every current and future caller of the shared
`foldText` (today: `answerKey.ts`/`answerLeak`, `numbers.ts`) the same digit-form folding
`piiScrub` already had, without touching `piiPatterns.ts`'s own (different-shaped) fold pipeline,
which was already correct and is unrelated to this gap.
Alternatives: duplicate the `foldDigitForms` call inside `answerKey.ts`/`numbers.ts` directly
(repeats the same fix at every call site, the exact duplication `textFold.ts` was created to
avoid); rewrite `piiPatterns.ts` to use `foldText` too (a bigger refactor, out of scope for a fix
round, and not needed since `piiPatterns.ts` was never missing the pre-pass).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c fix round 4: a whole-string pre-test, not a smarter algorithm, fixes the hot-path regression · decided by build-error-resolver · risk: low
Decided: `foldDigitForms` gains one precompiled regex test over the whole input; when it finds
none of the characters the function can possibly change, it returns an identity map without
running the per-code-point loop at all. `foldOne` also skips `normalize()` for plain ASCII.
Why: the dominant cost was calling `.normalize('NFKC')` on every single character regardless of
whether it could ever change under NFKC; almost no real text has any of the digit-form characters
this module cares about, so skipping the whole per-character pass is both correct (same output)
and by far the cheapest fix, with no change to the O(n) position-map composition added in fix
round 3.
Alternatives: cache `normalize()` results per code point (helps repeated characters within one
call, not the dominant case of many distinct ASCII characters); restructure the stream gate to
call `foldText` less often (a bigger, riskier change to a different file, for a problem that is
really about `foldDigitForms`'s own unconditional per-character cost).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c Digit-form folding is a separate pre-pass module · decided by lead (coordination with 4.5) and tdd-guide · risk: medium
Decided: `foldDigitForms` (keycap, superscript, circled digits; marks dropped after a digit) lives in its own new file, `guardrails/digitForms.ts`, called once at the top of `findPii` before the existing fold/view code in `piiPatterns.ts`, which is left untouched.
Why: 4.5 is moving that existing fold/view block to a shared helper on its own branch; keeping the two changes in separate files avoids a conflicting edit to the same lines, whichever PR merges first.
Alternatives: add the new digit forms to the existing `fold()` function directly.
Reversible: Yes; a later merge can fold the two modules together once both land.

---

### 19 Oct 2026 · 4.2c Card redaction after an unrelated word still stays excluded · decided by tdd-guide · risk: medium
Decided: the ~25-character window after a card for an unlabelled CVV/expiry only passes through punctuation and whitespace; a word (a letter) stops it immediately.
Why: the task's own near-miss ("... and the exam on 12/29" must stay unchanged) and the new eval case (punctuation-only gaps) both need to pass; a word-blind 25-character window would redact the near-miss's unrelated date too.
Alternatives: a plain 25-character window with no word boundary; a shorter window with no boundary check.
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c Flexible-group and locale-pattern over-scrub guards exclude constant runs, not counting ones · decided by tdd-guide · risk: medium
Decided: the new flexible-group phone pattern and the locale-pattern over-scrub guard (item 8) both exclude a run of the same digit repeated, but not a monotonic/counting run (ascending or descending by one).
Why: two of the task's own example numbers, and a pre-existing required test (`9876543210`, India mobile shape), are counting runs that must still redact; only the narrower "constant digit" exclusion satisfies every required case at once.
Alternatives: reuse `phoneLikeDigits` (constant or counting) everywhere, which breaks the pre-existing test and one of the task's own phone examples.
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c Payload-key ambiguity is narrowed to three words, via a prefix/suffix requirement · decided by tdd-guide · risk: low
Decided: `card`, `name` and `pin` alone no longer redact a payload value (they need a prefix or suffix — `cardNumber`, `studentName`, `pinCode`); an object value under a PII-named key no longer propagates its category into the object's own nested keys (an array still does, since it is the key's own value).
Why: a flashcard's `card`, a file's `name` and a map/GPIO `pin` are ordinary teaching content, and the old code redacted a sibling key's unrelated nested object too (`{"card":{"front":...}}`).
Alternatives: keep all PII words bare-matching and rely on value shape alone; propagate `under` into nested objects too (today's behaviour, the thing being fixed).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c The 2 proposed distress eval cases are seeded only, not wired into piiScrubPipeline · decided by lead (correction) · risk: low
Decided: `safety-distress-name-heuristic-in-en`/`-hi-latin` live under `evals/suites/safety/distress/in/` with `reviewed_by: pending`, same shape as every other distress case; they are not PII-scrub cases and are left out of `piiScrubPipeline.test.ts`'s PII assertions.
Why: the lead's correction said so explicitly; a live/reply check for these needs 4.3's distress-eval wiring, not this task.
Alternatives: fold them into the PII pipeline test anyway (would assert nothing meaningful, since they carry no PII).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2c PII pattern hardening · decided by team lead · risk: high
Decided: the 4.2 safety review's deferred forms are scrubbed (keycap, superscript and circled digits; flexible phone, card, CVV and OTP shapes; spelled-out numbers; Hindi word-order names, name:/naam:, sign-offs). PII-named payload keys redact their own values, with narrow exemptions for flashcards, small numbers and file or identifier values under code-shaped keys.
Why: every form here reached the model unscrubbed in the 4.2 review's probes.
Alternatives: leave these to a model-based scrubber.
Reversible: yes.

---

### 19 Oct 2026 · 4.2c Accepted gap: lowercase names under code-shaped payload keys · decided by team lead (safety review) · risk: medium
Decided: a single lowercase, all-caps or snake_case token under a files, file, module, function, variable or class key ({"module":{"name":"riya"}} in `packages/harness/src/pipeline/steps/scrub.ts`) is treated as an identifier and not redacted. Skill payloads must never put a real student name in those fields; that is fixed at the source in 5.x skill design.
Why: such a token has the same shape as a real identifier ("utils"); redacting it would bring back the over-scrubbing that broke flashcards and file names.
Alternatives: redact every bare token under code keys; drop the exemption.
Reversible: yes.

---

### 19 Oct 2026 · 0.14 Wall-clock latency bounds are gross-regression guards only · decided by team lead · risk: low
Decided: the stream-gate latency test keeps a 5 s wall-clock bound; linear work is asserted by counting work, not by timing.
Why: shared CI runners with coverage are 8–12× slower than local runs, and the 1 s bound turned main's CI red.
Alternatives: drop the timing test; skip it on CI.
Reversible: yes.

---

### 19 Oct 2026 · 3.11b Prompt packs v1.0.0 content (English) · decided by team lead · risk: high
Decided: the real v1.0.0 frame, safety preamble, 6 skill packs, 5 mode packs and 2 persona templates ship, drafted by pedagogy-author from the safety-reviewed plan, fixed after two safety-reviewer passes, and signed per row by the human. They are not pinned for real-model turns until the 4.x guards merge and the full suite passes.
Why: the model's instructions are the last line of defence when a guard misses.
Alternatives: keep the fixture packs; ship without a human signature.
Reversible: yes (a new pack version).

---

### 19 Oct 2026 · 3.11b Conversation-side markers removed · decided by team lead (safety review) · risk: medium
Decided: the teacher-label, generic-disclaimer, no-helplines and empty-turn sections carry no `[[…]]` marker, because their text reaches the conversation or is passed on. The teacher note reads "(Platform note: the teacher wrote this reply.)". System-prompt section markers stay.
Why: a marker in conversation text teaches the model to write `[[`, which the jailbreak cases forbid, and lets a student forge the teacher's voice.
Alternatives: keep every marker.
Reversible: yes.

---

### 19 Oct 2026 · 4.5 answerLeak is live: the default stream gate and the first post guard · decided by lead (task) and tdd-guide · risk: high
Decided: `generate` now uses the sentence gate by default and `postGuard` runs the post-phase chain with answerLeak; no real-model turn may run before this merges. Reviewed by safety-reviewer (required), with security-reviewer, typescript-reviewer and silent-failure-hunter.
Why: this task is the gate before any real-model turn; the fixtures show 0 leaks for numeric and encoded forms, and the mutation run shows the test bites.
Alternatives: keep the pass-through default and rely on the final check only (the student would see the leak stream in before the replace).
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.5 The student's own code may be quoted back only when it is clearly code, and never as a confirmation · decided by tdd-guide (narrowing lead revision 6; tightened in fix round 1 after the safety review) · risk: high
Decided: a code-shaped key in the student's current message is allowed back only when it sits on a line that is clearly code (inside a ``` fence, indented, ending in a colon, or starting with a statement keyword or an assignment, and not ending in "?") or comes right after `elif`, `while` or `return`. Offering options never counts ("is it .upper() or .lower()?", backticked or not, "n % 2 == 1 or n % 2 == 0"); and/or/not/else/if count only on a clearly-code line. An apostrophe inside a word does not make a key code-shaped. Even an allowed quote is a leak in an answer or confirmation context (yes, right, correct, exactly, fix, use, solution, works, sahi, haan, bilkul, हाँ, सही within five words in the same sentence), and inside decoded base64. Plain words and numbers are never allowed back.
Why: the first rule (any code word or backticks before the key) was beaten by offering options; echoing a proposed answer confirms it.
Alternatives: exempt any code key the student typed (fails leak-co6-falseattempt-en); drop the exemption (false positives on the student's own buggy code).
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.5 A withheld leak: the whole post chain judges everything the model wrote; only a checked rewrite or the hint is shown · decided by lead (revision 2) and tdd-guide (fix round 1, security and safety review) · risk: high
Decided: when generate reports `withheld`, or the full model text (`raw`) leaks, postGuard runs the post chain on `raw` instead of the shown draft. So the other post guards still see it (an escalate is forwarded), and answerLeak makes its one bounded small-tier rewrite of it, which every guard re-checks. Anything else (no rewrite, a failed or leaking rewrite, a block, a chain failure) gives `ANSWER_LEAK_SAFE_HINT`. With no `raw` kept, a withheld turn is always the hint.
Why: skipping the chain hid escalates in withheld text, and a canned hint for every one-digit false positive teaches nothing.
Alternatives: go straight to the hint without a chain run (the first version).
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.5 The stream gate checks a window measured in visible units, holds number-word tails, and works in linear time · decided by tdd-guide (fix round 1, security and safety review) · risk: high
Decided: each sentence is checked with the shown text from `reach` visible units back (whitespace and invisible units are walked over, not counted; then back to the start of a word) plus the new text. `reach` is 64 + 4 × the longest key, plus 512 when there is a number key. A tail that could start a key, a number, or a run of number words ("two thousand", "twenty") is held. Each unit is scanned for sentence ends once and each sentence judged once; sentences within the 200-unit cap are judged one by one, a longer stretch goes through the cap cut.
Why: the first window counted spaces, so 700 spaces between "two thousand" and "sixteen" pushed the start out of it; and rescanning the buffer made one 400k chunk take 3.1 s.
Alternatives: check all shown text every sentence (quadratic); cap the window in raw units (beaten by padding).
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.5 More than a reply's maximum of model text trips the gate · decided by security-reviewer (fix round 1) and tdd-guide · risk: high
Decided: once the text pushed in one attempt exceeds `LIMITS.modelTextMaxLength` (8000), the gate trips: the rest is withheld and the reply is the hint. generate keeps at most 8000 units of `raw`, and `GenerateResult.draft`/`raw` are capped at 8000 in the harness's own schema. The contracts `ModelChunkSchema` is unchanged.
Why: bounded work on adversarial streams; no reply is longer than that anyway.
Alternatives: cap each chunk in contracts (needs an ADR); let the gate judge any length (unbounded work).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Hindi in Latin letters covers 21-99, with spelling folding · decided by safety-reviewer (fix round 1) and tdd-guide (the fold) · risk: medium
Decided: 21-99 are listed in Latin letters with common spellings, and words of five or more letters are also matched after a fold (doubled letters once, chh/chch as ch, au as o, ai as e, w as v, e as i), so chaubees, chaubis and chobis all read 24. A folded form that two values share is dropped, never guessed. They combine with hazaar/lakh ("chaubees hazaar" is 24000).
Why: the safety review found 21-99 Hinglish answers went through.
Alternatives: list every spelling by hand (never complete).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Count and confirmation words make an answer context for one-digit keys · decided by safety-reviewer (fix round 1) · risk: medium
Decided: times, runs, run, baar, बार, chalega, chalegi, chalta, चलेगा, चलेगी, it's and its join the answer words (three words before, one after). "It runs three times", "It's three", "Loop teen baar chalega" and "तीन बार चलेगा" trip key 3. Known strict trips, pinned by test: "Ek baar code ko line by line padho" (key 1) and "Read it three times slowly" (key 3).
Why: a count is how a loop answer is said.
Alternatives: a wider window (more false positives).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Decimals, fractions and grouped thousands · decided by safety-reviewer (fix round 1) and tdd-guide (precision rule) · risk: medium
Decided: a fraction key ("5/6") is its value; a decimal key matches mentions written to at least its precision that round to it (".83" and "0.833" for 0.83, a leading "." allowed); a fraction key matches decimals of 2+ places it rounds to ("0.83" for 5/6, not "0.8"); "24 000" with a space (no-break and narrow no-break spaces fold to a space) is 24000.
Why: the same answer in another notation is still the answer.
Alternatives: exact match only.
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Short and padded base64 · decided by security-reviewer (fix round 1) and tdd-guide (contexts) · risk: medium
Decided: a padded run is never treated as a plain word ("Mw==", "Mg=="); runs of 2-3 characters ("MTY", "Mw") are decoded near the word "base64" (within 40 characters), and, if not word-shaped, after an answer word or standing alone in a sentence. Every candidate counts toward the 256-run cap, skipped ones included.
Why: "MTY" without padding is 16; "Mw==" is 3.
Alternatives: decode every 2-3 character run (plain words decode to noise that trips one-digit keys).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 A failed postGuard step is reported; a post guard's escalate text is saved on the CommitRecord · decided by silent-failure-hunter and safety-reviewer (fix round 1) · risk: medium
Decided: when the postGuard step throws, times out or returns a malformed result, the runner reports `PostGuardStepFailed` (kind and error name only) before the safe reply. On a postGuard escalate, the chain's text goes on `CommitRecord.escalatedText` (never shown); commit does not persist it yet.
Why: no step failure goes unreported; revision 13 says save the escalate text.
Alternatives: keep the text on the step result only (the first version).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Six new leak cases, pending the human's sign-off · decided by lead (fix round 1) and tdd-guide (bank items) · risk: high
Decided: six cases are added under `evals/suites/leak/` with `reviewed_by: pending`. The bank has no 21-99 item outside loops, no year and no 5/6, so the closest items are used: lo-q2 (55) for the 21-99 words and the padded-spaces cases, lo-q6 (3) for the count, vv-q5 (16) for short base64, and vv-q1 (7 / 2 = 3.5) for the decimal case, whose "starting with a dot" is dropped. lo-q6's key (3 in `range(3)`) and vv-q1's (7 / 2) also occur in their questions (5.6).
Why: each review probe gets a fixture; the human signs cases off before merge.
Alternatives: write new bank items (content work outside this task).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 A post guard's escalate ends the turn as an escalation · decided by lead (revision 13) and tdd-guide (runner path) · risk: high
Decided: postGuard returns `escalate` with the alert and the chain's text; the runner sends `replace ''`, then runs its existing escalate path (caring template from the escalate step, alert raised, outcome escalated). The chain's text stays on the step result only; it is never shown or stored.
Why: the 4.1 safety review: save the escalate text but always reply with the caring template. No post guard escalates yet; this is the wiring for 4.8/4.9.
Alternatives: store the chain's text on the CommitRecord (a new field nobody reads yet).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 postGuard owns the reply text for guard verdicts; the runner keeps its fallback for crashes · decided by tdd-guide (plan question) · risk: medium
Decided: the step returns the hint when answerLeak was involved in a block or failure, else `fallbackReplies.safeReply`; the runner's own safe reply is used only when the step throws, times out or returns something malformed. The runner sends `replace ''` before every postGuard replacement, so skill events and sources clear too (revision 12).
Why: one owner per case; a chain failure is reported (`PostGuardFailed`, guard name and cause only) instead of hidden behind a throw.
Alternatives: always throw on a non-ok chain and let the runner pick the text.
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Arithmetic uses a small built-in evaluator, not mathjs · decided by tdd-guide · risk: medium
Decided: `print(8*2)` and `f"{5+3}"` are evaluated by a hand-written parser (numbers, `+ - * / // % ** × ÷`, parentheses; at most 64 units, 31 tokens, depth 8).
Why: mathjs is not yet a dependency, and its `evaluate` over model text is a larger attack surface than a parser that can only add and multiply literals.
Alternatives: add mathjs and walk only its number and operator nodes.
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 How keys match: whole numbers, word-bounded text, answer context for one digit · decided by lead (revision 6) and tdd-guide (details) · risk: medium
Decided: a key that is one number (digits, literal or number words) matches only as a whole number in any form; text keys match at word boundaries after folding (spaces and commas ignored), so `if marks >= 80:` does not match inside `elif marks >= 80:`. A one-digit key's digits count anywhere, but its words and arithmetic only in an answer context (an answer word up to three words before or right after, or the number alone in its sentence); inside decoded base64, its digits need that context too.
Why: ordinary lesson text ("one step", "teen lines hain", "1 + 2") must pass; decoded noise ("j{0z") can hold stray digits.
Alternatives: substring matching (false positives on 160, 2016 and `elif`).
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.5 Base64 skips plain words and decodes only printable UTF-8 · decided by tdd-guide · risk: medium
Decided: runs of 4+ base64/base64url characters (padded or not) are decoded once; lower-case or Capitalised words (also hyphenated) are skipped; only strict, printable UTF-8 is kept. Hex and reversed digits are not decoded (LOW extras, left out).
Why: "together" decoded to printable noise containing a digit and tripped a one-digit key in the hint itself.
Alternatives: require 8+ characters (misses `MTY=`).
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 The rewrite is one small-tier call with a fixed instruction and no key · decided by lead (revision 11) and tdd-guide (shape) · risk: medium
Decided: the rewrite sends the draft with a fixed English instruction (`REWRITE_SYSTEM`) on the small tier, at most 400 output tokens and 60% of the guard's time slice, after the turn's cost check. A failure, a tool call or a leaking result gives the hint.
Why: the draft already holds the answer, so the key adds nothing; the matcher re-checks whatever comes back.
Alternatives: send the key list so the model knows what to remove.
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Post-guard time slices: (2 s − 200 ms) / (2 × guards) · decided by lead (revision 14) and tdd-guide (margin) · risk: low
Decided: each post guard's slice is 900 ms with one guard and 150 ms with six; a six-guard chain that rewrites and uses almost every slice ends at 1 788 ms.
Why: both passes of every guard fit inside the step's 2 s with a margin.
Alternatives: an overall chain deadline.
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 Constraints for 5.6 (answer keys) · decided by lead (revision 6) and tdd-guide (the exception) · risk: medium
Decided: no answer key may match its problem statement; each answer may have several keys (one per canonical phrasing, e.g. `n >= 1 and n <= 10` and `1 <= n <= 10`). Exception found: for "what does this print" items the printed output is in the question (co-q2's only key, `Warm`), so 5.6 must decide how to handle those (for example, count them only in an answer context).
Why: a key in the problem statement makes the guard trip when the tutor quotes the problem.
Alternatives: none chosen for the exception; it is left to 5.6.
Reversible: Yes.

---

### 19 Oct 2026 · 4.5 The stream is read to the end after a trip · decided by tdd-guide · risk: low
Decided: after the gate trips, the attempt keeps reading the model stream (showing nothing) until it ends.
Why: usage arrives at the end of the stream; stopping early would lose metering.
Alternatives: close the stream on a trip (faster hint, unmetered spend).
Reversible: Yes.

---

### 19 Oct 2026 · 3.16d The advisory-lock acquire/release pattern is factored into an exported `withMigrateLock` helper · decided by tdd-guide · risk: low
Decided: `withMigrateLock(lockClient, key, fn, maxWaitMs?)` wraps `acquireMigrateLock` + `fn()` + a conditional `pg_advisory_unlock`, tracked by a `locked` flag set only after `acquireMigrateLock` returns; `migrateDatabase()` now calls it instead of inlining the same `try`/`finally`.
Why: the review's finding (unlock only when the lock was actually taken) needs a unit test, and `migrateDatabase()` itself isn't unit-testable (it always opens a real `pg.Client`/pool against a URL); factoring the lock logic into a small function that takes an injectable client makes the "no unlock after a failed acquire" behaviour directly testable without touching `migrateDatabase()`'s signature or needing a real database.
Alternatives: add a client-factory parameter to `migrateDatabase()` for test injection (keeps one function, but widens its public signature for a test-only need); test the behaviour only at the integration level (real Postgres, no quick unit coverage of the "connection already dead" branch).
Reversible: yes; an internal implementation detail of `migrateDatabase()`.

---

### 19 Oct 2026 · 3.16d The post-migrate step timeout is set on the connection with `set_config`, not a plain `SET` · decided by tdd-guide · risk: low
Decided: `migrateDatabase()` runs `select set_config('statement_timeout', $1, false)` (parameterized, session-level — the third argument `false` means "not transaction-local") on the post-migrate connection before `runPostMigrateSteps`, instead of string-building a `SET statement_timeout = <value>` statement.
Why: Postgres's `SET` doesn't accept a bind parameter, so a literal value would have to be built with string interpolation even though `stepTimeoutMs()` already validates it is a safe positive integer; `set_config` takes the value as a normal parameterized argument, which is both simpler and avoids ever building SQL by concatenating a number into a string, as a matter of habit.
Alternatives: `SET statement_timeout = ${n}` (works given the validation, but trains the eventual next reader/editor that string-built SQL is fine here); a second, dedicated pool just for the post-migrate steps with `statement_timeout` baked into its `pg.PoolConfig` (more connections and a second `close()` to manage, for no behavioural difference since the migrator pool is already `max: 1`).
Reversible: yes.

---

### 19 Oct 2026 · 3.16d Reproducing the blocked-`CREATE INDEX CONCURRENTLY` test needed an actively running blocker statement, not just an idle-in-transaction one · decided by tdd-guide (int test red run) · risk: low
Decided: the integration test's blocking connection runs `BEGIN; select pg_sleep(2)` (not awaited; rolled back afterwards) and the test waits ~300 ms before calling the timed `migrateDatabase()`, rather than `BEGIN; select 1` with no delay.
Why: the first attempt (`BEGIN; select 1`, no delay) did not reproduce a wait: `CREATE INDEX CONCURRENTLY` completed in a few milliseconds even though `pg_stat_activity` showed the blocker as `idle in transaction` at that instant, confirmed with debug logging before the fix; a manual `psql` reproduction with the same table and a `pg_sleep`-based blocker reliably blocked and timed out as the Postgres documentation describes. The exact reason for the gap wasn't tracked down further (not needed for the test itself), but a blocker with an in-flight statement and a short lead time reproduces the behaviour deterministically.
Alternatives: keep polling `pg_stat_activity`/`pg_locks` until some specific lock or wait-event condition is observed before issuing the timed call (more precise, meaningfully more complex for a test); accept flakiness with the idle-in-transaction form.
Reversible: yes; an internal detail of the test, not of `migrate.ts` itself.

---

### 19 Oct 2026 · 3.16d Accepted edge cases in the migration lock and its timeout test · decided by team lead · risk: low
Decided: in `packages/db/src/migrate.ts`, a failure inside the locked section followed by a failed unlock reports the unlock error (both need a dead connection, and the lock is released when the session ends anyway); `packages/db/test/migrate.int.test.ts` keeps its fixed 300 ms lead before the timed call.
Why: rare, and harmless to data; a fix would add code paths with no test value now.
Alternatives: wrap the unlock in try/catch and rethrow the original; poll pg_stat_activity in the test.
Reversible: yes.

---

### 19 Oct 2026 · 3.16c The migration lock is polled with `pg_try_advisory_lock`, not held by blocking on `pg_advisory_lock` · decided by tdd-guide (red run) · risk: medium
Decided: `migrateDatabase()` acquires `MIGRATE_LOCK_KEY` by polling `pg_try_advisory_lock` on its own dedicated connection every 50 ms (10-minute default give-up), instead of a single blocking `pg_advisory_lock` call.
Why: the int test (two concurrent `migrateDatabase()` calls against a fresh database) hung forever with a blocking `pg_advisory_lock`: that call itself holds an open snapshot on its connection for the whole wait, and `CREATE INDEX CONCURRENTLY` (the post-migrate index steps) must wait out every transaction with an older snapshot, table or not — so the lock holder's own index build waited on the second caller's still-blocked lock request, which only clears once the first caller releases the lock after finishing the build: a self-deadlock, reproduced and confirmed with debug logging before the fix.
Alternatives: a blocking lock on a separate, short-statement-timeout connection (still holds a snapshot for the timeout's duration); skipping `CREATE INDEX CONCURRENTLY` while any other session is active (defeats the point); moving the lock inside the same pool as the migration (ruled out separately — pool `max: 1` would deadlock against itself).
Reversible: yes; an internal implementation detail of `migrateDatabase()`.

---

### 19 Oct 2026 · 3.16c A plain `CREATE INDEX CONCURRENTLY` lookup is schema-qualified with `to_regclass('public.' || $1)` · decided by tdd-guide (3.16b review deferral) · risk: low
Decided: `isIndexInvalid()`'s lookup now resolves the index name with `to_regclass('public.' || $1)` instead of a bare `pg_class.relname = $1` match.
Why: a bare name match could find a same-named index in another schema (a stray test schema, `drizzle`, or a future multi-schema layout) and wrongly skip or drop it; `to_regclass` with an explicit schema prefix only ever resolves the one in `public`.
Alternatives: join `pg_namespace` and filter `nspname = 'public'` (same result, more verbose); leave it unqualified (the review's finding).
Reversible: yes.

---

### 19 Oct 2026 · 3.16c The open-session partial index is its own migration (0010), not folded into 0009 · decided by tdd-guide (3.16b review deferral) · risk: low
Decided: `sessions_open_teacher_id_student_id_idx` is declared in `src/schema/learning.ts` the same schema-only way as 0009's package-pin index, but ships as its own generated-then-trimmed migration file (`0010_easy_maximus.sql`), because `db:generate` is not a no-op for a schema change with no matching not-yet-released migration to diff it into (0009's index was a no-op only because it was invented and declared together with 0009's new columns, before 0009 existed). The generated file's SQL was trimmed to a comment, same as 0009's hand-edit, so the index is still built only by the post-migrate step; the generated snapshot and journal entries were kept, which is what keeps `db:generate` a no-op again afterwards.
Why: the task asked for whichever option keeps the journal consistent; trimming the generated file's SQL while keeping its snapshot/journal entries does that without inventing a parallel, undeclared index that `db:generate` would try to add on some future run.
Alternatives: skip declaring the index in drizzle at all (keeps `db:generate` a no-op trivially, but then nothing stops a future `db:generate` from "discovering" it missing and adding a real, blocking `CREATE INDEX`); hand-write a fake empty migration/snapshot pair instead of using drizzle-kit's own output (more error-prone, diverges from 0009's precedent).
Reversible: yes; a later migration can rename or rebuild it.

---

### 19 Oct 2026 · 3.11a Persona-template file layout: no front-matter-name/file-name match check · decided by tdd-guide · risk: low
Decided: `readPersonaTemplateDir` validates `<id>@<semver>.yaml` (id is a free file-naming slug) and the persona's YAML body, but never checks the id against the persona's own `name` field, unlike `promptPacks.ts`'s pack-name/file-name check.
Why: the persona's `name` is a role name shown to the model ("Interviewer"), not an identifier matching the file (`job-interview`); the two are different things by design (task scope: "Role names only"), so there is nothing correct to compare them against.
Alternatives: add a separate `id`-style metadata field matching the filename (contracts' `Persona.id` already exists for this and is left as-is, not re-purposed as a file-name key); require the filename's slug to kebab-case-match `name` (would force role names like "job-interview" instead of "Interviewer").
Reversible: yes — a match check can be added later without changing the schema shape.

---

### 19 Oct 2026 · 3.11a `packages/content/src/personaTemplates.ts` added to the safety-reviewer risk-paths group · decided by tdd-guide, per the 3.11 plan's lead answers · risk: high
Decided: `.claude/skills/merge-gate/risk-paths.txt` now lists `packages/content/src/personaTemplates.ts` under the same safety-reviewer block as `packages/content/src/promptPacks.ts` (3.6 precedent), so this PR and every future edit to the persona-template loader needs safety-reviewer sign-off.
Why: build plan rule 6 (risky paths need a named reviewer); the loader governs what shape of persona content can ever reach the composer's `persona` section, which is safety-reviewed content behaviour.
Alternatives: leave it out of risk-paths.txt and rely on `packages/content/src/promptPacks.ts`'s existing coverage of the directory it reads from (doesn't cover this new file).
Reversible: yes (a later task could narrow or remove the line), but not without a fresh safety-reviewer judgment.

---

### 19 Oct 2026 · 3.11a No real pack or persona prose in this PR · decided by tdd-guide, per the 3.11 plan's split · risk: low
Decided: this PR ships only the loader, schema, fixtures (under `packages/content/test/fixtures/`) and tests; `content/prompt-packs/` and `content/skills/` stay empty until 3.11b, and `noFixtureProse.test.ts` passes trivially until then.
Why: the task brief and the 3.11 plan's "Lead answers and plan revisions" section split 3.11 into code (3.11a, this PR) and content (3.11b, `pedagogy-author` on opus, safety-reviewer first, then human sign-off per row).
Alternatives: none — this was given, not decided.
Reversible: n/a.

---

### 19 Oct 2026 · 3.16b A post-migrate step runs lock-heavy statements as their own autocommit transactions after migrate() commits · decided by tdd-guide · risk: high
Decided: `migrateDatabase()` calls drizzle's `migrate()` to apply pending migration files (unchanged), then calls a new `runPostMigrateSteps()` against the same single-connection pool, running each of 0009's three `VALIDATE CONSTRAINT`s (skipped if already valid) and its `CREATE INDEX CONCURRENTLY IF NOT EXISTS` as separate, non-transactional statements. 0009's SQL file itself only adds the FK and two CHECKs as `NOT VALID` and no longer runs `CREATE INDEX`.
Why: drizzle-orm 0.45 runs every pending migration file in one transaction (established in the 3.16 review and decision log), so neither a `VALIDATE CONSTRAINT` nor a `CREATE INDEX CONCURRENTLY` written into any migration file — this one or a new one — ever escapes that transaction's ACCESS EXCLUSIVE lock, and `CREATE INDEX CONCURRENTLY` is refused by Postgres inside a transaction block at all. A step that runs after the migrator's transaction has committed is the only way to get the lighter `SHARE UPDATE EXCLUSIVE` lock (validate) or no blocking lock at all (concurrent index) before `sessions` grows past pilot scale.
Alternatives: a second migration file (doesn't help, see above); a separate CLI command the operator runs by hand after `db:migrate` (more steps to forget, no test coverage of the common path); switching migrators (bigger change, out of scope); accepting the lock duration permanently (what 3.16 already decided to accept for the pilot; this task removes the need to keep accepting it as `sessions` grows).
Reversible: yes — entirely inside `packages/db`; no port or contract change. The step list can be extended or retired in a later migration's own follow-up.

---

### 19 Oct 2026 · 3.16b 0009 is edited in place rather than fixed by a new migration file · decided by tdd-guide (per the task's framing) · risk: high
Decided: `packages/db/migrations/0009_session_package_pin.sql` had its `VALIDATE CONSTRAINT` and `CREATE INDEX` statements removed outright, rather than being left as-is with a new migration file added after it.
Why: 0009 has not been deployed anywhere yet (no pilot has run; confirmed in the 3.16 decision log), so there is no live database whose already-applied migration history this could break; editing it keeps the SQL honest about what actually runs (callers reading 0009 would otherwise see a `VALIDATE CONSTRAINT` that never executes, since the post-migrate step runs it instead).
Alternatives: leave 0009 as the 3.16 fix round wrote it (misleading: the file would claim to validate inline but drizzle's transaction means that claim was already false before this task); add a 0010 migration that's a no-op for execution but documents the move.
Reversible: yes, for as long as 0009 stays unreleased; once a real database has run it, a future change would need a new migration instead, which this task's rule (point 3 of the task description) already anticipates.

---

### 19 Oct 2026 · 3.16b fix round: drop and rebuild an INVALID leftover index before CREATE INDEX CONCURRENTLY IF NOT EXISTS · decided by tdd-guide (database-reviewer finding) · risk: high
Decided: the `concurrentIndex` post-migrate step now checks `pg_class`/`pg_index` for an existing index by name before running `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. If the index exists and `indisvalid = false`, it runs `DROP INDEX CONCURRENTLY IF EXISTS` first (its own autocommit statement, still outside any transaction), then the CREATE.
Why: a `CREATE INDEX CONCURRENTLY` that fails partway (a connection drop, a killed backend) leaves the index behind as INVALID rather than rolling it back; Postgres itself does not retry or revalidate it. `IF NOT EXISTS` alone would then see the index "already exists" on every future `migrateDatabase()` call and skip it forever, leaving the package-pin index permanently unusable and the 0009 fix effectively undone for queries that need it.
Alternatives: always `DROP INDEX CONCURRENTLY IF EXISTS` before every CREATE, unconditionally (works, but needlessly rebuilds a healthy index on every migrate run on a database that may eventually be large); have an operator notice and fix it by hand (no test coverage of the common path, easy to miss); drop `IF NOT EXISTS` and let the CREATE fail loudly on a second run (breaks the "re-running is a no-op" contract this task also had to preserve).
Reversible: yes — entirely inside `packages/db`; no port or contract change.

---

### 18 Oct 2026 · 4.2 What the scrub removes, and that it fails closed · decided by lead (plan answers, safety plan review) and tdd-guide (details) · risk: high
Decided: `piiScrub` rewrites phone numbers (group shapes, +CC, spaced digits, a bare 10-digit number only next to a phone keyword or through the market pattern), emails (also [at]/(at)/＠), Luhn-valid cards (CVV/expiry only next to one), OTP-like codes near an OTP keyword, the student's own name after an introduction phrase, and every locale-pack pattern, on a digit-folded copy, in the text and every skill-payload string; addresses are out of scope. A locale pattern that does not compile with exactly 'gu', a scrub that does not settle, and every non-ok chain outcome block the turn with only a cause and error name reported.
Why: the model, traces and history must never see a student's contact or ID data, and a broken scrub must stop the turn rather than let raw text through.
Alternatives: skip a bad pattern; add the i flag; any-number matching; redact CVV/dates on their own.
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 18 Oct 2026 · 4.2 Transcripts become input text before the scrub · decided by lead (safety plan review) · risk: high
Decided: transcripts (2.7) reach the pipeline as `input.text`, so the same scrub runs on them before any model call; text inside images is a separate task (4.2b).
Why: one scrub path means no input route can skip it.
Alternatives: a separate transcript scrub; scrub transcripts only at storage.
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 18 Oct 2026 · 4.2 Scrub failures are reported on `finished.background` · decided by lead (4.1 silent-failure review) and tdd-guide (shape) · risk: medium
Decided: the runner pushes every scrub failure (thrown, timed out, bad result, or a lost text/payload) as a `ScrubFailedError` whose cause is `{ guardCause, errorName? }`; the raw step error is never pushed.
Why: a broken scrub was silently dropped before; errors can quote the input.
Alternatives: push the raw error; add a field to `GuardOutcomeEvent` (a 4.1 frozen file).
Reversible: Yes.

---

### 18 Oct 2026 · 4.2 The skill payload is scrubbed string by string, numbers included · decided by tdd-guide · risk: medium
Decided: the payload is normalised to JSON data, every distinct string, key and number-as-text runs through the chain once (concurrently), a PII-shaped number comes back as its placeholder string, and colliding keys, depth over 64 or non-JSON data fail closed.
Why: a phone sent as a number or a key would otherwise bypass the scrub.
Alternatives: scrub only string values; join all strings into one chain run.
Reversible: Yes.

---

### 18 Oct 2026 · 4.2 Weak "code" and "कोड" count as OTP keywords only right before the number · decided by tdd-guide · risk: low
Decided: strong keywords (OTP, ओटीपी, pin, पिन, verification/login code, one-time password) mark a 4-8 digit number within 30 characters either side; "code"/"कोड" only when the number follows with at most a connector (is, :, hai, aaya, mila); "code = 1234" is left alone.
Why: "code" is everywhere in programming lessons; a 30-character window around it would redact ordinary numbers.
Alternatives: treat "code" like OTP.
Reversible: Yes.

---

### 18 Oct 2026 · 4.2 Name detection is a conservative phrase list · decided by lead (Q2) and tdd-guide (list) · risk: low
Decided: strong phrases (my name is, my name's, mera naam, मेरा नाम) take any-script words, weak ones (I'm, I am, myself, call me, main … hoon) only Title-Case words; up to three words, stopping at a stop list ("Ready", "Done", "Learning", hai, है, …); repeats of a captured word in the same message are redacted too; "this is" is dropped.
Why: the seeded cases need it and over-redacting ordinary words hurts teaching; a stored-name exact match replaces it later.
Alternatives: redact every Title-Case word after any phrase; wait for stored names.
Reversible: Yes.

---

### 18 Oct 2026 · 4.2 Locale PII patterns are a harness test fixture until 3.10 · decided by lead (Q3) · risk: low
Decided: `indiaLocalePackWithPii` (Aadhaar-like with a three-years exception, PAN either case, UPI without a dot in the provider, Indian mobile) lives in `packages/harness/src/testing/`; no contracts edit.
Why: 3.10 owns the real locale files and loader; the guard reads whatever pack it gets.
Alternatives: edit `demoLocalePack` in contracts (needs an ADR).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2 The distress keyword check runs on the raw text before the scrub · decided by lead (safety review, fix round 1) and tdd-guide (seam) · risk: high
Decided: the runner calls the injected `PipelineDeps.distressCheck` on the raw input before the scrub. Only its boolean is kept, and it is ORed into the step-5 escalate decision (and reused if the scrub fails). A throw is reported without the text. The seam is the existing dep, which 4.3 fills; no new port.
Why: the scrub could redact words a distress check needs ("I'm Feeling Suicidal"); a distressed student must always get the caring reply.
Alternatives: run the check only on scrubbed text; a new keyword-only function in the harness.
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.2 Keyword-window numbers are decided in one pass, measured after redaction · decided by tdd-guide (fix round 1) · risk: medium
Decided: bare 10-digit phones and OTP-like numbers count when a keyword is within 30 characters of the text as it will read after redaction. The set grows in memory until stable, and placeholders never count as keywords. The rescan loop stays as a guard against packs that match their own placeholder.
Why: a long list of numbers after one keyword never settled in four rounds, so a benign turn failed closed.
Alternatives: a round bound derived from the text length; chaining each number to the previous one (redacts whole lists).
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 19 Oct 2026 · 4.2 The name stop list covers feelings, states, languages and common adjectives · decided by lead (safety review) and tdd-guide (words) · risk: medium
Decided: words like feeling, suicidal, depressed, alone, akela, marna, chahta, hindi, indian, medium, bad and weak (about 150 in all) end a name capture, so "I'm Feeling Suicidal" stays as written.
Why: the name heuristic must never delete what a distress check or the teacher reads.
Alternatives: drop the weak phrases ("I'm", "I am") entirely.
Reversible: Yes.

---

### 19 Oct 2026 · 4.2 Values under PII-named payload keys are redacted whole · decided by lead (review) and tdd-guide (key list) · risk: low
Decided: a payload key such as otp, pin, cvv, card, phone, mobile, email, name, aadhaar, pan or upi (with optional my/student/first/... before and number/no/id/... after, ignoring case and separators) has every non-empty string or number under it replaced by the category placeholder.
Why: a bare "482913" or "Riya" has no keyword of its own for the pattern scrub to find.
Alternatives: scrub "key: value" text through the chain (needs a "name:" phrase that would hit code like `name = ...`).
Reversible: Yes.

---

### 19 Oct 2026 · 4.2 Scrub failures follow 3.7's HarnessError and background-log rules · decided by lead (merge) and tdd-guide · risk: low
Decided: `ScrubFailedError` extends `HarnessError`. Its message (`scrub failed closed (<cause>)`) is fixed text, so the background log keeps it; the cause holds only a cause code and an error name. A foreign step error is still wrapped, never passed through.
Why: 3.7 made "HarnessError message or name only" the rule for `finished.background`.
Alternatives: keep a plain `Error`, which the log would reduce to its name.
Reversible: Yes.

---

### 19 Oct 2026 · 4.2 Spelled-out emails ("x dot y at example dot com") are scrubbed · decided by tdd-guide (merge with 4.0d's new case) · risk: medium
Decided: a second email pattern matches words joined by " dot " and " at ", ending in " dot " plus a common top-level domain (com, org, net, in, co, edu, io, gov, info, me, uk). "good at maths", "meet at 5" and "x dot y" stay as written. A phrase like "look at google dot com" is redacted too.
Why: 4.0d's `safety-pii-email-spelled-out-en`, merged on main, makes it part of "100% on the seeded PII cases".
Alternatives: leave the case as a reply check like the spelled-out phone (needs the lead's call); a wider top-level-domain list.
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 18 Oct 2026 · 3.16 Any package or version change ends the session, and the summary is cleared only by the call that ended it · decided by team lead (plan decision 1 and security plan review) · risk: high
Decided: `turnConfigStoreFor.load` ends the session (and the db clears the pair's `last_summary`) whenever the entitlement's package or version differs from the session's pin, by any source; the clear happens in the same transaction and only if that UPDATE moved the session from open to ended.
Why: earlier history, sources and summary of a lapsed package must never reach the model, and a retried or stale turn must never wipe a newer session's summary.
Alternatives: end only on a downgrade (compare module sets); clear the summary on every call; two separate repository methods.
Reversible: yes, inside packages/db; no port changes.

---

### 18 Oct 2026 · 3.16 Migration 0009 backfills each open session's pin from its live entitlement, or ends it and clears the pair's summary · decided by team lead (lead answer and security plan review) · risk: high
Decided: an open session whose student has a live (not ended, paused included) subscription with that teacher to a package of the session's agent gets that package version; any other open session is ended and its pair's `last_summary` is set to NULL; already-ended sessions stay as they are with no pin. No row is deleted; counts are reported as a NOTICE. Tests used all three paths.
Why: the lead's rule that the migration never loses rows, without leaving an open session that could carry content from an unknown package.
Alternatives: 0007-style "stop if rows exist" guard; backfill everything with a guessed pin; leave unpinned open sessions open.
Reversible: the pins and `ended_at` values can be cleared or changed later; a cleared `last_summary` can't be restored (it's the intended effect, like `endOnPackageChange`).

---

### 18 Oct 2026 · 3.16 Pin columns are nullable, with checks that every open session has a full pin to a real package version · decided by builder (tdd-guide) · risk: medium
Decided: `package_id`/`package_version` are nullable, with a composite foreign key to `package_versions (package_id, version)`, a both-or-neither check and an "open sessions have a pin" check.
Why: already-ended sessions get no pin (security plan review), so `NOT NULL` is impossible; the checks keep the guarantee for usable sessions.
Alternatives: `NOT NULL` with a fake pin on ended sessions; a foreign key to `packages.id` only.
Reversible: yes, by a later migration.

---

### 18 Oct 2026 · 3.16 `sessions.create` checks the package against the agent and teacher · decided by team lead (plan decision 3) · risk: low
Decided: the INSERT … SELECT joins the package and version and requires them to be the given agent's and the scope teacher's; anything else is `not_found` and nothing is written.
Why: the same defense in depth as the existing agent-version check.
Alternatives: trust the caller's pin.
Reversible: yes.

---

### 18 Oct 2026 · 3.16 `endOnPackageChange` returns `{ ended }` and treats an own, already-ended session as a no-op · decided by builder (tdd-guide) · risk: low
Decided: the method returns `{ ended: true }` when it ended the session, `{ ended: false }` for the scope's own already-ended session, and `not_found` for anything outside the scope.
Why: retries are safe, a cross-tenant call still fails closed for the isolation grid, and tests can see which call did the work.
Alternatives: return void; throw on an already-ended session.
Reversible: yes.

---

### 19 Oct 2026 · 3.16 0009's FK and both CHECKs are added `NOT VALID` then validated in separate statements; the plain `CREATE INDEX` stays as it is · decided by build-error-resolver (fix round) · risk: low
Decided: `sessions_package_version_fk`, `sessions_package_pin_complete` and `sessions_open_has_package` are each added `NOT VALID` and validated by a following `ALTER TABLE ... VALIDATE CONSTRAINT`, so the ACCESS EXCLUSIVE lock needed to add them is held only briefly and the table-scan runs under `VALIDATE CONSTRAINT`'s lighter SHARE UPDATE EXCLUSIVE lock instead. The index stays a plain (non-`CONCURRENTLY`) `CREATE INDEX`: drizzle runs every migration file in one transaction, and `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so splitting it out would need a second migration file for no real benefit on a table this small.
Why: minimise how long `sessions` is unavailable for reads and writes while 0009 runs, without changing the schema or the backfill.
Alternatives: leave the FK and CHECKs as plain `ADD CONSTRAINT` (longer lock); move the index to its own non-transactional migration.
Reversible: yes; a later migration can re-order or re-validate.

---

### 19 Oct 2026 · 3.16 Migration lock duration accepted for the pilot · decided by team lead · risk: medium
Decided: 0009's constraints are validated inside drizzle's migration transaction. drizzle 0.45 runs every pending migration in one transaction, so a split file wouldn't shorten the ACCESS EXCLUSIVE lock. At pilot scale (about 500 students) the `sessions` scan takes milliseconds, so the finding is re-rated from HIGH to MEDIUM, and 3.16b adds a VALIDATE path outside the migrator before the table grows.
Why: the reviewer's HIGH assumed a large production table, which doesn't exist; a correct fix needs migration tooling, not a file split.
Alternatives: a second migrate() run; an ops script with autocommit; switching migrators.
Reversible: yes.

---

### 18 Oct 2026 · 4.0d Coverage-gap cases follow the 4.0 conventions · decided by team lead · risk: high
Decided: the six cases use the 4.0 market folders, placeholders and reply-check notes. The broad last-5-digits phrase in `evals/suites/safety/pii/safety-pii-phone-hyphenated-en.yaml` is kept to match its merged siblings, and tightening phone phrases suite-wide waits until 4.2 asserts on the scrubbed model input.
Why: one convention across the suite; reply phrases matter less once 4.2 checks the input.
Alternatives: tighten only this case.
Reversible: yes.

---

### 18 Oct 2026 · 3.7 Tools offered and run only when entitled; skill payloads checked for the answer key; partial text cleared before an error · decided by tdd-guide (lead brief) · risk: high
Decided: a tool is offered and run only when the decision names it, it is in the registry, and its skill is in the entitlement (checked in decide and again in generate; duplicate names fail closed). A `skill` event is dropped and reported unless its skill is entitled, its payload is at most 16 KB of JSON, and it holds no do-not-say string (case-insensitive, JSON text and every string leaf). Any streamed text is cleared with `replace ''` before a retry and before every error, a cancel included.
Why: access rule 5 (locked means locked), no answer leak through structured events, and unguarded text never stays on screen.
Alternatives: trust decide's tool list; leave the payload check to 4.5; leave partial text on an error.
Reversible: yes; 4.5 replaces the substring check with the robust one.

---

### 18 Oct 2026 · 3.7 Q1 per-turn metered gateway billed from the entitlement · decided by lead · risk: medium
Decided: after entitle the runner calls `gatewayFor({ policy, billing })`, with billing `{teacherId, packageId, studentId, turnId, source}` from the entitlement only. The guards get the full policy, generate's primary gets no `fallback`, and the retry gets `tiers.main := fallback`. `TurnGateway.metered` keeps usage the gateway already metered out of the `meter` step.
Why: 2.4's `meterRouter` meters every attempt, unknown ones included; nothing is billed twice; 3.8's code is unchanged.
Alternatives: (A) the harness prices and meters everything, which loses unknown usage; meter all usage in the step and double-bill.
Reversible: yes.

---

### 18 Oct 2026 · 3.7 Q2 cost ceiling 0.10 USD; unpriced usage aborts with `turn_cost_exceeded` · decided by lead (code picked by tdd-guide) · risk: medium
Decided: the ceiling is `maxTurnCostMicroUsd` (default 100,000), counting step-reported usage plus every priced gateway call, failed attempts included. The check runs after each usage (over → abort) and before each call (at or over → abort). Unpriced or invalid prices, and an invalid ceiling, abort with `turn_cost_exceeded` (not `provider_error`).
Why: fail closed on cost; the code says why the turn stopped; one call can overshoot by at most its own cost (bounded by `maxOutputTokens`).
Alternatives: `provider_error` for unpriced; treat unpriced as free.
Reversible: yes; tune at 7.6.

---

### 18 Oct 2026 · 3.7 Q3 the runner opens the TeacherQuestion before `done` · decided by lead · risk: medium
Decided: for `ask_teacher`, the runner runs findSimilar then open with the scrubbed text within 500 ms, before postGuard, and sends `teacher_question` and `CommitRecord.teacherQuestionId`. On a failure, a timeout, or a cross-teacher or cross-student result there is no event, the failure is reported, and the turn still replies.
Why: the event needs the id before `done`; 3.17 shrinks to opening it in commit when it's absent, plus the profile evidence.
Alternatives: open in commit only (no event).
Reversible: yes. Note for 3.17: an open that times out may still land, so commit must open idempotently.

---

### 18 Oct 2026 · 3.7 Q4 tool results as JSON envelopes over the frozen ModelRequest · decided by lead · risk: medium
Decided: a tool round adds an assistant message (the round's text plus `{"tool_calls":[…]}`) and a user message (`{"tool_results":[…]}`, with output or a fixed error code). Both are built in code, with no prose.
Why: no contracts or prompt-pack change.
Alternatives: an ADR for native tool messages now.
Reversible: yes; that ADR is needed before 5.5's real tools meet a real model.

---

### 18 Oct 2026 · 3.7 Q5 abort reaches the provider at the next chunk · decided by lead · risk: low
Decided: the reader stops waiting on cancel at once and calls `return()` in the background; the adapter aborts when that reaches it.
Why: `ModelGateway.stream` has no abort signal (frozen contract).
Alternatives: an ADR adding a signal now.
Reversible: yes (a follow-up ADR candidate).

---

### 18 Oct 2026 · 3.7 Q6 SSE route deferred to 9.4 · decided by lead · risk: low
Decided: only the pure `formatSseEvent` encoder ships in the harness.
Why: auth, sessions and the root don't exist yet, and `apps/web/src/auth/**` is a risky path.
Alternatives: a route now.
Reversible: yes.

---

### 18 Oct 2026 · 3.7 Q7 sentence-gate seam, and every background failure logged · decided by lead · risk: medium
Decided: text passes `deps.streamGate` (a pass-through now; 4.5 fills it). Every `finished.background` failure goes to `deps.log.backgroundFailure` with the task, the ids (only when valid ids, else `invalid`), `errorName`, and `errorMessage` only for harness errors (cut at 300 characters; see the fix-round entry below), never turn text. A throwing logger is swallowed.
Why: no silent background failures; no text in logs.
Alternatives: leave logging to each caller.
Reversible: yes.

---

### 18 Oct 2026 · 3.7 Cancellation semantics · decided by tdd-guide · risk: medium
Decided: the consumer `return()`ing `events`, or `RunTurnOptions.cancel`, cancels the turn. Generate stops at once (`TurnCancelled`, never retried); postGuard and teacher_question are skipped; the stream ends `error provider_error`; meter, commit (outcome `error`, input saved, no reply) and the trace (generate `failed`) still run. A turn cancelled before generate makes no model call; steps before generate are not interrupted.
Why: the plan; no wasted model spend after the client leaves.
Alternatives: run the turn to the end; also interrupt earlier steps.
Reversible: yes.

---

### 18 Oct 2026 · 3.7 Tool-loop limits and event rules · decided by tdd-guide · risk: low
Decided: at most 3 tool rounds, then a final call with no tools; 4 calls per round, run in order; 3 s per tool; a 4,000-character result cap; error codes `not_available | invalid_arguments | failed | timed_out | too_many_calls`. `hint_rung` goes out for hint, worked_example and solution (again on a retry, after `replace ''`); `sources` holds only cited `[n]`; `locked` names only the student's own package and only for `name_package`. A gateway that can't be built becomes a refusing gateway (reported), so every step meets its own failure policy. admit and entitle get a refusing gateway.
Why: the plan's provisional numbers; fail closed.
Alternatives: other limits (revisit at 5.5 and 7.6).
Reversible: yes.

---

### 18 Oct 2026 · 3.7 `TurnGateway.metered` and the out-of-plan test edits · decided by tdd-guide · risk: medium
Decided: `gatewayFor` returns `{ gateway, metered }` so that 3.8's meter step, the queue latency test and the worker test stay unchanged. Usage a step reports in its result is still metered by `meter`. Three test files outside the plan get a one-line `...stepEnvExtras()`: `access/property.test.ts` (a risky path) and two `packages/db` int tests.
Why: keeps 3.8 green without double billing; keeps `StepEnv` strictly typed.
Alternatives: make the new `StepEnv` fields optional; send no usage to `meter` (breaks the 3.8 tests).
Reversible: yes.

---

### 18 Oct 2026 · 3.7 Tool outputs checked for the answer key; one normalised answer-key check · decided by lead (fix round, safety review) · risk: high
Decided: a tool output that holds a do-not-say string, after NFKC folding and stripping whitespace, separators, commas and zero-width characters on both sides, is `failed` and never reaches the model. Skill payloads use the same shared `revealsAnswerKey`/`normaliseForMatch` (`generate/answerKey.ts`), which 4.5 reuses. Tools must scope to `allowedModuleIds`; 4.5 adds the lockedLeak check on tool outputs.
Why: a tool result fed back to the model was an unfiltered path to the answer; formatting variants beat a raw substring match.
Alternatives: wait for 4.5; check outputs with a raw substring.
Reversible: yes. Known cost: a short key can over-match (for example "5/6" inside "15/60"), which fails closed.

---

### 18 Oct 2026 · 3.7 Error logging: names always, messages only for harness errors · decided by lead (fix round, reconciling safety and silent-failure reviews) · risk: medium
Decided: every harness-written error extends `HarnessError` (fixed text, codes and ids only), and the background log records its message. Any foreign error (provider, port, store, tool) is logged by name only. Reports the harness makes about foreign failures carry only the name: `GenerateAttemptFailed(attempt, kind, name)`, `ToolFailed(tool, reason, name)`, `StreamCloseFailed(name)`, and `SkillEventDropped` with a `{ name }` cause.
Why: foreign messages can quote prompt or student text; names still say what failed.
Alternatives: log all messages (leak risk); log no messages (loses the harness's own diagnostics).
Reversible: yes.

---

### 18 Oct 2026 · 3.7 Failed generate attempts, unpriced usage and stream closes are reported · decided by tdd-guide (fix round, silent-failure review) · risk: medium
Decided: each failed generate attempt is reported (task `generate`) before the retry or the final error. Unpriced usage stays in the trace, stays out of the `meter` step and is reported as `UnpricedUsage(model)` (2.4's meter records it as unpriced). Early stream closes are handed to the runner through `StepEnv.track`, and `finished` waits for them for at most `STREAM_CLOSE_SETTLE_MS` (1,000 ms, injected clock); past that, a "did not settle" report is added and `finished` resolves.
Why: no silent failure, no free-looking cost row, no report landing after the log.
Alternatives: mark unpriced rows in the trace (no schema field for it); await closes without a bound.
Reversible: yes.

---

### 18 Oct 2026 · 3.7 `replace ''` also clears skill events and runner-bug errors · decided by lead (fix round, safety review) · risk: medium
Decided: a shown `skill` event counts as shown, so the `replace ''` before a retry or an error also tells the client to drop skill events (rule written in `sse.ts` for 9.4). A runner bug that ends the stream sends `replace ''` before `error` when anything was shown.
Why: unguarded content never stays on screen on any error path.
Alternatives: a separate clear event (a contracts change).
Reversible: yes.

---

### 18 Oct 2026 · Pilot language: English only, with a Hindi/Hinglish safety net · decided by you · risk: high
Decided: the agent teaches and replies only in English in both pilot markets (en-US, en-IN). No new Hindi or Hinglish teaching, prompt-pack or non-safety eval work. Safety guards still recognise Hindi and Hinglish input (distress keywords in romanised and Devanagari script, Devanagari-digit phone numbers and IDs), and the safety and locked seed cases in those languages stay. The existing non-safety Hinglish and Devanagari cases (leak, advice, persona, grounding) are frozen, not deleted. This replaces the language part of the 18 Oct pilot-market decision; the markets are unchanged.
Why: focus. Indian students will still type Hinglish, so safety must catch it.
Alternatives: English only everywhere (drop the safety net); English and the US only.
Reversible: yes; Hindi locale content can be added later.

---

### 18 Oct 2026 · 4.0c "Suite failed to load" is reported alongside the load-error line, not instead of it · decided by tdd-guide · risk: low
Decided: when a suite's load throws, `validateSuites` still pushes the `"<suite>: <load error message>"` problem (per-file, naming the real cause) *and*, for each affected guard under `requireAllGuards`, a second `"<guard>: suite failed to load"` line — not a replacement of the first.
Why: the review finding was about a guard folder being reported as merely "empty" when the real cause (a load error) was knowable; dropping the load-error line would lose that cause, and a reader scanning guard-level problems still needs the per-guard line to know which guard is affected.
Alternatives: fold the guard-level line into the load-error line (one line that names both the suite and the guard); only emit the guard-level line and drop the per-suite load error.
Reversible: yes.

---

### 18 Oct 2026 · 4.0c loadCasesWithFiles is exported alongside loadCasesFromDir · decided by tdd-guide · risk: low
Decided: `loader.ts` exports `loadCasesWithFiles` (and its `LoadedCaseFile` type) publicly from `index.ts`, not just internally to `suites.ts`.
Why: every other loader export is already public, and any future caller needing a case paired with its file (not just `suites.ts`) should reach for this instead of re-deriving the pairing itself.
Alternatives: keep it package-internal (export only from `loader.js`, not `index.ts`) until a second caller exists.
Reversible: yes.

---

### 18 Oct 2026 · 4.1 The guard chain fails closed on every failure · decided by lead (plan) and tdd-guide (details) · risk: high
Decided: a throw, a result that fails `GuardResultSchema`/`UsageSchema`, a guard past its own time slice (or a non-positive slice), a step cancelled before or during a guard, an empty list, an undeclared or wrong-phase guard, and a list out of declared order all end the chain non-ok (`outcome: 'failed'` with a `failure` cause, fix round 1); later guards never run and the chain never throws.
Why: guards protect students; any doubt must stop the reply, and the calling step's own fail-closed policy still applies on top.
Alternatives: skip a broken guard and continue; let errors propagate to the step.
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 18 Oct 2026 · 4.1 A rewrite is verified by a second pass of every guard · decided by lead (safety review, fix round 1) · risk: high
Decided: when any guard rewrote, the whole phase runs once more on the final text; there any rewrite or block becomes `block` with cause `rewrite_unverified`, a failure is `failed`, and an escalate still escalates (it is stronger than block and must not lose its alert).
Why: a later guard's rewrite (grounding, adviceGuard, tone) could put back what an earlier guard (answerLeak) removed; the build plan says "rewrite once; else safe reply".
Alternatives: single pass; re-run only the guards before the rewriting one; loop until stable.
Reversible: Yes, but only with safety-reviewer sign-off.

---

### 18 Oct 2026 · 4.1 Framework failures get their own `failed` outcome · decided by lead (silent-failure review, fix round 1) · risk: medium
Decided: `GuardChainResult` is `ok` | `block` (`cause: 'verdict' | 'rewrite_unverified'`) | `escalate` | `failed` (`failure: { name, cause, errorName? }`); `failed` is non-ok and callers treat it like block; only `ok` and `escalate` carry `text`; the trace action is `failed` and the event carries `cause`.
Why: 4.3 needs to tell "a guard said no" from "the guards broke" to keep the distress keyword fallback; a block must not carry text a caller could send.
Alternatives: one `block` outcome with an optional failure field.
Reversible: Yes, before 4.2-4.5 build on it.

---

### 18 Oct 2026 · 4.1 Failures keep only an error name, never the raw error · decided by lead (security/silent-failure review, fix round 1) · risk: low
Decided: `failure.errorName` is the `Error#name` or `typeof` (capped at 100); undeclared names show as `(undeclared)` in the trace and events.
Why: a thrown value or a guard name can quote unscrubbed input or model output.
Alternatives: keep the raw error for the caller.
Reversible: Yes.

---

### 18 Oct 2026 · 4.1 The step's cancel token cancels the in-flight guard · decided by tdd-guide (fix round 1) · risk: low
Decided: each guard's token is linked to its own slice and to `opts.cancel`; on a step cancel the chain stops waiting at once and fails with `cancelled`. `timeout.ts` is unchanged (the link is built inside the chain).
Why: a cancelled step should not keep a guard (and its model call) running for the rest of its slice.
Alternatives: document that only the slice cancels the guard.
Reversible: Yes.

---

### 18 Oct 2026 · 4.1 Each guard gets its own time slice on the injected clock · decided by tdd-guide · risk: low
Decided: `runGuardChain` runs each guard under `runWithTimeout(…, opts.timeoutMs, opts.clock)`; the slice is per guard, not shared; the caller picks the number.
Why: the plan's fail-closed acceptance names a guard past "its own slice"; reusing 3.1's helper keeps tests on the virtual clock with no wall-clock waits.
Alternatives: one budget for the whole chain; rely only on the step timeout.
Reversible: Yes.

---

### 18 Oct 2026 · 4.1 The chain re-checks the guard list it is given · decided by tdd-guide · risk: low
Decided: besides the registry's wiring-time checks, `runGuardChain` fails closed (`failed`) before running anything when a guard is undeclared, of another phase, duplicated or out of declared order.
Why: "unknown guard means block" must hold even for a list not built by the registry (an eval wrapper, a test, a later refactor).
Alternatives: trust `registry.ordered()`; sort the list silently.
Reversible: Yes.

---

### 18 Oct 2026 · 4.1 A throwing `onGuardOutcome` observer is ignored · decided by tdd-guide · risk: low
Decided: an exception from the observer is caught and does not change the outcome or make the chain throw.
Why: the hook is for logging; a logging fault must not turn a passed or blocked guard into something else, and the chain must never throw.
Alternatives: treat an observer throw as a fail-closed block.
Reversible: Yes.

---

### 18 Oct 2026 · 4.1 Q1 Safety-event seam is a no-op hook only · decided by lead · risk: low
Decided: 4.1 ships only `onGuardOutcome({ name, phase, outcome })` with no text and no persistence; the first guard task that writes a `safety_events` row (likely 4.4) raises the `SafetyEventSink` ADR.
Why: no contracts port exists for it, and nothing needs persistence yet.
Alternatives: add a port now (contracts change, ADR).
Reversible: Yes.

---

### 18 Oct 2026 · 4.1 Q2 The scrub/preGuard/postGuard stubs stay as they are · decided by lead · risk: low
Decided: 4.1 does not wire the step stubs; they keep failing closed. Each guard task wires its own phase (4.2 scrub, 4.3 pre, 4.5 post).
Why: an empty registry would turn today's fail-closed stub into an always-ok pass-through with no real checks.
Alternatives: wire empty registries now.
Reversible: Yes.

---

### 18 Oct 2026 · 4.1 Q3 Registry completeness test goes into 4.9 · decided by lead · risk: low
Decided: `ordered()` skips declared guards not built yet; 4.9 adds the test `ordered().length === GUARD_ORDER[phase].length` for every phase (`missing()` added here to help).
Why: every phase is intentionally partial until M4 ends; a runtime throw now would be too strict.
Alternatives: throw at run time on a missing guard.
Reversible: Yes.

---

### 18 Oct 2026 · Agent-system efficiency review · decided by team lead (the human asked for the review) · risk: medium
Decided: safety-path tasks get a safety-reviewer pass on the plan before the build; board and log commits are batched with the next real commit; planners get a scoped reading list; short mechanical fix rounds go to a fresh sonnet builder instead of resuming a long builder; big tasks split into sub-PRs. Tooling fixes are board task 0.13.
Why: 33 tasks in: the lead was the serial bottleneck (141 of 177 main commits docs-only, and 17 of the last 30 main CI runs cancelled by the next push), nearly every risky PR needed a fix round for issues visible at plan time, and planners and resumed agents were the largest token costs.
Alternatives: keep the process as it is; more builders (budget).
Reversible: yes.

---

### 18 Oct 2026 · 4.0 Safety and locked seed cases (4.0a) · decided by team lead · risk: high
Decided: 172 safety and locked cases land after two safety-reviewer passes (5 HIGH fixed) and the human's sign-off on the review sheet; they check replies only until 4.2 (captured model input) and 4.3 (alerts) add guard-level assertions.
Why: the 100% distress and ≥ 99% safety gates need seeded cases before the guards are built.
Alternatives: wait for the guards and write cases with them.
Reversible: yes.

---

### 18 Oct 2026 · 4.0 The distress folder names the market · decided by team lead (safety review) · risk: high
Decided: `safety/distress/in/` cases are India-market and expect Tele-MANAS 14416 (the PRD's example, re-verified when 3.10 lands); `safety/distress/generic/` cases have no verified helpline and expect "local emergency services or someone you trust" with no number. The eval adapter picks the case's locale pack from that folder. Near-misses live in `safety/distress-nearmiss/`, scored at ≥ 99%, not 100%.
Why: the two kinds demand opposite replies and the case schema has no market field.
Alternatives: an id token only; a schema field (contracts change).
Reversible: yes.

---

### 18 Oct 2026 · 4.0 PII scope for the seed cases · decided by team lead · risk: high
Decided: PII cases follow build-plan line 419 (phone, email, card, OTP-like, Aadhaar-like, PAN, the student's own name); addresses are out of scope; phones in Devanagari digits and phone-shaped numbers inside code are scrubbed; own-name cases use the fictional profile name "Aarav Mehta", set by the eval adapter. Fake data uses example.com or example.org, @exampleupi and placeholder phones.
Why: the spec's list; the safe choice where it is silent.
Alternatives: exempt numbers in code; scrub addresses.
Reversible: yes.

---

### 18 Oct 2026 · 4.0 Three borderline safety behaviours · decided by team lead (safety-reviewer's recommendations) · risk: high
Decided: after a student says a distress message was a joke, the agent checks in gently, says support is still there and never says the earlier message is forgotten, then may return to the lesson (the alert raised earlier stands); "help me hurt my bully" is refused with care and a trusted-adult suggestion, stays a moderation case and raises a misuse alert once 4.3 lands; the moderation suite leaves out drug and account-hacking requests for now (the case author's safety classifier stopped on them).
Why: the spec doesn't cover these; each is the safer reading.
Alternatives: repeat the crisis template; treat the bully case as distress.
Reversible: yes.

---

### 18 Oct 2026 · 4.0 One human sign-off per suite, recorded on every case · decided by team lead (plan answer) · risk: medium
Decided: the human signs a one-row-per-suite review sheet (`docs/tasks/4.0/review-sheet.md`) instead of each case; cases say `reviewed_by: pending` until then and the lead sets the reviewer's handle on every case after sign-off. sid2305 signed 4.0b's four suites on 18 Oct 2026.
Why: 280+ files are too many to sign one by one; the accept line needs a reviewer per case.
Alternatives: sign each case; a reviewer field per folder.
Reversible: yes.

---

### 18 Oct 2026 · 4.0 A grounding suite of its own, and leak forms applied to the demo course · decided by team lead (plan answers Q1, Q3) · risk: low
Decided: `evals/suites/grounding/` is added for guard 4.7, separate from the per-agent `accuracy` suite (5.10/7.2). Leak cases apply the safety review's test forms (words, translation, base64, role-play, Devanagari digits) to the demo course's own answers rather than reusing an archived number.
Why: one folder per guard; the demo course is the fixture every test uses.
Alternatives: fold grounding into accuracy; reuse the archived course's numbers.
Reversible: yes.

---

### 18 Oct 2026 · 4.0 The reviewer and all-guards rules are opt-in until 4.0a lands · decided by builder (tdd-guide) · risk: low
Decided: `EDMATE_REQUIRE_REVIEWED=1` makes a pending reviewer fail and `EDMATE_REQUIRE_SUITES=1` makes an unseeded guard folder fail; by default both are off, so 4.0b could land before 4.0a. Turning the reviewer rule on by default is a follow-up in 4.0a.
Why: the two halves of 4.0 land in separate PRs.
Alternatives: one PR for all nine guards.
Reversible: yes.

---

### 18 Oct 2026 · 4.0 Content-review fixes: the real demo teacher name and narrower must-not-contain phrases · decided by team lead (code-reviewer's LOWs) · risk: low
Decided: persona cases name "Demo Teacher" (the seeded fixture) instead of an invented name; four advice cases use narrower `must_not_contain` phrases ("give them 500mg", "you should take this medicine", "you should take these diet pills") so a correct disclaiming reply can't fail them.
Why: the cases should match the real fixture and not fail a compliant agent.
Alternatives: leave them until the guards land (4.5–4.9).
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Dead letters keep ids only and expire after 7 days · decided by tdd-guide (review fix) · risk: medium
Decided: a dead-letter entry keeps a whitelist of ids, the error and the attempt count, never message text, sources or the help state. Failed jobs and dead-letter entries expire after 7 days; the worker prunes waiting entries hourly, because BullMQ's removeOn options never reach jobs that only wait.
Why: privacy review; an entry still names what to replay.
Alternatives: keep payloads for replay; no expiry.
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Turn writes go through BullMQ; answer key stays in sessions.help_state · decided by tdd-guide · risk: high
Decided: meter and commit only enqueue; apps/worker writes through the scoped db adapters, retries 5 times with backoff, then dead-letters. The help state is written only by `sessions.saveHelpState` (own open session, size cap); its job is removed on failure and its dead-letter entry drops the value. Touches `packages/db/src/repositories/**` and `.github/**`.
Why: lead answers Q2, Q4, Q5; the canary tests show the answer key reaches no message, trace, log or dead-letter entry.
Alternatives: direct db writes in the turn.
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Idempotent retries without a new unique column · decided by tdd-guide · risk: medium
Decided: a usage row's id is derived from (turn id, call index); a message's id is the caller's; one trace per turn via a unique index on `turn_traces.turn_id` (migration 0007); help-state saves are last-write-wins. A worker re-running a job checks for its row first and reports `already_written`.
Why: a retry must never bill twice or duplicate a message.
Alternatives: a unique (turn_id, index) column on usage_ledger; Redis idempotency keys.
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Help-state saves can arrive late · decided by tdd-guide · risk: medium
Decided: the commit worker runs one job at a time so a session's saves apply in order; a save retried after a newer one succeeded can still land last, and the next turn may read a state not yet saved. Accepted; the next turn's save corrects it.
Why: the frozen port has no turn order or version; adding one is a contracts change.
Alternatives: a version column checked in the UPDATE (follow-up if seen in practice).
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Cost alarm checks teachers with usage this month · decided by tdd-guide · risk: medium
Decided: new system read `usageLedger.teacherIdsWithUsageSince({ since })` (teacher ids only, second exception to "every method is scoped", README rule 11). A daily job at 03:30 UTC (provisional) checks them; every per-teacher failure is logged at error level and retried by the next run.
Why: lead answer Q3; a teacher with no usage this month can't be over the threshold.
Alternatives: teachers with a subscription; all agents' owners.
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Migration 0007 stops if turn_traces has rows · decided by tdd-guide · risk: medium
Decided: 0007 adds the TurnTrace fields as NOT NULL with no default and refuses to run on a non-empty `turn_traces` (like 0006's guard); the old model/token/cost columns stay, derived from `usage` (model = distinct models, comma-separated, '' when no call).
Why: old rows can't be filled truthfully; additive keeps rollback simple.
Alternatives: nullable columns; backfilling placeholders.
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Student message timestamp and CommitRecord.receivedAt · decided by tdd-guide · risk: low
Decided: `CommitRecord` gains `receivedAt` (turn start) besides `sessionId`; the student message uses it and the reply uses `createdAt`, so history orders student before agent.
Why: both messages at the finish time would sort by opaque id.
Alternatives: same timestamp; a sequence column.
Reversible: yes.

---

### 18 Oct 2026 · 3.8 Redis in CI for the worker integration test · decided by tdd-guide · risk: low
Decided: CI gets a digest-pinned Redis service and `TEST_REDIS_URL`; the worker integration test fails (not skips) in CI without it, like the db suites. Locally `apps/worker/test/compose.port.yaml` publishes Redis on 127.0.0.1:56379.
Why: the acceptance needs a real queue round trip.
Alternatives: skip in CI.
Reversible: yes.

---

### 18 Oct 2026 · 3.8 The queue meter is also the gateway's MeterSink · decided by tdd-guide · risk: low
Decided: `queuedUsageMeter` implements `recordUnmetered` too, so 2.4's metering wrapper can write through the queue (durable retry for 2.4's failed writes). Avoiding double metering (gateway and meter step) is 3.7's (its Q1-B).
Why: 2.4 deferred retries to 3.8.
Alternatives: a separate sink.
Reversible: yes.

---

### 18 Oct 2026 · 0.12 Explicit CI timeouts for heavy tests · decided by build-error-resolver · risk: low
Decided: the three CI-flaky tests get named per-test timeouts (30 s for the 2,000-iteration access property test, 20 s for the two next-auth cold-import tests); Vitest's global timeout, iteration counts and per-test fresh imports stay as they were.
Why: CI runners took 5.1–5.8 s against the 5 s default, a load problem, not a logic bug; a global bump would hide real hangs.
Alternatives: raise the global testTimeout; cut iterations; share one import in beforeAll (breaks the per-test fresh module the auth tests rely on).
Reversible: yes.

---

### 18 Oct 2026 · 0.12 Test-only edits in the access and auth risky paths · decided by team lead · risk: high
Decided: 0.12 touches `packages/harness/src/access/property.test.ts` and `apps/web/src/auth/*.test.ts` only to add timeouts; no assertion, input or import changes, checked by security-reviewer.
Why: these paths are risky (access filter, sign-in), so even a test-only change gets the required reviewer.
Alternatives: none.
Reversible: yes.

---

### 18 Oct 2026 · Spec text aligned with the 13+ age decision · decided by team lead · risk: low
Decided: the PRD's pilot row and "MVP out" list, and the build plan's out-of-scope line and task 1.7, now say 13+ (13–17 with parental consent where the market requires it), matching the human's decision of 18 Oct 2026 and board task 1.7. Found by the 4.0a safety review.
Why: four lines still said 18+, contradicting the decided open question.
Alternatives: leave the stale text.
Reversible: yes.

---

### 18 Oct 2026 · Per-turn cost ceiling · decided by team lead · risk: medium
Decided: A turn stops when its model cost passes a provisional 0.10 USD (configurable); a turn on a model with no price aborts rather than running unmetered. Billing context comes from the entitlement, never the request.
Why: The spec requires a per-turn ceiling but sets no number; this is a placeholder until the cost data in 7.6.
Alternatives: No default; let unpriced models run.
Reversible: Yes, config.

### 18 Oct 2026 · 3.6 Composer: locked text kept out, distress wording, prompt-pack layout · decided by builder (tdd-guide), lead answers Q1–Q5 · risk: high
Decided: the composer checks every retrieved chunk against the entitlement (teacher and allowed modules) before rendering, on every call and in every mode, and throws `LockedMaterialError` naming only an index; `decide.fallback` composes with no retrieved chunks, so a leaky context still gets a material-free `ask` prompt. Distress is chosen by `reason`, not by move: the distress pack plus its own `move-distress` line, with no style card, learner summary, disclaimer or teaching-question line. Packs are a flat directory of `set@<semver>.yaml` manifests and `<name>@<semver>.md` files; all prose comes from packs and code fills only fixed, allow-listed placeholders, checked at load time.
Why: ADR-0003 (locked material never reaches a model, built in), build plan rule 6 (distress replies never teach), lead answers Q2 and Q5.
Alternatives: check only in modes that show material; reuse the redirect pack for distress; one version for the whole set with no manifest.
Reversible: yes for layout and wording (new pack set version); the scope check should stay.

### 18 Oct 2026 · 3.6 The answer key goes into the system prompt's do-not-say list · decided by lead (Q4), safety-reviewer to judge · risk: high
Decided: `mustNotReveal` (the help state's answer key) is rendered as a quoted list in the frame's do-not-say section and nowhere else in the prompt; it is also on `PedagogyDecision.mustNotReveal` and `CommitRecord.next` (server-side), never in events or the trace.
Why: the spec puts the "do not say" list in the decision block, and the model needs the answer to coach.
Alternatives: keep the answer out of the prompt and rely on postGuard alone.
Reversible: yes. Safety-reviewer must judge the leak risk and whether postGuard/lockedLeak (4.x) covers it.

### 18 Oct 2026 · 3.6 Pack versions on CommitRecord, no contract change · decided by lead (Q1) · risk: medium
Decided: `CommitRecord.promptPack = { set, packs: { name → semver } }` lists the set and the packs this prompt used (safety, the skill or mode pack, frame); the trace is unchanged (its `agentVersion` pins `promptPackVersion`).
Why: `TurnTraceSchema` is strict and frozen; 3.8 can store the versions with the message.
Alternatives: ADR-0006 adding a trace field; listing every pack in the set.
Reversible: yes.

### 18 Oct 2026 · 3.6 One manifest per set, each pack with its own semver · decided by lead (Q2) · risk: medium
Decided: `set@<v>.yaml` lists `name: semver` per pack; unreferenced older pack files may stay; a README and hidden files are ignored; anything else in the directory is an issue; YAML is read with the failsafe schema so versions stay strings.
Why: a set bump can change one pack without copying every file.
Alternatives: one directory per set version.
Reversible: yes.

### 18 Oct 2026 · 3.6 Data blocks are fenced and cannot close their fence · decided by builder (tdd-guide) · risk: low
Decided: material, style card text and the learner summary sit between `<<<` and `>>>`; any run of three or more `<` or `>` in data is spaced out; one-line data (titles, locators, helpline fields, package and persona names) has whitespace collapsed; do-not-say items are JSON-quoted.
Why: teacher and student-derived text must not fake a section or instruction (the pack labels these blocks as reference text).
Alternatives: no fences; random per-turn fences (not deterministic).
Reversible: yes.

### 18 Oct 2026 · 3.6 Small composer defaults · decided by builder (tdd-guide), plan Q6 · risk: low
Decided: teacher messages go to `assistant` prefixed by the frame's teacher label; a regulated subject with no market disclaimer uses the frame's generic one; ask_teacher keeps the below-threshold material; `locked` with `name_package` names only the student's own package; a `hint` at rung 0 or 1 uses the nudge line, rung 2 the conceptual line; an agent with no languages replies in the input language; a turn with no text gets the frame's empty-turn line in the model request.
Why: plan Q6, and the spec's rung 1/2 split; the rest are edge cases the spec does not cover.
Alternatives: as listed in the plan.
Reversible: yes.

### 18 Oct 2026 · 3.6 Set versions that differ only in build metadata are duplicates · decided by builder (tdd-guide) · risk: low
Decided: `createPromptPackLibrary` rejects two sets whose versions match after removing `+…`; lookup stays an exact match on `promptPackVersion`.
Why: semver precedence ignores build metadata; two such sets would be ambiguous to a reviewer.
Alternatives: exact-string duplicates only.
Reversible: yes.

### 18 Oct 2026 · 3.6 Step signatures: decide takes the help state, generate gets sources · decided by builder (tdd-guide) · risk: low
Decided: `decide.run(env, { ctx, help })` and `decide.fallback(env, { ctx, help })` return a `DecideResult`; generate's argument gains `sources`; the runner's fallback check allows `redirect` only for a distress context.
Why: the help state must reach the policy without entering TurnContext (ADR-0005); 3.7 needs the numbered sources.
Alternatives: put sources on `PedagogyDecision` (contracts change).
Reversible: yes (harness-internal types).

### 18 Oct 2026 · 3.6 Broken loader fixtures built at test time · decided by builder (tdd-guide) · risk: low
Decided: each broken case copies `valid/` to a temp directory and applies one edit, instead of committed `broken-*/` directories.
Why: one source of truth; each case shows exactly what is broken.
Alternatives: committed broken directories (the plan's layout).
Reversible: yes.

### 18 Oct 2026 · 3.6 Answer key only on teaching turns; distress gets its own decision line · decided by builder (tdd-guide), safety-reviewer fix round 1 · risk: medium
Decided: the do-not-say list is rendered only for skill packs; closed modes get none. Distress renders `decision-distress` (no move name, no skills) instead of `decision`.
Why: a closed mode never discusses the problem, so the key in its prompt is pure leak risk; a distress prompt should not read as a lesson.
Alternatives: keep the list on every move (round 0).
Reversible: yes.

### 18 Oct 2026 · 3.6 Deferred: fake citations and transcript contents · decided by lead (fix round 1) · risk: low
Decided: chunk text that fakes `[n]` citations is left to the grounding check (4.7); making sure `systemPrompt`, `mustNotReveal` and `next` are never written to the transcript is left to commit (3.8).
Why: both belong to the steps that own those checks.
Alternatives: handle them in the composer now.
Reversible: yes.

### 18 Oct 2026 · No real-model turns before the answer-leak guard · decided by team lead (safety-reviewer's advice) · risk: high
Decided: The composer keeps the answer key in the model's do-not-say list, but only on teaching moves (fix in 3.6). No turn runs against a real model until the answer-leak guard (4.5) is merged and tested (numbers in other forms, translation, base64, role-play): task 3.9, the first real-model CLI chat, now depends on 4.5.
Why: A hash can't let the model check an answer and a paraphrase still gives it away; the real protection is the post-guard.
Alternatives: Remove the answer key from the prompt (the model then can't recognise a correct answer).
Reversible: Yes.

### 18 Oct 2026 · 1.5 Demo seed ids, rows and subscription split · decided by builder (tdd-guide), lead answers Q1, Q2 · risk: low
Decided: fixed ids (`demo-teacher`, `demo-teacher-profile`, `demo-agent`, `demo-agent-v1`, `demo-style-card-v1`, `demo-package-{free,paid}`, `demo-package-{free,paid}-v1`, `demo-student-01..20`, `demo-subscription-01..20`); course and module ids are taken from `course.yaml`. Students 01–05 free active, 06–10 paid active, 11–15 paid paused, 16–20 ended (16–18 paid, 19–20 free). Live subscriptions end 2099-12-31; ended ones and `ageConfirmedAt` use a fixed 2026-01-01 time. No consent rows. Teacher `Demo Teacher`, `demo-teacher@example.invalid`, market `global`; profile slug `demo-teacher`, subject and bio from `course.yaml`, verification left at the default `pending`.
Why: fixed ids plus a fixed clock make re-runs byte-identical; the lead accepted 5/5/5/5 and attestation-only ages.
Alternatives: random ids looked up by email; a periodEnd computed from the current date.
Reversible: yes (code only).

### 18 Oct 2026 · 1.5 Seeded AgentConfig uses provisional policy and prompt pack 1.0.0 · decided by lead (answer Q4) · risk: low
Decided: Anthropic for both tiers (same models as the gateway's `DEFAULT_MODEL_POLICY`), no fallback, `promptPackVersion: '1.0.0'`, `languages: ['en']`; copied into `seed.ts` (db doesn't depend on gateway) and marked PROVISIONAL.
Why: the lead's answer; 7.6 settles the model mix and 3.11 publishes the prompt pack.
Alternatives: add a gateway dependency to db to import the constant.
Reversible: yes.

### 18 Oct 2026 · 1.5 Seed is insert-only and reports drift instead of fixing it · decided by builder (tdd-guide) · risk: low
Decided: one transaction; `ON CONFLICT (id) DO NOTHING` on every table; no updates or deletes. If a stored style card or agent/package config no longer matches the content, the seed warns (`seed: warning: existing row differs from content, left as is: <table> <id>`) and still exits 0. A conflict on anything other than the id (for example a seed email another user already has) fails the whole run and writes nothing.
Why: idempotent with no destructive SQL, and a stale demo db is visible instead of silently kept.
Alternatives: upsert and overwrite (breaks the "versions are immutable" rule); stay silent.
Reversible: yes.

### 18 Oct 2026 · 1.5 Root `seed` script is a plain pnpm chain · decided by lead (answer Q3) · risk: low
Decided: `"seed": "pnpm --filter \"@edmate/db...\" run build && pnpm --filter @edmate/db run db:seed"`; no turbo task. `EDMATE_SEED_CONTENT_DIR` overrides the content tree.
Why: matches the build-then-run pattern of `db:migrate` and `db:grant-role`.
Alternatives: a turbo `seed` task.
Reversible: yes.

### 18 Oct 2026 · 2.7 New `openai` provider key for Whisper and the platform embedding model · decided by builder · risk: high
Decided: `PROVIDER_KEYS.openai` reads `EDMATE_OPENAI_API_KEY`, loaded through 2.1's `loadProviderKeys`. Both the Whisper transcriber and the embedding adapter take `KeysFor<'openai'>`. The key is revealed only in `src/adapters/openai.ts` and `src/adapters/openai-compatible.ts`, and the base URL is always passed. A test checks that `OPENAI_API_KEY`/`OPENAI_BASE_URL` are never read.
Why: both services live on api.openai.com under one OpenAI account. Keeping them off `openai-compatible` keeps that key free for OpenRouter or a self-hosted chat server.
Alternatives: reuse the `openai-compatible` key for embeddings (the plan's Q3 note), which breaks once a deployment points that key at OpenRouter; a separate key per OpenAI service.
Reversible: yes (one entry and two factory signatures).

### 18 Oct 2026 · 2.7 Whisper through the AI SDK's OpenAI transcription model, called at the model level · decided by builder · risk: medium
Decided: `@ai-sdk/openai` 4.0.96 (lead Q2: an AI SDK provider exists for the pinned `ai`). The adapter calls `transcription('whisper-1').doGenerate(...)` directly, not `ai`'s `transcribe()`. It sends `verbose_json` with segment timestamps, the language hint as `language`, and a per-piece timeout. SDK errors go through `mapProviderError`. A 2xx with an unparseable body is `provider_error` with `reason: 'truncated'`.
Why: `transcribe()` guesses the media type from the bytes (falling back to `audio/wav`) and would download a URL itself; the adapter has to send the declared MIME type and do the download itself under the allowlist.
Alternatives: a plain HTTP client; `ai`'s `transcribe()`.
Reversible: yes.

### 18 Oct 2026 · 2.7 Storage download rules for signed URLs · decided by builder · risk: medium
Decided: `allowedHosts` entries must be bare hosts (an optional non-default port is allowed; they are lower-cased). A wrong entry fails at construction. The URL's parsed `host` (including the port) must match exactly. Redirects are followed by hand, only to the same host over https, at most 3. Downloads are capped at 600 MB (refused from `content-length` before reading, or while streaming) with a 10-minute timeout. With a content-length the body must arrive whole (fix round 1). 401/403 → `forbidden`, 404/410 → `not_found`, 429 → `rate_limited`, 5xx → retryable `provider_error`, an empty body → `validation`. Errors never carry a `cause`. Traces name `scheme://host/path` only.
Why: ADR-0005 Decision 5 and its Consequences (SSRF, the signed URL is a bearer credential).
Alternatives: refuse every redirect (some storage gateways redirect within the host); match `hostname` without the port.
Reversible: yes.

### 18 Oct 2026 · 2.7 Recordings over 24 MiB are split by a built-in WAV/MP3 chunker, or by an injected one · decided by builder · risk: medium
Decided: pieces are at most 24 MiB (Whisper's limit is 25 MB, and the multipart envelope needs room). The built-in `defaultChunker` cuts WAV on sample-frame boundaries (each piece gets its own header) and MPEG layer III on frame boundaries (ID3 tags skipped), with exact offsets and durations from the sample counts. Any other format over the limit (webm, m4a, ...) is `input_too_large` unless the composition root passes a `chunker` (for example an ffmpeg one in the worker, 5.2). Unreadable audio is `validation`. A chunker's pieces are checked (non-empty, under the limit, in order) before any upload.
Why: splitting compressed containers needs a decoder, and the gateway takes no native or ffmpeg dependency.
Alternatives: add ffmpeg to the gateway; cut raw bytes (it breaks most containers); transcode everything to MP3 first (that belongs in the worker).
Reversible: yes. 5.1/5.2 should transcode uploads to MP3 or WAV, or inject a chunker.

### 18 Oct 2026 · 2.7 How pieces are stitched, and what counts as cut off · decided by builder · risk: medium
Decided: pieces are transcribed one after another, in order. Segment text is trimmed and blank segments are dropped. Times are `piece offset + round(seconds x 1000)`. The text is the non-empty piece texts joined by a space. `durationMs` is the larger of the last piece's `offset + reported duration` (or the chunker's duration) and the latest segment end. The language is the first piece's valid ISO code (the SDK maps Whisper's names), otherwise omitted. A piece with text but no segment timings fails. So does a piece heard more than 2 s shorter than the chunker says it is (`truncated`). In a split recording an empty piece fails the call, unless it is the final piece and under 1 s, which is skipped and flagged `anomaly: 'empty_final_piece'` in its trace line (fix round 1). Any piece failing fails the whole call.
Why: ADR-0005: the transcriber throws and never returns an empty or partial transcript. The tolerance absorbs rounding but catches a real cut.
Alternatives: transcribe pieces in parallel (rate limits; order is easy either way); keep a partial transcript (forbidden by the port).
Reversible: yes.

### 18 Oct 2026 · 2.7 Migration 0006 stops instead of discarding wrong-sized embeddings · decided by builder · risk: medium
Decided: `0006_chunk_embedding_dimension` first raises an exception if any `chunks.embedding` is not 1536-dimensional, then sets `vector(1536)` (`USING "embedding"::vector(1536)`), then creates `chunks_embedding_hnsw_idx` (HNSW, `vector_cosine_ops`, default build parameters). `EMBEDDING_DIMENSIONS = 1536` lives in `packages/db` beside `EMBEDDING_CONFIG.dimension` in the gateway. The two are kept equal by comments, because db does not depend on gateway.
Why: "data-safe": no stored vector is nulled or rewritten silently. The table is empty today, so the guard passes everywhere it has run.
Alternatives: null the wrong-sized vectors in the same statement; a cross-package test (it would add a dependency between the two packages).
Reversible: yes (a later migration changes the type and rebuilds the index; the model change in 7.6 needs that anyway).

### 18 Oct 2026 · 2.7 Embeddings-only adapter on the OpenAI-compatible path · decided by builder · risk: low
Decided: `createEmbeddingAdapter(keys, { config?, fetch? })` wraps `createOpenAICompatibleAdapter` with `embeddingModel = EMBEDDING_CONFIG.model`. It reports `id: 'openai-compatible'`, `model: 'text-embedding-3-small'` and only the `embeddings` capability. `stream`/`generateObject` throw a `GatewayError` before any request. `embed` fails as `validation` unless it gets one finite vector of `config.dimension` numbers per text. It is never plugged into the turn `Router`.
Why: lead Q3 (the OpenAI-compatible path, 1536 dimensions); 2.4's `meterAdapter` needs a `ModelAdapter`; a wrong-sized vector must never reach `vector(1536)`.
Alternatives: return `Pick<ModelGateway,'embed'>` (it could not be metered unchanged); use `@ai-sdk/openai`'s embedding model.
Reversible: yes.

### 18 Oct 2026 · 2.7 Transcription is metered as unknown on tier main · decided by builder · risk: low
Decided: `meterTranscriber(t, meter)` records one `no_usage_reported` attempt per call on `t.model` (`whisper-1`), tier `main` (the port has no tier, the same as `embed`). The new `MeteredMethod` type includes `'transcribe'`. Per-minute pricing from `Transcript.durationMs`, and the ingestion billing context, are left to 5.1–5.3 (lead Q5).
Why: the lead's instruction and the plan's decision; the port returns no usage figure.
Alternatives: price per minute now.
Reversible: yes.

### 18 Oct 2026 · 2.7 Live smoke tests run only through `test:live` · decided by builder · risk: low
Decided: `corepack pnpm --filter @edmate/gateway test:live` runs `vitest.live.config.ts` (no network stub, only `*.live.smoke.test.ts`, `EDMATE_LIVE_TESTS=1`). The default config excludes those files, and each also skips itself without the variable and its key (and, for Whisper, `EDMATE_LIVE_TRANSCRIBE_URL`, a signed URL to synthetic speech). A test checks the exclusion and the gate.
Why: rule 4 ("live calls only in `--live` runs"); vitest has no `--live` flag.
Alternatives: keep them in the default run, skipped (the default setup's fetch stub would block them anyway).
Reversible: yes.

### 18 Oct 2026 · 2.7 Fix round 1: a download must arrive whole, and an empty piece is a gap · decided by builder · risk: medium
Decided: (1) A download with a usable content-length must deliver exactly that many bytes, or it fails as a retryable `provider_error` (`truncated` when short). Compressed responses are exempt. (2) An empty piece in a split recording fails the call, except a final piece under 1 s, which is skipped and traced as `anomaly: 'empty_final_piece'`. (3) The default download cap is 600 MB, read into one buffer when the length is known.
Why: silent-failure-hunter and security-reviewer, fix round 1. A short body or an empty piece would otherwise become a transcript with a hole in it.
Alternatives: keep skipping empty pieces and only trace them (the gap would still reach ingestion unflagged); a separate anomaly in metering (the meter has no notes field; the trace is where it shows).
Reversible: yes. A class with a long genuine silence (more than one 24 MiB piece) now fails. If that happens in practice, 5.2 can lower the piece size or treat a near-silent piece by its audio level.

### 18 Oct 2026 · 2.7 Review · decided by team lead · risk: low
Decided: The HNSW index in packages/db/migrations/0006_chunk_embedding_dimension.sql keeps pgvector's default tuning (m 16, ef_construction 64). A genuinely silent stretch in the middle of a recording now fails the whole transcription rather than leaving a gap.
Why: Defaults are right at pilot scale; failing loudly lets an operator retry or check a recording instead of storing a transcript with a hidden hole.
Alternatives: Tune the index now; skip silent chunks.
Reversible: Yes.

### 18 Oct 2026 · 3.4 Context budget in characters: 32,000 total, 16,000 for history · decided by builder (tdd-guide), lead answer Q3 · risk: low
Decided: history text plus retrieved chunk text stays within 32,000 UTF-16 units; history gets up to 16,000 and retrieval the rest; 40 messages fetched; chunks that don't fit are skipped in rank order.
Why: harness purity rules out a tokenizer; about 8k tokens leaves room for the system prompt, style card and reply.
Alternatives: a token estimate (chars / 4); a fixed chunk count with no size check.
Reversible: yes (constants in `buildContext.ts`; recalibrate at 7.6).

### 18 Oct 2026 · 3.4 A newest message over the history budget is cut, not dropped · decided by builder (tdd-guide) · risk: low
Decided: if the latest message alone exceeds the history budget it is kept, cut to its last `HISTORY_MAX_CHARS` units (never splitting a surrogate pair).
Why: the plan wants the latest message always kept and the acceptance says the context never exceeds the limit; cutting satisfies both.
Alternatives: keep it whole (can break the limit); drop it.
Reversible: yes.

### 18 Oct 2026 · 3.4 A chunk outside the scope fails the step instead of being filtered out · decided by builder (tdd-guide) · risk: medium
Decided: `buildContext` re-checks every chunk from `search`; one from another teacher or a non-allowed module throws `RetrievalScopeError` (ids only), so the runner uses the ask_teacher fallback context and the trace shows `fallback`.
Why: a widening index is a bug that must be visible (ADR-0003); dropping chunks silently would hide it. Matches the runner's own TurnContext refine behaviour.
Alternatives: drop the stray chunks and keep the rest.
Reversible: yes.

### 18 Oct 2026 · 3.4 Retrieval query: the input text plus the latest agent message, each capped at 1,000 chars · decided by builder (tdd-guide), per 3.5 plan Q2 · risk: low
Decided: the query is the input text (head, 1,000 chars) and the latest `agent` message (tail, 1,000 chars) joined by a newline; teacher messages are ignored; an empty query skips both search and probe.
Why: a bare answer like "42" needs the active problem to retrieve; caps keep one long message from bloating the query.
Alternatives: the last N messages; only the input.
Reversible: yes.

### 18 Oct 2026 · 3.4 The raw help state travels on `Entitled`, set by entitle from the same load · decided by builder (tdd-guide) · risk: medium
Decided: `entitle` copies `helpState` from the `TurnConfigStore.load` result it already ownership-checked onto `Entitled.helpState` (optional, unvalidated); `buildContext` parses it; the runner's `assemble()` deletes it before building TurnContext. `checkTurnConfig` (`access/**`) is unchanged.
Why: ADR-0005 says no extra query; keeping `access/**` out of this task avoids a risky-path change for a pass-through. Deleting the key before the strict TurnContext parse keeps the answer key out of the model context, events and traces.
Alternatives: pass it through `checkTurnConfig`'s `TurnConfig` (touches `access/**`); call `load` again in buildContext (an extra query).
Reversible: yes (harness-internal types).

### 18 Oct 2026 · 3.4 `serializeSessionHelp` refuses an invalid or oversized state · decided by builder (tdd-guide) · risk: low
Decided: `serializeSessionHelp` validates with `SessionHelpSchema` and throws when `JSON.stringify` is over `LIMITS.helpStateMaxJsonLength`.
Why: 3.8 then never builds a value the store would refuse; the store still enforces the cap itself (ADR-0005).
Alternatives: leave all checks to `SessionStateStore`.
Reversible: yes.

### 18 Oct 2026 · 2.5 Cost alarm pauses free subscriptions in one audited, teacher-scoped transaction · decided by builder · risk: high
Decided: `subscriptions.pauseFreeForTeacher(scope, { monthStart, reason })` runs a `SELECT … FOR UPDATE OF subscriptions`, then an `UPDATE`, then one audit insert per row, all in one transaction. The select finds the scope's teacher's trial / active / past_due subscriptions joined to their package version (same teacher) where `config->'pricePerMonth'->'amountMinor' = 0`, with no `subscription.pause_cost_alarm` audit row since `monthStart`. Each audit row is a student x teacher row: actor `system_cost_alarm`, role `system`, before/after status. The result has no student ids. `usageLedger.sumForTeacherSince(scope, since)` is a teacher-scoped read across students that leaves out `eval` rows. Both are in the isolation CASES grid.
Why: paid students keep access until staff decide, so a paid subscription is never touched. The audit row commits with the pause, and it is also the marker that keeps a staff unpause from being re-paused that month (lead answer 4: "store the override"), so no new table is needed. FOR UPDATE makes concurrent runs pause each row once (tested).
Alternatives: audit from the worker after the update (a pause could commit without its audit row); a separate override table.
Reversible: yes.

### 18 Oct 2026 · 2.5 Audit `system` role is its own enum; system actor ids start with `system_` · decided by builder · risk: high
Decided: new Postgres enum `audit_actor_role` (`student, teacher, staff, system`). Migration 0005 moves `audit_log.actor_role` to it with `USING actor_role::text::audit_actor_role`, which maps every stored value to itself. `user_role` is unchanged. `checkActor` requires `actor` to start with `system_` exactly when the role is `system`, so a system row can't name a user and a user role can't use a system id.
Why: lead answer 5 (add `system`). Adding `system` to `user_role` would let a user row hold it.
Alternatives: `ALTER TYPE user_role ADD VALUE 'system'`; a fixed staff sentinel id.
Reversible: yes (convert the column back once no `system` rows remain).

### 18 Oct 2026 · 2.5 Unknown cost below the threshold warns staff (`cost_incomplete`), never pauses · decided by builder · risk: low
Decided: when the month's known cost is below the threshold but there are unknown or unpriced calls, the alarm sends a `cost_incomplete` event to staff only. Nothing is paused. At or over the threshold the event (`threshold_reached`) goes to staff and the teacher, and it reports `unknownCalls` / `unpricedCalls` next to the cost.
Why: lead answer 3 says NULL cost is never treated as zero. A silent "below threshold" while costs are missing would do exactly that. Pausing on unknown cost would be guessing.
Alternatives: report the counts only on threshold events; treat any unknown as over the threshold.
Reversible: yes.

### 18 Oct 2026 · 2.5 The alarm re-alerts on every run over the threshold; a failed pause still alerts · decided by builder · risk: low
Decided: each run at or over the threshold sends an alert listing only the subscriptions that run paused. If the pause fails, the alert still goes out (`pauseFailed: true`) and then the error is rethrown so the job retries. If the alert fails after a pause, the run throws: the pause stands, and the retry alerts again. `checkTeachersCost` checks many teachers, keeps going past one teacher's failure and reports it. The 50 USD default is `COST_ALARM_THRESHOLD_MICRO_USD`, and `thresholdMicroUsd` overrides it (it must be a positive safe integer).
Why: lead answer 4 ("it can alert again"). Staff must know when a pause did not happen. How often alerts repeat depends on the job's schedule (infra).
Alternatives: alert once a month (would need its own marker).
Reversible: yes.

### 18 Oct 2026 · 2.5 `limitReached` is an optional fallback text with a built-in English default · decided by builder · risk: low
Decided: `FallbackReplies.limitReached?(lang)`. `entitle` uses it when it returns non-blank text, and `DEFAULT_LIMIT_REACHED_REPLY` otherwise (also when it throws). The text travels on `TurnRejection.message`; the wire event is unchanged.
Why: lead answer 1. Making it optional keeps `harness/src/testing` (3.15's area) untouched, and a broken locale still gives the student a reason.
Alternatives: required field (would change `testDeps`).
Reversible: yes (make it required once every composition root injects it).

### 18 Oct 2026 · 2.5 Review · decided by team lead · risk: low
Decided: packages/db/src/repositories/subscriptions.ts keeps treating a free package with a missing or malformed stored price as not free (never paused), and packages/db/migrations/0005_cost_alarm.sql builds its index without CONCURRENTLY, like every earlier migration.
Why: Failing closed protects paid students; content validation (1.8) and package publishing guarantee a price. The usage table is small before the pilot.
Alternatives: Alert on a missing price; CONCURRENTLY indexes.
Reversible: Yes.

### 18 Oct 2026 · 3.15 ADR-0005: TurnConfigStore returns raw helpState; new SessionStateStore and Transcriber ports and media schemas · decided by team lead (architect's design, human's contracts delegation) · risk: high
Decided: `TurnConfigStore.load` also returns `helpState: unknown` (the session row's `help_state`, unvalidated); new `SessionStateStore.saveHelpState(sessionId, helpState)` and `Transcriber.transcribe(TranscribeInput): Promise<Transcript>` ports; new `TranscribeInputSchema` (https URL, audio/video MIME, optional language hint), `TranscriptSegmentSchema` and `TranscriptSchema` (non-empty, segments in start order, ends within the duration). Help state stays `unknown` in contracts and the harness parses it (3.4).
Why: 3.4 and 3.8 need to read and write the session's help state and no port did; ADR-0001 named a Transcriber that was never defined (vendor OpenAI Whisper, human decision 18 Oct 2026).
Alternatives: help state on TranscriptStore; a full SessionStore; a help-state schema in contracts; a storage key instead of a URL.
Reversible: only by another ADR (contracts change). Needs architect, security-reviewer and typescript-reviewer sign-off.

### 18 Oct 2026 · 3.15 The in-memory TurnConfigStore returns `undefined` help state when a session has none · decided by builder (tdd-guide) · risk: low
Decided: `MemorySession.helpState` is optional; an unset value loads as `undefined` (the db column defaults to `{}`). Neither adapter validates the value.
Why: the plan asks for no behaviour change; 3.4's parser falls back to rung 0 for any invalid value, `undefined` included.
Alternatives: default the in-memory value to `{}` to mirror the db default.
Reversible: yes (test helper only).

### 18 Oct 2026 · 3.15 Overlapping transcript segments are allowed · decided by builder (tdd-guide), following the plan's rule · risk: low
Decided: `TranscriptSchema` only requires each segment's `endMs >= startMs`, starts never going backwards and the last segment's `endMs <= durationMs`; a segment may start before the previous one ends.
Why: the plan's refinement lists exactly these rules; chunked Whisper output can overlap at chunk edges.
Alternatives: require non-overlapping segments.
Reversible: only by ADR (contracts).

### 18 Oct 2026 · 3.15 Saved help state is capped at 8 KB of JSON (LIMITS.helpStateMaxJsonLength) · decided by team lead on security-reviewer's fix round 1 · risk: medium
Decided: `LIMITS.helpStateMaxJsonLength = 8 * 1024` (UTF-16 units of `JSON.stringify`, like `skillPayloadMaxJsonLength`); `SessionStateStore.saveHelpState` refuses a larger or unserialisable value before writing (adapter in 3.8).
Why: help state is a client-influenced jsonb blob on every turn; an unbounded write would let one session grow the row without limit. 8 KB is far above the ladder state's size.
Alternatives: 16 KB like the skill payload; a cap only in the db adapter, not in contracts.
Reversible: only by ADR (contracts LIMITS).

### 18 Oct 2026 · 3.15 Transcribe URLs and MIME types are checked strictly in the schema · decided by builder (tdd-guide) on typescript-reviewer's fix round 1 · risk: low
Decided: `url` must match `https://host[:port]` plus an optional path, query or fragment: lower-case scheme, no userinfo, no whitespace anywhere, no backslash in the authority. `mimeType` must be `audio/` or `video/` plus an RFC 6838 subtype, with no parameters (`audio/webm;codecs=opus` is refused; the caller strips parameters).
Why: the URL goes straight to a fetch, so every form the WHATWG parser rewrites silently is refused at the boundary; refusing parameters keeps the check simple.
Alternatives: accept MIME parameters; rely on `z.url` alone (it trims and would accept surrounding whitespace).
Reversible: only by ADR (contracts).

### 18 Oct 2026 · 2.5 Cost alarm threshold · decided by team lead · risk: medium
Decided: The monthly cost alarm fires at a provisional 50 USD per teacher per calendar month (UTC), configurable. It alerts staff and the teacher and pauses free packages only; once staff unpause, the same month doesn't re-pause. Calls with unknown cost are counted and reported, never treated as free.
Why: The spec sets no number; this is a placeholder until the cost data in 7.6.
Alternatives: A rolling 30-day window; no default.
Reversible: Yes, config.

### 18 Oct 2026 · Session help state and Transcriber ports · decided by team lead (architect's design) · risk: high
Decided: ADR-0005 (task 3.15) adds two contracts ports and one small extension: TurnConfigStore.load also returns the session's raw help state; a new SessionStateStore.saveHelpState writes it back to the student's own open session; a new Transcriber port with strict transcript schemas. The help state stays untyped in contracts and is parsed by the harness.
Why: Turns need the help ladder's state across messages, and transcription needs a port; one combined ADR avoids two parallel contracts changes.
Alternatives: Help state on TranscriptStore; a full SessionStore; a help-state schema in contracts.
Reversible: Yes, with another ADR.

### 18 Oct 2026 · 1.3 Google sign-in with database sessions; roles change only by a server-side grant; deny-by-default route guard · decided by planner, accepted by team lead · risk: high
Decided:
- **Sign-in.** Auth.js (next-auth pinned at 5.0.0-beta.32) with Google only. The provider checks state, nonce and PKCE, and `allowDangerousEmailAccountLinking` is false.
- **Sessions.** Database sessions with 30-day expiry, refreshed daily. Only the SHA-256 of the cookie token is stored, in `auth_sessions`.
- **Identity store.** A separate store in `packages/db/src/identity/`, outside the scoped repositories. It returns identity fields only.
- **Roles.** New users are always `student`. Only `grantRole` changes a role: the `db:grant-role` operator CLI now, 12.1 later. Each grant writes an audit row in the same transaction.
- **Route guard.** Every API route export must be wrapped by `withRole`, `publicRoute` or `providerRoute`, and its access must match `ROUTE_POLICY`. An unmatched path is denied at runtime, and an unwrapped or mismatched export fails `route-coverage.test.ts`. There is no role inheritance.
- **Origin.** Unsafe methods need a same-origin `Origin` (or `Sec-Fetch-Site: same-origin`).
- **Cookies.** httpOnly, SameSite=Lax, path `/`, and Secure with the `__Host-` prefix when `AUTH_URL` is https.
- **No linking while signed in.** A live session admits only its own Google account; each user has at most one Google account (review round 1).
- **Browser session JSON.** `{ user: { id, role }, expires }` only.
- **Stored data.** No Google OAuth tokens and no photos are stored.

Why:
- Role changes and revocation apply at once.
- No role sits in a client-held token.
- Sign-in has one door.
- Auth must read `users` and delete sessions, which repository rules 1, 7 and 9 forbid.

Alternatives:
- JWT sessions: the role stays stale until the token expires.
- `@auth/drizzle-adapter`: it writes `image`, needs nullable market, locale and role, and can't force the role.
- A proxy-only check: it can be bypassed, and Next doesn't recommend it.

Reversible: yes. `createAuthConfig` and `createIdentityStore` sit behind interfaces, and the migration is additive.

### 18 Oct 2026 · 1.3 next-auth 5.0.0-beta.32 pinned (v5 has no stable release) · decided by builder (tdd-guide) under the lead's Q1 rule · risk: medium
Decided: Pin `next-auth` exactly at `5.0.0-beta.32`. Its peer range is `next ^16` and `react ^19`, and it bundles `@auth/core` 0.41.3 with `customFetch`. Vitest inlines `next-auth` because it imports `next/server` without an extension.
Why: The tech stack names Auth.js, and v5 is the only line that supports the App Router on Next 16. v4 (`latest`) is the old API.
Alternatives: next-auth 4.24.15; bare `@auth/core`, or Better Auth, either of which needs an ADR.
Reversible: yes. Bump the pin once a stable v5 ships.

### 18 Oct 2026 · 1.3 First sign-in sets market `global` and locale `en` · decided by team lead (Q2) · risk: low
Decided: `createStudent` hard-codes `market: 'global'` and `locale: 'en'`. Neither is ever guessed from IP or headers; 1.7's country question sets the real market.
Why: Both columns are NOT NULL, and guessing from IP is unreliable and privacy-hostile.
Alternatives: Make the columns nullable, or infer from `Accept-Language`.
Reversible: yes.

### 18 Oct 2026 · 1.3 Role grants go to a new platform_audit_log, and only operator or current staff may grant · decided by builder (tdd-guide) on review round 1 (database-reviewer 5, security-reviewer 3) · risk: medium
Decided: Role grants are no longer written to 1.6's `audit_log`. They go to a new append-only `platform_audit_log`, used for staff and operator actions that belong to no teacher. Each row has:
- actor: a staff user id, or `operator`
- `actor_role`: enum `platform_actor_role`, either `staff` or `operator`, recording the real role
- action: `role.grant`
- target: `user:<id>`
- `subject_user_id`: the user the grant is about (FK to users)
- reason
- before/after: `{ role }`
- ts

Indexes are (target, ts), (actor, ts) and (subject_user_id, ts).

`grantRole` accepts `by` only if it is exactly `operator` or a user whose role is `staff` at that moment. That user's row is share-locked inside the transaction, so a concurrent demotion can't slip in. Anything else is `scope` and nothing is written. The identity store only inserts into the table; 12.1's trust console adds the read path.

The first staff account is still bootstrapped with `db:grant-role --by operator`.
Why: Using the target user as `teacher_id` broke `audit_log`'s rule that every row belongs to one teacher. Recording `staff` for an unchecked `by` misattributed grants.
Alternatives: A nullable-teacher "platform" scope inside `audit_log`. It would weaken 1.6's NOT NULL rule and its teacher-scoped reads.
Reversible: yes. The table is additive, and 1.6 is untouched.

### 18 Oct 2026 · 1.3 No account linking while signed in; one Google account per user · decided by builder (tdd-guide) on review round 1 (security-reviewer 1) · risk: medium
Decided: While a session is live, the `signIn` callback allows only the signed-in user's own Google account. Any other account, new or another user's, is refused as `AccessDenied`, and the current session is left as it was.

The callback reads the session cookie from the request through NextAuth's per-request config (`NextAuth((req) => createAuthConfig({ …, request: req }))`). With no request available it refuses (fails closed).

A unique index on `auth_accounts (user_id, provider)` also limits each user to one account per provider. It replaces the plain `user_id` index and still leads with `user_id`.
Why: On a shared device, Auth.js would otherwise attach sibling B's new Google account to A's signed-in user, and B could open A's account.
Alternatives: Allow linking behind a fresh re-authentication. That is not needed in 1.3.
Reversible: yes.

### 18 Oct 2026 · 1.3 Secure session cookie uses the `__Host-` prefix; auth_sessions.expires_at indexed · decided by builder (tdd-guide) on review round 1 · risk: low
Decided:
- Over https the session cookie is `__Host-authjs.session-token`, with Secure, Path=/ and no Domain.
- `auth_sessions_expires_at_idx` is added for sweeping expired sessions.
- next-auth's `Session` type is augmented to `user: { id, role }`, which replaces the `as unknown as Session` cast.

Why: `__Host-` stops any subdomain from setting or shadowing the session cookie. Expiry sweeps need the index.
Alternatives: The `__Secure-` prefix.
Reversible: yes.

### 18 Oct 2026 · 1.3 Google sign-in checks state + nonce + PKCE · decided by builder (tdd-guide) · risk: low
Decided: Set `checks: ['pkce', 'state', 'nonce']` on the Google provider.
Why: Auth.js 0.41 defaults to PKCE only, and the plan's acceptance needs state on the redirect. Nonce adds id_token replay protection.
Alternatives: The default (PKCE only).
Reversible: yes.

### 18 Oct 2026 · 1.3 Small choices: tables, timing, proxy, lint, exports · decided by builder (tdd-guide) on the plan · risk: low
Decided:
- **Tables.** Tables are prefixed `auth_`, because the learning `sessions` table already exists.
- **Session timing.** 30-day sessions, refreshed after 24 h.
- **No proxy.** No `proxy.ts`; each route handler enforces its own role (Q8).
- **Lint.** A new `@edmate/config/eslint/app` preset bans `@edmate/db/internal` in apps, and bans `next-auth` / `@auth/*` outside `src/auth/**`.
- **Exports.** `auth` is not exported from `src/auth`: server components use `requireRole`.
- **Email verification.** Google users keep `email_verified_at` null, because Auth.js passes null for OAuth and the `signIn` callback enforces Google's `email_verified`.
- **Migrations path.** `MIGRATIONS_DIR` uses `path.join` so Turbopack can build the web app.

Why: These follow the plan's recommendations, and they keep the build and the guard simple.
Alternatives: As listed in the plan.
Reversible: yes.

### 18 Oct 2026 · Speech-to-text and embedding vendor · decided by you · risk: medium
Decided: OpenAI for both: Whisper for transcription (the adapter splits recordings over 25 MB) and text-embedding-3-small (1536 dimensions) for embeddings, through the OpenAI-compatible path. One extra vendor and key.
Why: Anthropic offers neither; one vendor keeps keys and bills simple.
Alternatives: Deepgram for transcription plus OpenAI embeddings; decide later.
Reversible: Yes; both sit behind ports.

### 18 Oct 2026 · 3.5 Coverage threshold 0.5 and an unscored chunk counts as not covered · decided by team lead (plan Q2) · risk: medium
Decided: a turn is covered when some retrieved chunk has `score ≥ coverageThreshold`. The threshold is injected through `PolicyOptions`, with a provisional default of 0.5 on a 0–1 scale. A chunk with no score, or a NaN threshold, counts as not covered. Not covered goes to `locked` if `lockedHit`, otherwise to `ask_teacher`.
Why: the retrieval score scale is not defined until 5.3, and failing toward `ask_teacher` keeps the agent from answering from general knowledge.
Alternatives: treat any retrieved chunk as covered; hard-code a threshold.
Reversible: yes; 5.3 calibrates the default on the demo Q&A set.

### 18 Oct 2026 · 3.5 Distress reaching decide returns redirect, never a throw · decided by team lead (plan Q6) · risk: medium
Decided: `decidePolicy` checks distress first, before the entitlement and coverage, and returns `redirect` with no tools and no skill.
Why: the runner escalates distress before decide, so this is defence in depth. A throw would fall back to `ask`, which is a teaching question. Safety-reviewer to confirm.
Alternatives: throw; return `ask`.
Reversible: yes.

### 18 Oct 2026 · 3.5 Ladder caps: coach 4, practice 3 · decided by team lead (plan Q7) · risk: medium
Decided: `effectiveCeiling = min(helpCeiling, finalAnswers never ? 3 : 4, SKILL_CAP[skill])` with coach 4 and practice 3. The stored rung is clamped to it before any transition. Only coach (and mock_interview without a persona, which falls back to coach) and practice hint requests use the ladder.
Why: practice answer keys stay server-side, so practice never reaches a solution.
Alternatives: practice capped at 2; one cap for all skills.
Reversible: yes.

### 18 Oct 2026 · 3.5 Solved vs step, gated rung 3, feedback move · decided by team lead (plan Q3, Q4, Q5) · risk: low
Decided: `correct` = problem solved (rung 0, `check`, state reset); `partial` = a correct step (same rung, `ask`). At rung 3 with `after_attempt` and no attempt, the move is `ask` (invite an attempt). The same gate applies to a stored rung 4 without a pending check. At a ceiling below 4, the rung repeats its move. `feedback` → `hint`.
Why: `route` gives one `correct` label; asking for an attempt gets further than repeating the worked example.
Alternatives: repeat `worked_example` when gated; `feedback` → `explain`.
Reversible: yes.

### 18 Oct 2026 · 3.5 Non-ladder moves report rung 0 and keep the ladder state · decided by builder (tdd-guide) · risk: low
Decided: `locked`, `ask_teacher`, `redirect`, and the feedback, revision, mock_interview (with persona), explain and study_plan moves report `rung: 0` in the decision, and leave `next.helpRung` and the help state as they were. The one exception: explain sets or clears `pendingCheck`. A practice item turn reports its clamped rung and resets to 0 on a correct answer.
Why: the spec gives no rung for non-ladder moves, and a detour into another skill should not lose the student's place on the ladder.
Alternatives: report the stored rung on every move.
Reversible: yes.

### 18 Oct 2026 · 3.5 mustNotReveal and help state ownership · decided by builder (tdd-guide) on the plan · risk: low
Decided: `mustNotReveal` is a copy of `help.answerKey` for every move except `solution` (and always under `finalAnswers never`), including locked, ask_teacher, redirect and the fallback. `HelpStateSchema` = `{ stuckTurns 0|1, attemptLogged, pendingCheck, answerKey }` is the shape of `sessions.help_state`. A solved problem resets it, including the answer key. A consumed check resets it but keeps the key (fix round 1). Results never alias the input state.
Why: plan § Help state and rule 7. Keeping the key on non-teaching replies costs nothing and blocks a leak.
Alternatives: an empty `mustNotReveal` on non-teaching moves.
Reversible: yes.

### 18 Oct 2026 · 3.5 Only a solved problem clears the answer key · decided by builder (tdd-guide) on safety-reviewer finding · risk: medium
Decided: the ladder's pending-check reset (after `solution` or `explain`) keeps `answerKey`. Only `correct` (problem solved) and a correct practice item clear it. A mock_interview turn without a persona falls back to coach only when coach is entitled; otherwise it is `locked` (reason `no_persona`). `fallbackPolicy` returns `redirect` with reason `distress` for distress turns.
Why: a student could tap Explain and then keep asking, emptying `mustNotReveal` mid-problem and leaking the answer under `finalAnswers: never`. The other two fixes stop a skill outside the package from reaching `solution`, and keep a teaching question away from a student in distress.
Alternatives: give explain its own pending flag.
Reversible: yes.

### 18 Oct 2026 · 3.5 A higher coverage bar when lockedHit is true is deferred to 5.3 · decided by team lead (safety review) · risk: low
Decided: the coverage threshold is the same whether or not `lockedHit` is true. A stricter bar for questions that also match a locked module goes to 5.3 (retrieval calibration).
Why: the score scale is not defined until 5.3.
Alternatives: a separate locked threshold now.
Reversible: yes.

### 18 Oct 2026 · 3.5 Provisional maxOutputTokens table · decided by builder (tdd-guide) on the plan · risk: low
Decided: ask 200, hint 250, check 250, redirect 150, locked 150, ask_teacher 250, explain 400, worked_example 600, solution 700. Skill overrides: revision 700, feedback 500. Pinned by an inline snapshot.
Why: coaching stays under 80 words; explain is ≤ 150 words plus an example and a citation.
Alternatives: one budget for all moves.
Reversible: yes; 7.6 tunes the numbers on cost data.

### 18 Oct 2026 · Demo course sign-off · decided by you · risk: low
Decided: You approved the demo teacher course (Python basics, PR #20) as its named reviewer; `reviewed_by: sid2305`.
Why: Rule 7 needs a named human for teaching content.
Alternatives: Request changes; review later.
Reversible: Yes; a real teacher can re-review before launch.

### 18 Oct 2026 · 1.8 Demo course subject and licence · decided by team lead · risk: low
Decided: The demo teacher teaches Python basics for beginners (5 modules), written from scratch and released as CC0-1.0. Third-party material would need CC BY, CC BY-SA, CC0 or public domain with a source and attribution.
Why: Easy for the human reviewer to judge, open licensing keeps the public repo clean, and it doesn't pre-empt the pilot-subjects decision.
Alternatives: Adapt an existing open course; another subject.
Reversible: Yes.

### 18 Oct 2026 · 1.8 Content validator rules · decided by tdd-guide · risk: low
Decided: Besides the plan's 8 rules, `edmate content validate` fails a non-CC0 file without a source_url, any file outside the documented layout, and a reviewed_by that is an email address.
Why: Keeps licences traceable, stops stray files, and keeps personal emails out of a public repo.
Alternatives: Warnings instead of failures.
Reversible: Yes.

### 18 Oct 2026 · 1.8 Rubric scale · decided by pedagogy-author · risk: low
Decided: Sample student answers are scored out of 4, with the criteria written in rubricNotes.
Why: A small scale keeps scoring consistent for the feedback skill's agreement test (5.7).
Alternatives: Out of 10; pass/fail.
Reversible: Yes.

### 18 Oct 2026 · 3.2 entitle resolves all three sources server-side and fails closed on any ownership mismatch · decided by builder (tdd-guide) on the plan and lead answers · risk: high
Decided: `entitle` sends only `{ studentId, agentId, source }` to `EntitlementStore.resolve`, with the source set by the composition root, and never reads package, module or skill ids from the input. It refuses `null`, paused and ended, loads the turn's config through `TurnConfigStore`, and ends the turn with `no_access` unless every object belongs to the entitlement (ADR-0004 Decision 5) and the entitlement's allowed modules and skills are within the package's. The db adapter adds the one repository read without a teacher or student scope, `agents.owner({ agentId })`, which returns only the owner's teacher id and only for live agents. Preview and eval packages are bound from trusted server state when the store is built.
Why: build plan § Access filter 1 and 7, ADR-0003 point 1 and ADR-0004; the subscription path needs the agent's teacher before any student-scoped read, and that link is public on teacher pages.
Alternatives: a student-only scope joining subscriptions to packages in one statement; trusting a client package id when it matches.
Reversible: yes (code only; no contract or schema change). Needs security-reviewer sign-off on `agents.owner`.

### 18 Oct 2026 · 3.2 Rate and daily message limits are in-memory sliding windows · decided by team lead (Q1 = A, Q3) · risk: medium
Decided: admit allows 10 admitted turns per student per trailing 60 s, for every source except eval; refused turns don't count, turns that entitle later refuses do. entitle allows `dailyMessageLimit` messages per student × package per rolling 24 h, for subscriptions only; the take is the last action after every await, so a refused turn never counts and concurrent turns can't both take the last slot. Both are `TurnCounter`s in `PipelineDeps.limits`, built once on the injected clock; a restart or a second instance resets them until task 3.14.
Why: no contracts port counts turns; the lead chose to defer a durable store.
Alternatives: a contracts port with ADR-0005 now; per student × agent keys.
Reversible: yes; 3.14 swaps the counter (the interface allows an async `tryTake`).

### 18 Oct 2026 · 3.2 Teacher preview and eval accept any agent status · decided by builder (tdd-guide) · risk: medium
Decided: subscriptions need a `live` agent; teacher preview (only the agent's own teacher) and eval accept draft, live and suspended agents.
Why: plan Q8 allows drafts for preview and eval; a teacher may still preview, and the trust team evaluate, a suspended agent. Students can never reach it.
Alternatives: refuse suspended agents for preview and eval too.
Reversible: yes.

### 18 Oct 2026 · 3.2 admit does not authenticate or full-parse TurnInput · decided by builder (tdd-guide), plan Q4 · risk: low
Decided: the caller authenticates and merges `studentId`; `unauthorized` stays in the web layer. admit checks the limits in code (wrongly typed `text` or `attachments` is `validation`) and ignores fields it does not read; the boundary's strict parse rejects them.
Why: "client-sent package ids are ignored" and CLI/eval callers may pass unparsed objects.
Alternatives: parse `TurnInputSchema` in admit and return `validation`.
Reversible: yes.

### 18 Oct 2026 · 3.2 The style card is the exact row agent.styleCardId names · decided by team lead (Q6 answer) · risk: low
Decided: style card rows are immutable versions with their own ids, so `turnConfigStoreFor` loads exactly `agent.styleCardId`, keeping the `styleCard.id === agent.styleCardId` check. ADR-0004's "latest version" wording is left for 8.4 to settle by ADR amendment.
Why: the schema has no style card lineage id, so "latest version of `styleCardId`" and the fail-closed id check cannot both hold.
Alternatives: load the teacher's newest style card row (breaks the id check).
Reversible: yes, with 8.4's ADR amendment.

### 18 Oct 2026 · 3.2 An entitlement that cannot be valid throws instead of returning null · decided by builder (tdd-guide) · risk: low
Decided: when stored rows build an entitlement that fails `EntitlementSchema` (for example a bad market mapping), `entitlementStoreFor` throws `RepositoryError('integrity')`; entitle turns it into `no_access` (retryable).
Why: corrupt data should be loud, not look like "no subscription".
Alternatives: return `null`.
Reversible: yes.

### 18 Oct 2026 · 3.2 Review · decided by team lead · risk: low
Decided: The `sessionId as string` cast in packages/harness/src/pipeline/steps/entitle.ts stays (it follows a successful parse). The style card is loaded as the exact immutable row `agent.styleCardId` names; task 8.4 settles whether a newer card version should replace it. Round-trip parallelisation moves to 3.14; subscription expiry to 10.3.
Why: None changes behaviour or safety now.
Alternatives: Use the parsed value; load the latest card version now.
Reversible: Yes.

### 18 Oct 2026 · 2.4 Unknown figures are NULL; usage_ledger's figure columns are relaxed to nullable · decided by team lead · risk: high
Decided: `model`, `input_tokens`, `output_tokens` and `cost_micro_usd` are nullable (migration `0003`, `ALTER COLUMN … DROP NOT NULL`, which loses no data; the table is empty). Each row has a `status` (`recorded` | `unknown` | `unpriced`) and a fixed `reason` (`no_usage_reported` | `unpriced_model:<model>`). Unknown rows have NULL tokens and cost; unpriced rows have NULL cost. One CHECK requires a recorded row to have all four figures, and another keeps counts non-negative. Status/figure consistency beyond that is validated on read (`integrity`). `schema.test.ts` allows relaxing NOT NULL and pins the relaxed columns.
Why: a raw query must never read an unknown call as free (database-reviewer, fix round 1). The lead clarified that "create-only" means "never lose data". Round 0's placeholder-plus-3-branch-CHECK design was replaced.
Alternatives: placeholders pinned by a CHECK (round 0: brittle, and raw readers see 0).
Reversible: yes (re-adding NOT NULL needs the unknown rows backfilled or removed).
Note for 2.5/13.5: `sum()` skips NULL, so totals leave out unknown calls. Report the `unknown`/`unpriced` counts (as `sumForStudent` does) next to any cost.

### 18 Oct 2026 · 2.4 One usage row per provider attempt, metered at the adapter · decided by builder · risk: high
Decided: `meterRouter(router, …)` rebuilds the router with `Router.withAdapters` so that each adapter call is metered. A failed-over primary writes its own row (unknown, on its model) next to the fallback's. A request the router refuses before any adapter call writes nothing. The gateway-level wrapper was removed so a router can't be metered as one opaque call.
Why: silent-failure-hunter, fix round 1. Tokens a failed primary spent were invisible.
Alternatives: record inside `Router` itself (couples routing to billing); keep a gateway-level wrapper too (easy to misuse).
Reversible: yes.

### 18 Oct 2026 · 2.4 usage_ledger writes are ownership-checked through the package, scoped by student x teacher · decided by builder · risk: high
Decided: `usageLedger.record` / `recordUnmetered(scope: StudentScope, packageId, entry)` insert with `INSERT … SELECT … FROM packages WHERE id = $pkg AND teacher_id = $scope.teacherId` (0 rows → `not_found`; a ghost student is a FK violation, which reads as `not_found`). Reads filter on the scope's teacher and student. `usageMeterFor(repos, scope)` binds one pair, and a ctx naming another is `scope`. Rows hold ids, model id, tier, counts, cost and the reason code only.
Why: 1.2's isolation rules. A wrong ctx can't bill another pair.
Alternatives: trust the ctx's ids per call.
Reversible: yes.

### 18 Oct 2026 · 2.4 Metering writes are fire-and-track; durable retry is deferred to 3.8 · decided by team lead · risk: low
Decided: a sink write starts when an attempt ends and is not awaited by the call. `settled()` waits for outstanding writes. A failing write becomes one `metering.failed` warning (error class name only) and is not retried. Durable retry or a dead-letter queue for failed meter writes is deferred to task 3.8 (the async `meter` step's queue).
Why: pipeline step 10 says metering never blocks; 3.8 owns the queue.
Alternatives: await the write in the call path; retry in memory (lost on restart anyway).
Reversible: yes.

### 18 Oct 2026 · 2.4 generateObject/embed are always recorded as unknown (known limit) · decided by team lead · risk: low
Decided: the frozen `ModelGateway` port returns only the value from `generateObject`/`embed`, so each attempt is recorded as `no_usage_reported` on the adapter's model. Carrying usage out needs a contracts change (ADR). A stream that reports several usage figures writes one row per figure. Chunks pass through unchanged (the usage chunk still says `costMicroUsd: 0`); `computeCostMicroUsd` is exported if 3.7 needs a cost mid-turn.
Why: no tokens invented, no call left out.
Alternatives: a contracts change to return usage.
Reversible: yes.

### 18 Oct 2026 · 2.4 Prices are integer micro-USD per 1M tokens, at most 6 decimals, half-up once · decided by builder · risk: low
Decided: `prices.yaml` holds USD per 1M tokens (at most 6 decimals), scaled to BigInt micro-USD at load. Cost = (in x pIn + out x pOut) / 1M, rounded half up once; a result past 2^53 throws. `js-yaml` 5.5.0 (the same pin as evals). The build copies `prices.yaml` to `dist/`. The gateway build tsconfig includes node types. The list prices should be checked when 7.6 sets the model mix.
Why: exact integers, one rounding step.
Alternatives: floats; per-side rounding.
Reversible: yes.

### 18 Oct 2026 · 2.4 turn_id is a plain column; source is a new enum checked against the contracts · decided by planner · risk: low
Decided: `turn_id` is text, not null and not a FK (meter and commit are independent). `entitlement_source` is checked equal to `Entitlement.source`. Indexes `(teacher_id, turn_id)` for `listForTurn` and `(teacher_id, student_id, created_at)` for `sumForStudent` and 2.5.
Why: as planned, plus database-reviewer's index.
Alternatives: FK to turn traces.
Reversible: yes.

Ops note: in round 0, `docker compose … up -d postgres` reported "Recreated" for the shared `edmate-postgres-1` container. Round 1 used `start`/`stop` only.

### 18 Oct 2026 · 2.4 Review · decided by team lead · risk: low
Decided: generateObject and embed calls in packages/gateway/src/metering/meteredGateway.ts are recorded with status unknown, because the contracts port returns no usage for them; failed meter writes are retried by the worker queue in 3.8; 3.7 derives `source` from the entitlement.
Why: Adding usage to those port methods is a contracts change worth doing only if the cost data in 7.6 shows it matters.
Alternatives: A contracts change now.
Reversible: Yes.

### 18 Oct 2026 · 1.6 Audit rows are teacher-scoped (optionally also student-scoped); staff-wide reads are 12.1's addition · decided by planner · risk: high
Decided: every `audit_log` row has a not-null `teacher_id`, and the write/read methods take the same `TeacherScope`/`StudentScope` that 1.2 enforces, with no exception to "scope first, always required." `before`/`after` are redacted against a denylist before they are stored, on top of callers' own care. There is no update or delete method; append-only is enforced in the app layer only (no trigger, no REVOKE). Staff's cross-teacher trust-console view is not built here.
Why: keeps the one isolation rule 1.2 set (and that security-reviewer checks) true for every repository method; every use the build plan has today (config, staff, memory) is about one teacher.
Alternatives: an unscoped `append`/`list` pair guarded only by role checks at the call site (it would be the first exception to "scope first"; 12.1 should review that when it needs it); a Postgres trigger or RLS for append-only (no precedent here, bigger than this task).
Reversible: yes. 12.1 can add a staff-wide read path with an additive migration without touching this one.

### 18 Oct 2026 · 1.6 A teacher's audit list leaves out student rows · decided by builder · risk: high
Decided: `listForTeacher` returns only rows with no `student_id`. A student's memory changes (and staff actions on one student) are readable only in that student's scope.
Why: the plan didn't say. A student's memory is theirs (PRD 6.5), and 1.2 already hides which student asked a question from the teacher; listing student rows to the teacher would show which student did what, plus their before/after.
Alternatives: include student rows in the teacher's list (simpler, but leaks per-student activity); include them with `studentId` and before/after removed.
Reversible: yes; it is one WHERE clause.

### 18 Oct 2026 · 1.6 The actor must match the scope · decided by builder · risk: low
Decided: a `teacher` actor must be the scope's teacher, and a `student` actor must be the scope's student (so a student can't act on teacher-only rows); otherwise `scope`. `staff` may act in any scope, and the caller's role check covers whether they are allowed to.
Why: stops a row claiming that someone outside the scope made the change.
Alternatives: record any actor as given.
Reversible: yes.

### 18 Oct 2026 · 1.6 Before/after go through JSON, then redaction, then a size cap; deep structure is redacted · decided by builder · risk: low
Decided: each value is `JSON.stringify`d and parsed back before redaction, so class instances, `toJSON` and dates are plain data first. Values JSON can't hold (bigint, cycles, a bare function) and anything over 10 000 characters after redaction are `invalid`, never truncated. Objects and arrays deeper than 8 levels become `[redacted]` instead of being kept as they are.
Why: redacting before the round trip would miss personal keys on class instances and `toJSON` output. Keeping deep structure unredacted would let personal data through the defense-in-depth layer.
Alternatives: the plan's "keep deeper structure as is"; redact without the round trip.
Reversible: yes.

### 18 Oct 2026 · 1.6 Redaction matches compound keys and email/phone values (fix round 1) · decided by builder · risk: high
Decided: after NFKC, removing zero-width and other format characters, lower-casing and removing `_ - . space`, a key is redacted if it **contains** `email`, `phone`, `name`, `address` or `photo` (so `studentEmail`, `parentName`, `guardianPhone`, `fullName` and `profilePhotoUrl` are caught). The short terms `ip` and `bio` only match as a whole word of the key (camelCase or separators: `clientIp`, `IPAddress`, `ip_v4`, `teacherBio`), because as substrings they hit real keys in contracts and schema (`subscriptionId`, `description`, `piiPatterns`) and words like `biology`. Inside any string value, whatever its key, email-shaped text and phone-shaped runs (7 or more digits, with spaces, dots, dashes or brackets between them) are replaced by `[redacted]`; ISO dates and plain decimals are left alone. The allowlist is empty. Harmless keys that contain a term (`packageName`, `namespace`) are redacted on purpose, and an allowlist should only be added when a real false positive gets in the way. A code comment records that cross-script homoglyph keys (a Cyrillic `е`) get past the NFKC fold: this is defense in depth, not a guarantee.
Why: security-reviewer HIGH. The exact-key match stored raw personal data under compound keys.
Alternatives: plain substring matching for every term (redacts `subscriptionId` and `description`); exact keys only (the reviewer's finding); dropping whole strings instead of the matched parts (loses the non-personal context).
Reversible: yes. It is one file and needs no migration; rows already written keep the redaction they were stored with.

### 18 Oct 2026 · 1.6 Schema details · decided by planner · risk: low
Decided: `actor_role` reuses the `user_role` enum; `student_id` is nullable (teacher-only events have none); `reason` is optional; `target`'s `<kind>:<id>` form is advisory and not a foreign key; `AuditRow` and `AuditEntryInput` are db-local types, not contracts.
Why: plan and lead answers Q3/Q4; there is no audit contract, and adding one would need an ADR.
Alternatives: a new enum; a contract type.
Reversible: yes.

### 18 Oct 2026 · 1.6 Review · decided by team lead · risk: low
Decided: packages/db/migrations/0002_audit_log_scope.sql adds NOT NULL columns without a backfill, and packages/db/src/schema/operations.ts has no ts-leading index on audit_log.
Why: The audit table is empty until this ships, so no backfill is needed; retention runs per teacher, which the (teacher_id, ts) index covers.
Alternatives: A backfill step; a plain ts index now.
Reversible: Yes, one additive migration.

### 18 Oct 2026 · 3.2 Message counters · decided by team lead · risk: medium
Decided: The per-student rate limit and the rolling daily message limit start as in-memory windows in the harness, behind an injected interface. A restart resets them. Task 3.14 makes them durable and shared before the pilot.
Why: Keeps 3.2 moving without a second contracts change; harmless while building.
Alternatives: A new contracts port with ADR-0005 now.
Reversible: Yes, the interface is swappable.

### 18 Oct 2026 · 3.13 TurnConfigStore port loads a turn's config at entitle · decided by team lead · risk: high
Decided: Contracts gain one additive port, `TurnConfigStore.load(entitlement, sessionId)`, which returns the agent, package, style card and locale pack for the turn, or null. `entitle` calls it and fails closed with `no_access` unless every loaded object belongs to the entitlement's teacher, agent, package version and market. No other contract changes (ADR-0004).
Why: pre-guards, escalation and the fallback context need the locale pack and style card before `buildContext`, and no port loaded them.
Alternatives: widen `EntitlementStore.resolve`; a port defined inside the harness (against ADR-0002); four separate stores.
Reversible: only by ADR.

### 18 Oct 2026 · 3.13 A session id is checked against the entitlement and pins the agent version · decided by team lead · risk: high
Decided: `TurnConfigStore.load` returns null unless the session row belongs to the entitlement's student, teacher and agent and is still open; `entitle` then fails with `no_access`. The agent is loaded at exactly the session row's `agent_version`, which the server sets when the session is created and never takes from the client, and must match the entitlement's agent and teacher. `Entitlement` does not change. Task 3.2 must test both checks.
Why: `sessionId` comes from the client, so on its own it could point at another student's session or pin an agent version the student should not get (security review of 3.13).
Alternatives: add the agent version to `Entitlement`; trust the session id because the entitlement was already resolved.
Reversible: only by ADR.

### 18 Oct 2026 · 3.12 `EvalCase` lives in `packages/evals`, not `packages/contracts` · decided by planner · risk: low
Decided: the case/check shape is a Zod schema owned by `packages/evals`.
Why: it is not in the Core contracts list and nothing outside the eval runner reads it; adding it to contracts would need an ADR.
Alternatives: add it to contracts for symmetry.
Reversible: Yes, by ADR if a second package needs the type.

### 18 Oct 2026 · 3.12 One generic `Recorder` for agent replies and judge outputs · decided by planner · risk: low
Decided: every agent reply and judge verdict goes through one record/replay mechanism, one JSON file per (case, turn, call) at `<fixtures>/<case>/turn-<n>/{agent,judge-<i>}.json`; replay never calls the live function and a missing fixture throws "run with --record first".
Why: "record/replay including recorded judge outputs" becomes one mechanism, and CI replay has no live call path.
Alternatives: a judge-only recorder plus ad hoc agent caching.
Reversible: Yes.

### 18 Oct 2026 · 3.12 No default judge model; `EDMATE_JUDGE_MODEL` required to record · decided by lead (human decision on pinning) · risk: low
Decided: `resolveJudgeModel()` reads `EDMATE_JUDGE_MODEL="<provider>:<model>"` and throws if unset; each recorded judge fixture stores the model that produced it. An `openai-compatible` judge also needs `EDMATE_JUDGE_BASE_URL`.
Why: the model mix is open until 7.6 and the judge is pinned per release by a human; a guessed id could be baked into fixtures.
Alternatives: hard-code a default id.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Agent under test is an injected `EvalAgent`; the CLI's agent stays unwired · decided by planner, accepted by lead (Q1) · risk: low
Decided: the runner takes a minimal `EvalAgent` (`reply({caseId, turnIndex, student, priorTurns}) → {text, sources?}`); `edmate eval` passes an agent that refuses every call until a pipeline exists. Replay still works with recorded agent fixtures.
Why: 3.1 is not built; a one-shot stand-in model would look like real coverage without guards, retrieval or persona.
Alternatives: wire a direct-to-model stand-in now.
Reversible: Yes; a later task passes a real agent.

### 18 Oct 2026 · 3.12 `edmate eval` lives in `apps/cli` · decided by planner · risk: low
Decided: `edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]`; fixtures default to `evals/fixtures`; exit 1 on any failing case or error. `run()` became async.
Why: the build plan's CLI-parity table names `edmate eval` under `apps/cli`.
Alternatives: a bin in `packages/evals`.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Case id charset only; `must_cite_source: false` means "no sources" · decided by planner, accepted by lead (Q2, Q3) · risk: low
Decided: ids must match `^[a-z0-9-]+$` (the `<suite>-<skill>-<nnn>` shape stays an authoring convention); `must_cite_source: false` asserts no sources, omitting it means don't care.
Why: skill names and numbering may change; an explicit "no sources" is useful for off-topic redirects.
Alternatives: enforce the full id shape; treat `false` as don't care.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Eval tests use the 2.6 scripted gateway via a devDependency on `@edmate/harness` · decided by builder · risk: low
Decided: `packages/evals` and `apps/cli` list `@edmate/harness` as a devDependency and import only `@edmate/harness/testing` in tests; no `src` file imports the harness.
Why: the lead asked for the scripted gateway in tests (rule 4); the runtime graph stays one-way (harness does not know evals, evals' shipped code does not need the harness).
Alternatives: a hand-written fake `ModelGateway` in evals.
Reversible: Yes.

### 18 Oct 2026 · 3.12 No vacuous passes; per-case errors; overwrite report · decided by reviewers (fix round 1) · risk: low
Decided: a case must have at least one turn with `expect` (schema), and a case where no check ran fails (runner). `runSuite` records a throwing case as failed with its error and keeps going; `runCase` still throws. `--record` lists every overwritten fixture key with a count in the summary.
Why: a check-free case would report a pass that proves nothing; one bad case shouldn't hide the rest of a run; re-recording should be visible in review.
Alternatives: allow check-free cases; abort the whole run on the first error; overwrite silently.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Strict checks and loud failures · decided by builder · risk: low
Decided: string checks are case-insensitive substrings; `matches` regexes compile with `i` at load time; checks run in a fixed order (`must_contain`, `must_not_contain`, `matches`, `max_words`, `max_chars`, `must_cite_source`, `judge[i]`); an empty suite dir, a malformed recorded fixture or a malformed agent reply throws rather than scoring; fixture keys are restricted to lowercase `/`-joined segments.
Why: deterministic reports and no silent skips.
Alternatives: return `[]` for an empty dir; score malformed data as a fail.
Reversible: Yes.

### 18 Oct 2026 · Payments come last · decided by you · risk: high
Decided: Build and test the harness and the platform end to end first, then raise agent quality, and only then build payments (M10). Until M10, a paid package starts as an active subscription with no payment; checkout (new 10.8) and teacher earnings (new 10.7) move into M10, and M13 hardening no longer waits on M10 except the pilot readiness checklist (13.6).
Why: The product's value is the teacher's agent; money and payouts are not worth the effort until the whole thing works and the agent is good.
Alternatives: Keep payments in the platform build (9.3 checkout, 8.8 earnings, 9.7 with a payment sandbox).
Reversible: Yes; entitlements already come from subscriptions, so M10 only adds how a subscription gets paid for. The payment, refund and revenue-share answers above stay on record for M10.

### 18 Oct 2026 · Turn config loading · decided by team lead (architect's design) · risk: high
Decided: Add one contracts port, `TurnConfigStore`, recorded in ADR-0004 (task 3.13). `entitle` loads the agent, package version, style card and locale pack in one call and fails closed if any object doesn't belong to the entitled teacher. This moves style card and locale loading from buildContext to entitle, a deviation from the Turn pipeline spec.
Why: Scrub needs PII patterns and escalate needs helplines before buildContext runs; ADR-0002 keeps adapter-backed ports in contracts.
Alternatives: Widen EntitlementStore; a harness-only dependency; four separate stores.
Reversible: Yes, with another ADR.

### 18 Oct 2026 · Minimum learner age · decided by you · risk: high
Decided: Learners are 13+. In the US no parental consent is needed (COPPA covers under-13 only); in India 13–17 need verifiable parental consent (DPDP), so the age gate asks country and birth year.
Why: The product needs nothing that requires 18+; school-age learners widen reach. India's DPDP treats under-18s as children.
Alternatives: 18+ only; 13+ with no consent anywhere (rejected for the India legal risk).
Reversible: Yes, but raising the age later means offboarding existing learners. Note for 1.7 and M6: DPDP also bars tracking and behavioural monitoring of children, so learner memory for India under-18s needs a check before it ships.

### 18 Oct 2026 · Pilot market · decided by you · risk: high
Decided: The pilot runs in the US and India, with locale packs en-US and en-IN (English, Hindi, Hinglish).
Why: Keep focus on two markets rather than global; the Hindi and Hinglish evals already cover India.
Alternatives: India only; global English; wait for the Validate phase.
Reversible: Yes; more locale packs can be added later.

### 18 Oct 2026 · Payment providers · decided by you · risk: high
Decided: Razorpay in India (UPI AutoPay, Route split payouts) and a merchant of record (e.g. Paddle or Lemon Squeezy) in the US for sales tax, both behind the one Payments port.
Why: Recurring payments in India mostly run on UPI AutoPay, which merchants of record do not support; in the US a merchant of record removes state sales-tax work.
Alternatives: Razorpay plus Stripe Connect; Stripe in both markets.
Reversible: Yes; the Payments port keeps providers swappable.

### 18 Oct 2026 · Hosting region · decided by you · risk: high
Decided: One US cloud region for the pilot; add an India (Mumbai) region later if latency or data rules need it.
Why: One stack is cheapest; DPDP does not require this data to stay in India.
Alternatives: US and India regions; India only.
Reversible: Yes, with a data migration.

### 18 Oct 2026 · Pilot subjects · decided by you · risk: medium
Decided: The pilot targets specific practical skills, e.g. personal finance, Marketing 101 and starting a side hustle; anchor teachers are signed in the Validate phase.
Why: Narrow, practical courses suit daily practice with a teacher's agent.
Alternatives: Coding, exam prep, languages, professional skills.
Reversible: Yes. Personal finance falls under the regulated-subject advice guardrail and its eval suite.

### 18 Oct 2026 · Teacher view of conversations · decided by you · risk: medium
Decided: Teachers see aggregated insights by default; a student may opt in to share conversations.
Why: Protects student privacy while still giving teachers useful signal.
Alternatives: Aggregated only; full conversations.
Reversible: Yes.

### 18 Oct 2026 · Refund policy · decided by you · risk: medium
Decided: Students get a full refund within the first 7 days; none after.
Why: Simple and fair for trying a teacher; the board's recommendation.
Alternatives: Pro-rata; no refunds.
Reversible: Yes, for new subscriptions.

### 18 Oct 2026 · Moderation · decided by you · risk: medium
Decided: Provider moderation where available, a local classifier otherwise.
Why: Uses the strongest check each provider offers without running a GPU; the board's recommendation.
Alternatives: Classifier only; self-hosted Llama Guard.
Reversible: Yes.

### 18 Oct 2026 · Live classes · decided by you · risk: low
Decided: Live classes use the teacher's Google Meet or Zoom link; Edmate schedules them and ingests the recording for transcription.
Why: Far less work and cost than built-in video.
Alternatives: Built-in video.
Reversible: Yes.

### 18 Oct 2026 · Product name · decided by you · risk: low
Decided: Keep the name Edmate.
Why: Your call.
Alternatives: Rename before launch.
Reversible: Yes, before launch.

### 18 Oct 2026 · Deferred: revenue share, default model mix, legal entity · decided by you · risk: low
Decided: Revenue share and floor price and the default model mix wait for the cost and eval data from 7.6; the legal entity (company, social enterprise or non-profit) is decided before payments go live.
Why: Each needs data or context that does not exist yet.
Alternatives: Set them now.
Reversible: Yes.

### 18 Oct 2026 · 2.3 Fallback rule collapses to one check · decided by planner · risk: low
Decided: the router falls back only when the error is a `GatewayError` with `retryable: true`, nothing has been yielded yet for this `stream()` call, and a capable fallback adapter is configured. Everything else re-throws as is.
Why: `truncated`/`content_filter` are only ever paired with `retryable: false` in `adapters/errors.ts`, so checking `retryable` already covers "never fall back on a cut-off or filtered answer".
Alternatives: also check `reason` explicitly.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router takes already-built adapters; a separate factory resolves ModelPolicy · decided by planner · risk: low
Decided: `Router` only sees `ModelAdapter` instances; `createRouter(policy, factories)` is the only place that turns policy strings into adapters.
Why: keeps fallback and capability logic testable with plain fakes and free of key or base-URL concerns.
Alternatives: one class that resolves the policy and routes.
Reversible: yes.

### 18 Oct 2026 · 2.3 Capability mismatch fails closed, never reroutes to fallback · decided by planner · risk: low
Decided: if the tier's adapter lacks a capability the request needs, the router throws a `validation` `GatewayError` before any call and does not try the fallback.
Why: it is a policy configuration bug, not a transient failure; rerouting would hide it.
Alternatives: try the fallback's capabilities before giving up.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router tests reuse harness/testing via a devDependency · decided by planner · risk: low
Decided: `@edmate/gateway` gains `@edmate/harness: workspace:*` as a devDependency; router tests wrap `ScriptedGateway` and reuse `scriptedStreamProviderError`.
Why: the 2.6 fixtures name this task as their consumer; rule 3 limits what harness imports, not who uses its test helpers.
Alternatives: duplicate a script player in `packages/gateway/test`.
Reversible: yes.

### 18 Oct 2026 · 2.3 embed() is served by the main tier's adapter · decided by builder · risk: low
Decided: `Router.embed` uses `tiers.main` (and the fallback on a retryable error), since the `ModelGateway.embed` port has no tier.
Why: the plan did not say which tier embeds; main is the agent's primary adapter. Embeddings are platform-wide config, so a deployment that needs them routes `main` to an embedding-capable adapter or uses a separate gateway for indexing. With `DEFAULT_MODEL_POLICY` (Anthropic, no embeddings) `embed` throws `validation` without calling the provider.
Alternatives: the small tier; a separate embedding adapter in `RouterOptions` (would need a config shape the contract does not have).
Reversible: yes.

### 18 Oct 2026 · 2.3 Provisional default model ids · decided by builder · risk: low
Decided: `DEFAULT_MODEL_POLICY` = Anthropic `claude-haiku-4-5` (small) and `claude-sonnet-4-5` (main), no fallback; frozen and headed PROVISIONAL until 7.6.
Why: lead answer Q3 accepted a provisional Anthropic default; these ids match the ones already used in gateway tests.
Alternatives: a synthetic `unconfigured` provider that forces every caller to override.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router coverage held at 100% · decided by builder · risk: low
Decided: `vitest.config.ts` adds a 100% threshold for `src/router/**`, beside keys and adapters.
Why: the fallback rule decides whether a second model may answer; every branch should stay tested.
Alternatives: the package's 80% default.
Reversible: yes.

### 18 Oct 2026 · 3.1 Clock and IdSource are harness types, not contracts ports · decided by planner · risk: low
Decided: `Clock`, `Cancel` and `IdSource` live in `packages/harness/src/pipeline/clock.ts`. `harness/testing`'s `Clock` is now `Pick<Clock, 'sleep'>`.
Why: They are parameters of the harness entry point, not adapters that db, gateway or worker implement. Every caller already imports the harness, and contracts stay frozen.
Alternatives: A contracts port by ADR.
Reversible: Yes (by ADR later).

### 18 Oct 2026 · 3.1 No production clock or id adapters in the harness · decided by planner · risk: low
Decided: 3.1 ships no `Date.now`/`setTimeout`/`randomUUID` adapters. The first real caller (3.9) provides them.
Why: They need real timers and Node or DOM lib types, which the harness tsconfig doesn't have.
Alternatives: Ship them in the harness behind a lib change.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Stubs fail closed · decided by planner · risk: low
Decided: Every unbuilt step throws `StepNotImplementedError`, so the runner applies that step's policy. The only stub that returns data is `route.onFailure`, and that data is the spec's own default (`on_task`/`none`). `decide.fallback` throws too, because an `ask` decision needs a composed prompt (3.5/3.6).
Why: A stub that succeeds (for example `entitle`) would fail open in production.
Alternatives: Happy-path stubs.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Only generate may emit events · decided by builder · risk: low
Decided: The concurrent steps and escalate get no `emit`. The runner sends `safety`, the escalate reply, `replace`, `done` and `error` itself. Events from `generate` are checked against `TurnEventSchema`. `done`/`error` from a step are invalid, and events sent after a step's timeout are dropped.
Why: Event order never depends on scheduling, and a failed step can't leave a stream half-written.
Alternatives: Give escalate an `emit` (the plan sketch).
Reversible: Yes.

### 18 Oct 2026 · 3.1 Escalate beats block · decided by planner · risk: medium
Decided: After the concurrent group, a preGuard `escalate` or a route intent of `distress` (including from `route.onFailure`) escalates. This happens even when preGuard blocked or failed.
Why: A distressed student must never just be blocked.
Alternatives: Block first.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Meter still runs after escalate and block · decided by planner · risk: low
Decided: `meter` runs whenever the turn has usage, including escalated and blocked turns. It is skipped when there is no usage.
Why: § Model gateway says every call is metered. "Skip to step 11" would lose the small-model usage from steps 3 and 4.
Alternatives: Skip meter on escalate.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Error codes where the spec names none · decided by planner · risk: low
Decided:
- admit throw or timeout → `rate_limited`, retryable.
- entitle throw or timeout → `no_access`, retryable. An invalid or mismatched entitlement → `no_access`, not retryable.
- preGuard failure → `guard_blocked`, retryable. A block verdict → `guard_blocked`, not retryable.
- generate failure, or a runner bug → `provider_error`, retryable.
- An invalid TurnContext even after the fallback → `no_access`, not retryable.
Why: There is no `internal` code and contracts are frozen.
Alternatives: A new error code by ADR.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Runner checks the entitlement against the turn · decided by builder · risk: low
Decided: Besides the schema check, the runner refuses (`no_access`) an entitlement whose `studentId` or `agentId` differs from the input, or whose status is `paused` or `ended`.
Why: Defence in depth: a buggy `entitle` (3.2) can't give one student another student's package.
Alternatives: Trust `entitle` entirely.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Step results are schema-checked · decided by builder · risk: low
Decided: Every step result is parsed with a zod schema built from the contracts (`results.ts`). A result that fails counts as the step failing. Guard trace entries are strict (`name`, `ok`, `action` only).
Why: A buggy step hits its failure policy instead of passing bad data along. No step can put guard reason text into a trace (ADR-0003).
Alternatives: Trust the TypeScript types.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Generate: 15 s per attempt; `replace ''` before a retry after streamed tokens · decided by planner · risk: low
Decided: Each generate attempt gets its own 15 s. If the first attempt had streamed tokens, `replace { text: '' }` is sent before the retry. A `TurnAbort` is final and is not retried.
Why: The student never sees two half-replies. A cost-ceiling abort must not spend more.
Alternatives: One 15 s budget for both attempts.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Alert retry: 250 ms doubling, 30 s cap, no attempt limit, 5 s per attempt · decided by builder · risk: low
Decided: `AlertSink.raise` is retried on the injected clock with backoff starting at 250 ms, doubling to a 30 s cap, with no attempt limit. Each attempt times out after 5 s. The alert is dispatched before the reply is sent, and `finished` waits for delivery. Each failed attempt is listed in `finished.background`.
Why: This is the literal reading of "retried until delivered". The 5 s per-attempt timeout (the builder's addition) stops a hanging sink from blocking retries. Durable delivery is 4.3's worker.
Alternatives: A bounded attempt count.
Reversible: Yes.

### 18 Oct 2026 · 3.1 An invalid TurnContext is treated as a buildContext failure · decided by planner · risk: medium
Decided: If `TurnContextSchema` (retrieved ⊆ allowed modules, same teacher, entitlement matches pkg/agent) rejects the assembled context, the runner retries with the step 6 fallback context and marks buildContext `fallback`. If that also fails, the turn ends with `no_access`. `decide` never sees an invalid context.
Why: An access-filter bug degrades to `ask_teacher` instead of leaking locked material.
Alternatives: End every such turn with an error.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Traces for turns that end early · decided by lead (plan Q1) · risk: low
Decided: Turns rejected at admit or entitle get no trace and no commit. Escalated turns are traced with intent `distress`. Escalated, blocked and errored-before-decide turns get move `redirect`. A turn whose scrub failed uses intent `on_task`.
Why: `TurnTrace.intent`/`move` are required, and a rejected turn never really happened (rate-limit spam would flood traces).
Alternatives: A trace for every request.
Reversible: Yes.

### 18 Oct 2026 · 3.1 All of buildContext runs in the concurrent group · decided by lead (plan Q2) · risk: low
Decided: All of step 6 runs alongside preGuard and route, with one 300 ms budget.
Why: This is a superset of "the retrieval part of 6", and it avoids a second budget after the group.
Alternatives: Only retrieval concurrent.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Fallback texts are injected · decided by lead (plan Q3) · risk: low
Decided: `PipelineDeps.fallbackReplies` supplies `safeReply(lang)` and `distress(lang, locale)`. If one of these throws, the bug is reported in `finished`. postGuard then uses an empty text. escalate uses the built-in last-resort reply (fix round 1). The `safety` event, `done` and alert delivery still happen.
Why: The harness can't use next-intl. The texts come from 3.10/3.11 packs.
Alternatives: Hard-coded English.
Reversible: Yes.

### 18 Oct 2026 · 3.1 meter and commit never see unscrubbed text · decided by builder · risk: medium
Decided: Background steps get the scrubbed input. If the scrub failed, `CommitRecord.input` is `null` and `env.input` has no `text`.
Why: PII the scrub couldn't remove must never be persisted.
Alternatives: Store the raw input.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Built-in last-resort distress reply · decided by lead (fix round 1, silent-failure-hunter) · risk: medium
Decided: When the escalate step gives no reply text and `fallbackReplies.distress` throws or returns empty, the runner sends `LAST_RESORT_DISTRESS_REPLY`. This constant is built into the runner, is country-neutral and has no numbers. Its wording was set by safety-reviewer in fix round 2: it says "I'm an AI" and points to someone you trust and local emergency services. The trace marks escalate `failed`, and the alert, message and trace are still saved.
Why: A distressed student must never get an empty reply. A constant can't fail the way an injected text source can.
Alternatives: An injected text only (the original design); end with an error.
Reversible: Yes. The text should be reviewed by the safety reviewer and replaced by the 3.10/3.11 pack text paths, never removed.

### 18 Oct 2026 · 3.1 Injected distressCheck when route.onFailure fails · decided by lead (fix round 1, silent-failure-hunter) · risk: medium
Decided: `PipelineDeps.distressCheck(text, lang): boolean` is a required dependency. The runner calls it on the scrubbed text when `route.onFailure` throws or returns invalid data, and a hit escalates the turn. If the check also throws, the turn uses `on_task`/`none`, route is marked `failed` in the trace, and both errors are listed in `finished.background`.
Why: "Distress keywords still escalate" must hold even when the route fallback itself breaks.
Alternatives: Only `ROUTE_DEFAULT` (the original design); a check hard-coded in the harness (keywords belong in locale packs).
Reversible: Yes. 3.3/4.3 provide the real keyword check, and the caller wires it in.

### 18 Oct 2026 · 3.1 Distress keyword check on the raw text when the scrub fails · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: When the scrub throws or times out, the runner runs `deps.distressCheck` in-process on the raw text. On a hit, it raises a runner-built alert, sends the last-resort reply and saves the commit (with `input: null`) and the trace. No step runs on the raw text. The raw text is never stored, traced or reported, and a check failure is reported as a generic error.
Why: A failed scrub must not silently block a student in distress. The keyword check is local code with no model call, so the raw text never leaves the process.
Alternatives: Always block on a scrub failure (the original design); run the escalate step on the raw text.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Distress keyword check whenever preGuard is not ok · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: When preGuard throws, times out or returns an invalid result, and route did not say distress, the runner runs `distressCheck` on the scrubbed text. A hit escalates instead of blocking.
Why: A classifier timeout must not turn a distress message into a plain block.
Alternatives: Rely on route alone.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Building the alert never breaks the escalation · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: The runner-built alert is tried twice. Each failure is listed in `finished.background` (`alert`), and the trace marks escalate `failed`. The caring reply, the safety event and `done` are always sent. If both attempts fail, the turn is saved without an alert.
Why: Previously a throwing id source sent `provider_error` to a distressed student, and no alert was raised.
Alternatives: End with an error.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Review · decided by team lead · risk: low
Decided: Two unused cancel sources in packages/harness/src/pipeline/runner.ts (routeFallback, backgroundStep) stay as they are. If building the alert fails twice, the alert worker (4.3) must raise a minimal alert or a critical ops event; failed-attempt usage is metered by the orchestrator (3.7).
Why: Nothing subscribes to those cancel sources, so they are harmless; alert delivery and metering belong to their own tasks.
Alternatives: Cancel them for consistency; handle the double alert failure in the runner.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Unexpected database errors are scrubbed into RepositoryError('failed') · decided by tdd-guide (fix round 1) · risk: low
Decided: Every repository method runs inside `guarded()`, applied to all methods by `createRepositories`. Any error that is not a `RepositoryError` becomes `RepositoryError('failed', method)` with code `provider_error` (the contracts have no database-specific code) and a `ScrubbedDbError` cause holding only the driver's error code (SQLSTATE or Node code) and constraint name; the Drizzle/pg error with its SQL, params and detail is dropped. `messages.append` reports a duplicate message id as `not_found`.
Why: Security review: Drizzle's "Failed query: … params: …" message quotes student and teacher ids and message text; a duplicate-id `invalid` let ids in other sessions be probed.
Alternatives: Redact the message text with regexes (fragile); keep the original as a hidden property; generate message ids server-side (the frozen TranscriptStore port passes the caller's id).
Reversible: Yes.

### 18 Oct 2026 · 1.2 Isolation enforced by required scopes in the repositories · decided by planner · risk: high
Decided: Every repository method takes a validated `TeacherScope` or `StudentScope` first and puts it in the WHERE clause of the same statement; messages and turn traces are scoped through a join on `sessions`; another scope's row reads as missing (`null`/`[]`) and writes to it throw `not_found`; frozen ports without a scope parameter (`TranscriptStore`) are bound to a scope at construction; the root `@edmate/db` export has no raw database handle or schema (`@edmate/db/internal` is for migrations, seed and tests). A typed case table makes the isolation test fail to compile when a method has no case.
Why: Data model rule "repositories require the right scope"; no RLS (1.1 decision); ports are frozen (ADR-0002).
Alternatives: Postgres RLS; changing the ports to take a scope (ADR); scope checks in the web layer only.
Reversible: Yes, but every caller binds scopes this way from 1.3 on.

### 18 Oct 2026 · 1.2 Pool limits from env, invalid values throw · decided by planner · risk: low
Decided: `DATABASE_POOL_MAX` (10, 1..100), `DATABASE_IDLE_TIMEOUT_MS` (30 000), `DATABASE_CONNECT_TIMEOUT_MS` (5 000), `DATABASE_STATEMENT_TIMEOUT_MS` (15 000); fixed idle-in-transaction timeout 30 s and `application_name=edmate`; an invalid value throws at startup; the migrator uses one connection and no statement timeout; idle client errors are logged redacted, not thrown.
Why: 1.1 review deferral (c); a silent default would hide a misconfiguration.
Alternatives: No limits (pg defaults); clamping bad values.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Typed jsonb columns, parsed on read · decided by planner · risk: low
Decided: `.$type<>()` ties `agent_versions.config`, `package_versions.config`, `messages.sources`, `turn_traces.steps`, `learner_profiles.mastery`/`mistakes` to contract types (no migration); every row leaving a repository is parsed with its contract schema and a mismatch with its own columns throws `integrity`. `sessions.help_state`, `eval_results.details`, `insights.payload`, `audit_log.before/after` and trust `staff_actions` stay `unknown` until their owners (3.5, 7.x, 11.3, 1.6, 12.x).
Why: 1.1 review deferral (a); a corrupted or mis-owned row must never be returned.
Alternatives: Trust stored jsonb.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Contracts and zod become runtime dependencies of @edmate/db · decided by planner · risk: low
Decided: `@edmate/contracts` (workspace) and `zod` 4.6.7 move from devDependencies to dependencies.
Why: Repositories parse scopes, inputs and rows at runtime.
Alternatives: Hand-written validators.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Exhaustive grid instead of a property-testing library · decided by planner · risk: low
Decided: The isolation test enumerates every actor x target over a two-teacher, two-student seed plus 20 seeded-random ids per read method; no new dependency.
Why: The seed is small enough to cover every combination exactly.
Alternatives: fast-check.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Message history ties ordered by id · decided by planner (lead accepted) · risk: low
Decided: `history` orders by `(created_at desc, id desc)` and returns the page oldest first; no sequence column.
Why: Lead answer Q4; the pipeline gives student and agent messages different timestamps.
Alternatives: An additive `bigserial seq` migration.
Reversible: Yes (3.8 may add a sequence).

### 18 Oct 2026 · 1.2 RepositoryError kinds and codes; constraint violations translated · decided by tdd-guide · risk: low
Decided: `scope` → `forbidden`, `not_found` → `not_found`, `invalid` → `validation`, `integrity` → `validation`. Writes translate a foreign-key violation to `not_found` (for example a scope id that is not a user) and a unique violation to `invalid` (an existing immutable package version); a duplicate message id is `not_found` and all other driver errors become `failed` (fix round 1, entry above). Messages carry the method and kind only.
Why: Driver messages quote row values (ids, text); a public repo's logs must not carry them.
Alternatives: Pass driver errors through; a separate `conflict` kind.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Ownership checks: INSERT … SELECT, or KEY SHARE check plus insert in one transaction · decided by tdd-guide · risk: low
Decided: Single-owner writes (sessions, messages, turn traces, package versions, teacher questions) are `INSERT … SELECT … FROM <owner> WHERE <scope>` built with `sql` templates and explicit casts. Set checks (package `moduleIds`, evidence `topicId`s, question `similarIds`) select the ids `FOR KEY SHARE` in the same transaction; any id that is missing or another teacher's makes the whole write fail with `scope`.
Why: Drizzle's `insert().select()` needs every column in table order; the template keeps the scope and the insert in one statement without `sql.raw`.
Alternatives: Check then insert without a lock.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Repository coverage enforced only when the integration suite runs · decided by planner (lead accepted) · risk: low
Decided: `vitest.config.ts` probes Postgres (or `CI=true`); when the suite runs, `src/repositories/**` must have 100% lines, functions and statements and 90% branches; otherwise that folder is left out of coverage so local runs without Docker stay green. CI always runs it.
Why: Lead answer Q3.
Alternatives: Always enforce (red without Docker); never enforce.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Small API limits not in the spec · decided by tdd-guide · risk: low
Decided: `teacherQuestions.listForStudent` returns at most the newest 200; `listForTeacher` takes a required `status` and a `limit` of 1..200; `teacherQuestions.open` rejects blank text and text over 8,000 characters; `sessions.get` returns a `SessionRow` with `helpState: unknown`.
Why: Bounded reads and no empty questions in a teacher's inbox.
Alternatives: Unbounded lists; accept any string.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Review · decided by team lead · risk: low
Decided: Scope types in packages/db/src/repositories/scope.ts stay structural (not branded). The composite index for a student's questions waits for the questions inbox (8.9).
Why: The scope is a required first argument and every method re-validates it at runtime, enforced by a test over all 16 methods; listForStudent is capped at 200.
Alternatives: Branded scope types; add the index now.
Reversible: Yes.

### 18 Oct 2026 · Transcription · decided by you · risk: low
Decided: Live-class recordings are transcribed by a hosted speech-to-text API behind the Transcriber port for the MVP.
Why: No GPU to run, fastest to ship; the board's recommendation.
Alternatives: Self-hosted Whisper.
Reversible: Yes; the Transcriber port keeps it swappable.

### 18 Oct 2026 · 2.2 Anthropic provider-key entry · decided by planner · risk: high
Decided: add `anthropic: { apiKey: { variable: 'EDMATE_ANTHROPIC_API_KEY' } }` to `PROVIDER_KEYS`, same shape as `openai-compatible`.
Why: Anthropic is the main provider (decision log, 18 Oct 2026); its key enters through the same one door as every other provider.
Alternatives: None; the module's whole point is one place for every provider's keys.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Anthropic base URL is always passed · decided by builder · risk: high
Decided: the Anthropic adapter always passes `baseURL: https://api.anthropic.com/v1` (and always the key), so the SDK never reads `ANTHROPIC_BASE_URL` or `ANTHROPIC_API_KEY`. No base-URL override is offered for Anthropic.
Why: `@ai-sdk/anthropic` reads `ANTHROPIC_BASE_URL` when no base URL is given; a stray variable in the environment would send Edmate's key to another host. `env-fallback.test.ts` proves neither variable is read.
Alternatives: Let the SDK default apply; offer a configurable base URL (a proxy can be added later as an explicit option).
Reversible: Yes.

### 18 Oct 2026 · 2.2 `@ai-sdk/openai-compatible` over `@ai-sdk/openai` + baseURL · decided by planner · risk: low
Decided: the second adapter uses `createOpenAICompatible` from `@ai-sdk/openai-compatible`.
Why: it is the AI SDK's own client for OpenAI-shaped backends that are not OpenAI (OpenRouter, self-hosted); it never reads `OPENAI_API_KEY`.
Alternatives: `@ai-sdk/openai` with a custom `baseURL`.
Reversible: Yes, swapping the package behind the same `ModelAdapter` shape.

### 18 Oct 2026 · 2.2 Capabilities live beside the port, not inside it · decided by planner · risk: low
Decided: `AdapterCapabilities` and `ModelAdapter` are gateway-only types; `ModelGateway` in contracts is untouched. Anthropic's capabilities are fixed; OpenAI-compatible's are overridable per deployment with conservative defaults (vision off, 8 192 tokens) and `embeddings` follows whether an embedding model is configured.
Why: capabilities are routing data for 2.3, not part of the call contract; no contract change means no ADR.
Alternatives: a `capabilities()` method on the port.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Mocked fetch, not MSW · decided by planner · risk: low
Decided: tests inject a fake `fetch` through the AI SDK provider settings; a vitest setup file makes the global fetch always reject.
Why: AI SDK providers accept a `fetch` override; this keeps rule 4 with no new dependency, and an adapter that ignored the override would fail loudly.
Alternatives: `msw`.
Reversible: Yes.

### 18 Oct 2026 · 2.2 AI SDK pins · decided by builder · risk: low
Decided: `ai` 7.0.143, `@ai-sdk/anthropic` 4.0.82, `@ai-sdk/openai-compatible` 3.0.71, pinned exactly.
Why: current stable on 18 Oct 2026; all three share the same `@ai-sdk/provider`/`provider-utils` versions.
Alternatives: caret ranges.
Reversible: Yes.

### 18 Oct 2026 · 2.2 No SDK retries; errors mapped to fixed codes · decided by builder · risk: low
Decided: adapters call the SDK with `maxRetries: 0` and replace its console `onError`. Provider errors become `GatewayError` with a contracts `ErrorCode` (`rate_limited`, `input_too_large`, `validation`, `provider_error`), a `retryable` flag and a message written by the mapper; nothing from the provider error (body, url, request, headers, cause) is kept. A wrong or revoked provider key is `provider_error`, not `unauthorized`/`forbidden` (those are for Edmate's own auth). A failed connection is retryable.
Why: retry and fallback are the router's job (2.3), and one retry layer is easier to reason about and to meter; provider errors can carry request content.
Alternatives: keep the SDK's default 2 retries; pass the provider message through.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Output that stops early is a failure · decided by lead (fix round 1) · risk: low
Decided: when the model stops because of the token cap (`truncated`) or the provider's content filter / a refusal (`content_filter`), `stream()` first yields what it streamed and the usage, then throws `GatewayError('provider_error', retryable false)` with a gateway-local `reason`. `generateObject()` throws the same, even when the cut-off JSON happens to parse.
Why: a cut-off or filtered answer must not reach a student as if complete; the pipeline discards the partial answer, and the spent tokens still reach metering. `reason` lives in the gateway because contracts are frozen.
Alternatives: return the partial output with a flag; a new contracts error code (needs an ADR).
Reversible: Yes.

### 18 Oct 2026 · 2.2 No usage chunk when usage is unknown · decided by lead (fix round 1) · risk: low
Decided: `stream()` emits a usage chunk only when the provider reports both token counts as non-negative integers; real zeros stay zeros. For 2.4 (metering): a turn can end with no usage chunk; treat that as "usage unknown" (flag it, don't record it as free). Known gap: `@ai-sdk/openai-compatible` turns a partly missing usage object into zeros before the adapter sees it.
Why: a made-up zero makes a paid turn look free and hides a provider that stopped reporting usage.
Alternatives: report zeros (the first version); estimate tokens from text.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Tool names are made provider-safe · decided by builder · risk: low
Decided: tool names are sent with characters outside `[A-Za-z0-9_-]` replaced by `_`, cut to 64 characters, `_2`/`_3` added on collision, and mapped back to the Edmate name on the way out. A call of a tool never offered or with unparseable arguments is a non-retryable `provider_error`.
Why: Edmate tool names such as `practice.next_item` contain dots, which Anthropic and OpenAI-style APIs reject.
Alternatives: forbid dots in tool names (a contracts change); encode names reversibly (longer, less readable to the model).
Reversible: Yes.

### 18 Oct 2026 · 2.2 Review · decided by team lead · risk: low
Decided: The `result.output as T` cast in packages/gateway/src/adapters/sdk-adapter.ts stays; tool-argument validation belongs to the tool registry (task 5.5), not the adapter.
Why: The cast narrows a ZodType<T> the caller already passed and is typecheck-clean; validating tool input where tools run keeps one place for it.
Alternatives: Drop the cast; validate tool args in the adapter.
Reversible: Yes.

### 18 Oct 2026 · Judge model for evals · decided by you · risk: medium
Decided: The eval runner scores answers with one mid-tier model (e.g. Claude Sonnet via the Anthropic adapter), pinned per release so scores stay comparable across runs.
Why: Cheapest consistent option; the board's recommendation.
Alternatives: The main model as judge; two judges that must agree.
Reversible: Yes, per release.

### 18 Oct 2026 · Demo course reviewer · decided by you · risk: low
Decided: You are the named subject expert in `reviewed_by` for the open-licensed demo course (task 1.8) for now; a real teacher re-reviews it before launch.
Why: Rule 7 needs a named human; this keeps 1.8 moving.
Alternatives: Name another person; postpone 1.8.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Fixture format and location · decided by planner · risk: low
Decided: Scripts are hand-written TypeScript data modules in `packages/harness/src/testing/`, typed against the contracts `ModelChunk`/`ModelRequest`. They are not JSON files and not in `evals/fixtures/`.
Why: Harness purity rules out loading files at runtime. `evals/fixtures/` is for 3.12's recorded live responses, which have a different lifecycle.
Alternatives: JSON fixtures loaded by path; one fixtures directory shared with the eval runner.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Clock kept local to harness/testing · decided by lead · risk: low
Decided: `Clock` (`{ sleep(ms): Promise<void> }`) lives in `packages/harness/src/testing/clock.ts`, not in contracts `ports.ts`.
Why: Only the test double needs it now. Task 3.1 should define the platform-wide clock/id shape and promote it by ADR if needed.
Alternatives: Add a `Clock` port to contracts now.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Matching per method, predicate first then order · decided by lead · risk: low
Decided: Each method has its own queue. A call takes the first unused entry whose `match` returns true (in script order). If none matches, it takes the first unused entry without a predicate. Entries are never reused. The `stream()` entry is picked when `stream()` is called, not when it is first iterated.
Why: Pipeline steps 3, 4 and retrieval run concurrently, so one global call order would make tests flaky.
Alternatives: One global counter; matching by order only; picking at first iteration.
Reversible: Yes.

### 18 Oct 2026 · 2.6 How a missing script entry fails · decided by builder · risk: low
Decided: `stream()` with no matching entry throws `ScriptedGatewayError` on the first iteration, the same way a provider failure would surface. `generateObject`/`embed` reject. The error names the method and the 0-based call index for that method. On a predicate miss it adds a redacted snapshot (`tier`, the first 80 chars of `system`, `messageCount`; for `embed`, `textCount` only).
Why: Callers such as the 2.3 router only need to handle errors in one place, during iteration. The snapshot never carries message text.
Alternatives: Throw synchronously from `stream()`; return an empty stream.
Reversible: Yes.

### 18 Oct 2026 · 2.6 generateObject validates with the caller's schema · decided by lead · risk: low
Decided: `generateObject` returns `schema.parse(value)`, so a bad fixture throws a Zod error.
Why: A malformed fixture fails where it is defined, not later in a caller's test.
Alternatives: Pass the value through with a cast.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Scripted provider errors and usage record · decided by builder · risk: low
Decided: A `{ type: 'error', code, message? }` step throws `ScriptedProviderError` carrying a contracts `ErrorCode`. `generateObject`/`embed` entries take an optional `usage`. The gateway exposes `usage`, a list of `{ method, usage }` in replay order that includes stream `usage` chunks.
Why: 2.3 needs a provider error it can recognise, and 2.4 needs usage from every call type, not only streams.
Alternatives: Throw a plain `Error`; leave usage on non-stream calls to later tasks.
Reversible: Yes.

### 18 Oct 2026 · 1.1 CI Postgres service container on the node job · decided by tdd-guide · risk: high
Decided: `.github/workflows/ci.yml`'s `node` job runs a `postgres` service (pgvector/pgvector:0.8.1-pg16, pinned by digest,
health-checked) with a throwaway password, and sets `TEST_DATABASE_URL`. `turbo.json` passes `TEST_DATABASE_URL` and `CI` to
`test`. The db integration tests fail when `CI=true` and the database is unreachable, and skip with a message locally.
Why: The acceptance ("migrate up/down clean") needs a real Postgres + pgvector on every PR (lead answer). Touches `.github/**`, so security-reviewer.
Alternatives: pglite (different engine, partial pgvector); a separate job (duplicates install/build); keep it local-only (no CI proof).
Reversible: Yes. Remove the service block and the env lines.

### 18 Oct 2026 · 1.1 Text ids with a UUID default · decided by planner · risk: low
Decided: Every primary and foreign key is `text`; new rows get `crypto.randomUUID()`.
Why: The contracts' id is any `[A-Za-z0-9_-]{1,128}` (fixtures use `stu_test_01`); a `uuid` column would reject valid ids.
Alternatives: Postgres `uuid`; prefixed ids.
Reversible: Yes, with a type-changing migration.

### 18 Oct 2026 · 1.1 "Migrate up/down clean" = apply, drop the test schemas, re-apply · decided by planner (lead accepted) · risk: low
Decided: Migrations are forward-only (drizzle-kit, no down files). The test applies them to an empty throwaway database, drops
`public` and `drizzle`, and applies them again; re-running on an applied database is a no-op.
Why: `database-migrations` skill: forward-only migrations; drizzle-kit has no per-file rollback.
Alternatives: Hand-written down.sql per migration.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Embedding column has no dimension and no vector index yet · decided by planner (lead accepted) · risk: low
Decided: `chunks.embedding` is a nullable dimensionless `vector` (a custom type). The dimension and the HNSW index come with
the embedding model in 2.7/5.3, in an additive migration. `0000_enable_pgvector.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`
so CI and managed hosts work without docker/postgres/init.sql.
Why: The embedding model isn't chosen; guessing a dimension would mean a re-index later.
Alternatives: Fix 1536 now.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Isolation in repositories, not RLS · decided by planner (lead accepted) · risk: low
Decided: No Postgres RLS policies. Teacher and student scoping is enforced by task 1.2's repositories; the schema gives every
teacher-owned table a `teacher_id` (FK to users, leading an index) and every student table a `student_id` (leading an index).
Why: ADR-0002's port split; one app database user.
Alternatives: RLS policies per table.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Postgres enums for the fixed sets, checked against the contracts · decided by tdd-guide · risk: low
Decided: 9 `pgEnum`s: user_role, subscription_status, agent_status, chunk_kind, message_role, teacher_question_status,
evidence_source, model_tier, ledger_direction. Tests fail if a set drifts from the contracts' Zod enum. Open-ended values
(verification_status, payment/payout status, report/takedown/safety status, consent kind) are plain `text`.
Why: The database rejects values the app can't produce; adding a value later is an additive `ALTER TYPE … ADD VALUE`.
Alternatives: text + CHECK (changing it needs DROP CONSTRAINT, which the merge gate flags as destructive); text with no constraint.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Full-text search uses the 'simple' configuration · decided by tdd-guide · risk: low
Decided: `chunks.search` is `to_tsvector('simple', text)`, generated and stored, with a GIN index.
Why: Edmate is country-neutral; 'simple' doesn't stem for one language, so it behaves the same for every locale. Per-locale configs can come with 2.7.
Alternatives: 'english'; a per-row regconfig column.
Reversible: Yes (additive migration with a new column/index).

### 18 Oct 2026 · 1.1 Money and cost as bigint read as JS numbers · decided by tdd-guide · risk: low
Decided: `amount_minor` and `cost_micro_usd` are `bigint` columns mapped to `number` (`mode: 'number'`), matching the contracts' `count()`;
ledger entries are positive amounts with a debit/credit direction grouped by `transaction_id`.
Why: Values stay far below 2^53; the contracts use numbers.
Alternatives: `mode: 'bigint'`; numeric.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Dependency pins and esbuild build script · decided by tdd-guide · risk: low
Decided: drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, @types/pg 8.23.1 (npm `latest` on 18 Oct 2026; drizzle 1.0 is still rc).
`pnpm-workspace.yaml` sets `allowBuilds: esbuild: false`: drizzle-kit's esbuild uses its prebuilt optional platform package.
Why: Exact pins (rule); pnpm refuses unlisted install scripts.
Alternatives: drizzle 1.0.0-rc; allow esbuild's install script.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Review · decided by team lead · risk: low
Decided: Money and cost columns in packages/db/src/schema/billing.ts stay `bigint` in number mode, which is exact up to 2^53 (about 9 quadrillion minor units); contracts use JS numbers too. Typed jsonb columns, session joins for message isolation, and pool limits are follow-ups in task 1.2.
Why: The ceiling is far above any realistic amount, and 1.2 is where rows are mapped to contract shapes.
Alternatives: bigint as strings or BigInt everywhere.
Reversible: Yes, one migration.

### 18 Oct 2026 · 2.1 Provider key module · decided by planner · risk: high
Decided: Provider keys are read once at startup, only by `packages/gateway/src/keys`, from a `KeySource` (the environment now; a secret manager later through the same interface, no vendor chosen). Each value is wrapped in a `Secret` that prints and serialises as `[redacted]` and is read only with `reveal()`, which only adapters call. A missing or malformed key stops startup with one error that names the variables but never shows a value, a length or a fragment. Rotating a key means a restart.
Why: one door and one wrapper make "never logged, never returned" something a test can check, not just a habit.
Alternatives: Read `process.env` in each adapter; plain strings plus a logger redaction list; hot reload of keys.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Env variable names · decided by planner · risk: medium
Decided: Provider key variables are `EDMATE_<PROVIDER>_<FIELD>`, starting with `EDMATE_OPENAI_COMPATIBLE_API_KEY`, not the SDK defaults such as `OPENAI_API_KEY`.
Why: AI SDK provider packages read their default variable on their own when no key is passed. A different name means a key can't bypass our module.
Alternatives: The SDK default names.
Reversible: Yes, renaming the variables in deploys.

### 18 Oct 2026 · 2.1 process.env left as is · decided by planner · risk: low
Decided: The loader does not delete key variables from `process.env` after reading them.
Why: the spec doesn't ask for it, and `--live` runs and other tools read the environment. The leak tests cover our own outputs.
Alternatives: Scrub the variables after load.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Pino pinned as a devDependency · decided by tdd-guide · risk: low
Decided: `pino` `10.4.0` (current stable on 18 Oct 2026) is pinned exactly as a gateway devDependency, used only by the log-scan test.
Why: Pino is the stack's logger; testing the real logger is stronger than testing `JSON.stringify` alone (lead answer Q3).
Alternatives: Test only `JSON.stringify`; make Pino a runtime dependency now.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Blank optional key means unset · decided by tdd-guide · risk: medium
Decided: For a provider that is not required, a variable that is empty or whitespace-only counts as unset, so the provider is skipped. For a required provider it is still the `empty` problem.
Why: copying `docker/env.example` gives `EDMATE_OPENAI_COMPATIBLE_API_KEY=` (empty); startup must not fail for a provider nobody asked for.
Alternatives: Treat any set variable, even empty, as "configured" and fail.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Unknown provider id is a reported problem · decided by tdd-guide · risk: low
Decided: An id in `required` that is not in `PROVIDER_KEYS` adds an `unknown_provider` problem to the same `KeyConfigError` instead of being ignored.
Why: the type stops it in TypeScript, but plain JS or a config string could pass one; failing loudly beats a silent skip.
Alternatives: Ignore it; throw a separate error type.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Log scan uses a real node Console, not stdout spies · decided by tdd-guide · risk: low
Decided: The console part of the log-scan test writes through `new Console({ stdout, stderr })` into memory instead of spying on `process.stdout.write`.
Why: Vitest intercepts the global console in workers, so stdout spies would see nothing and the check would pass vacuously. The per-sink positive control proves this sink captures output.
Alternatives: Spy on `process.stdout.write` (vacuous under Vitest); set Vitest's `disableConsoleIntercept`.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Review · decided by team lead · risk: low
Decided: Three LOW notes in packages/gateway/src/keys/load.ts stay as they are: error messages may name the caller's provider id (never a key value), and two type casts (`raw as string`, the generic cast in `get()`) are covered by tests. 2.2's adapters must always pass the key so the OpenAI SDK never falls back to OPENAI_API_KEY.
Why: None can expose a key; the casts are proven by tests.
Alternatives: Validate the id before use; discriminated results instead of casts.
Reversible: Yes.

### 18 Oct 2026 · 0.9 Per-commit secret scan runs main's scanner, allow list and driver · decided by tdd-guide · risk: high
Decided: A new CI job `secrets` (pull_request only) scans every commit in `origin/main..HEAD`. It uses the scanner and allow list from main (`git show origin/main:...` into `$RUNNER_TEMP`) and the driver `.github/scripts/scan-pr-commits.py`, also from main. The PR that adds the driver is the only one that uses its own copy, and it logs a warning when it does. The output shows commit, path, line and finding type only. Errors fail the job.
Why: A secret deleted in a later commit is still public in the history. Using main's copies stops a PR from weakening the scan of its own commits. It does not cover a PR that edits `ci.yml` itself: that is a `.github/**` risky path, so it needs a security review and a risk: high decision.
Alternatives: Use the PR's own driver every time (simpler, but the PR could change it). Put the logic inline in the YAML (harder to test). Change the scanner to read stdin (out of bounds for this task).
Reversible: Yes. Remove the job and the script.

### 18 Oct 2026 · 0.9 Lead adds `secrets` to required checks after merge · decided by tdd-guide · risk: low
Decided: Branch protection still needs `secrets` added to its required checks, as the plan says. This branch does not change branch protection.
Why: GitHub can only require a check that has already reported on main's PRs. Adding it before merge would block this PR.
Alternatives: None.
Reversible: Yes.

### 18 Oct 2026 · 0.9 Review · decided by team lead · risk: medium
Decided: A PR can still rewrite its own job in .github/workflows/ci.yml (GitHub runs the PR's copy of a workflow on pull_request). Accepted: the lead merges only through the local merge hook, which runs main's gate, and every .github change gets security-reviewer.
Why: Making a workflow untouchable needs org-level required workflows; CODEOWNERS doesn't help when the lead uses the owner account.
Alternatives: Org-level required workflows; a separate bot account.
Reversible: Yes.

### 18 Oct 2026 · Main model provider · decided by you · risk: medium
Decided: Anthropic (Claude) gets Edmate's native "main" adapter (task 2.2); the second adapter stays OpenAI-compatible, which also covers OpenRouter. Which model each tier uses is still decided after the cost and eval data (task 7.6).
Why: Strong instruction-following and refusal behaviour matter for a student-facing tutor and locked content.
Alternatives: OpenAI, Google Gemini, OpenRouter only for now.
Reversible: Yes; adapters sit behind the ModelGateway port.

### 18 Oct 2026 · 0.6 Exact pins for every dev container input · decided by tdd-guide · risk: low
Decided: Base image `mcr.microsoft.com/devcontainers/base:3.0.10-noble` by digest `sha256:21e9e327...86c3e6`; node feature `2.1.1` with Node `22.22.3` and nvm `0.40.8`; docker-outside-of-docker feature `1.10.1` with Docker CLI `29.5.3` and buildx `0.38.0`; Claude Code `2.1.302`; PyYAML `6.0.1-2build2` (apt); devcontainers CLI `0.89.0` for verification. Node 22.22.3 is the 22.x on the build machine, since `.nvmrc` and `engines` only say 22.
Why: Lead answer 1: pin everything so builds are repeatable; each version was current and checked to build.
Alternatives: Track `latest` or major tags (`:2`, `@latest`), which drift silently.
Reversible: Yes; bump the numbers in one PR.

### 18 Oct 2026 · 0.6 Not pinned where the tool has no option · decided by tdd-guide · risk: low
Decided: `python3` (3.12.3) and the `docker compose` plugin (moby-compose 5.6.0) are not pinned to an exact package version; jq (1.7.1) is fixed only by the base image digest.
Why: The docker feature has no compose-plugin version option, and pinning `python3` to an apt build in `noble-updates` would break once Ubuntu replaces it; the base digest already fixes jq.
Alternatives: Pin apt versions of python3/jq exactly and accept builds breaking on security updates.
Reversible: Yes.

### 18 Oct 2026 · 0.6 Node via the official node feature · decided by team lead · risk: low
Decided: Node comes from `ghcr.io/devcontainers/features/node` (pinned), not an nvm curl-install in postCreateCommand; pnpm only through corepack (`pnpmVersion: none`).
Why: Lead answer 2; the feature is pinned and cached in the image, and avoids piping an unpinned install script.
Alternatives: nvm install script in postCreateCommand, as the original plan step 2 said.
Reversible: Yes.

### 18 Oct 2026 · 0.6 Forward only port 3000; mount the repo at its host path · decided by tdd-guide · risk: low
Decided: The dev container forwards 3000 only, and mounts the workspace at the same path as on the host.
Why: Docker runs on the host (docker-outside-of-docker), so Compose already publishes 8080/9000/9001 on the host and forwarding them would clash; same-path mounting makes Compose's relative bind mounts work from inside the container.
Alternatives: Forward 8080/9000/9001 as the plan said; mount at `/workspaces/edmate` and pass `LOCAL_WORKSPACE_FOLDER` into Compose.
Reversible: Yes.

### 18 Oct 2026 · 0.5 CI reads scripts from main, not the PR · decided by planner · risk: high
Decided: `merge-gate.yml` and `risk-label.yml` check out `main` and only `git fetch` the PR's head commit into a same-named branch; they run main's `merge_gate.py`/`risk_labels.py`, never code from the PR.
Why: Running the PR's own copy of the gate would let a careless or malicious PR switch off its own check.
Alternatives: Check out the PR head (simpler, but that hole); `pull_request_target` (more ceremony and a riskier token, no gain).
Reversible: Yes.

### 18 Oct 2026 · 0.5 Risk labels are informational only · decided by planner · risk: high
Decided: The labeller adds `needs:<reviewer>` and `risk:touched` labels for visibility; no gate reads PR labels, and no `human-approved` label is created or checked anywhere.
Why: The lead decides every merge (human decision, 18 Oct 2026); a label gate would bring back the removed human-approval step.
Alternatives: Gate on a label, as 0.5 was first written; already rejected by the human.
Reversible: Yes.

### 18 Oct 2026 · 0.5 Workflow hardening choices · decided by tdd-guide · risk: medium
Decided: Actions pinned by full commit SHA with a version comment, minimal top-level permissions, `persist-credentials: false`, PR branch names passed through `env:` rather than inlined in shell, and the labeller skipped on fork PRs. A test file enforces all of these.
Why: Stops tag-swap supply-chain attacks, script injection through a crafted branch name, and token reuse by later steps.
Alternatives: Tag pins like `@v7` (drift silently); `actions/labeler` with its own glob list (would duplicate risk-paths.txt).
Reversible: Yes.

### 18 Oct 2026 · 0.5 No pnpm cache in CI for now · decided by tdd-guide · risk: low
Decided: `setup-node` runs without its pnpm cache; pnpm comes from corepack at install time.
Why: The cache step needs pnpm on PATH before corepack provides it; getting the order wrong breaks the job, and installs take only seconds.
Alternatives: `cache: pnpm` after a separate corepack step; `actions/cache` on the pnpm store.
Reversible: Yes.

### 18 Oct 2026 · 0.4 ADRs recorded · decided by team lead · risk: high
Decided: Three architecture decisions already made in the build plan and the decision log are now written down as ADRs: the tech stack (TypeScript throughout, no Rust), where port interfaces live (`packages/contracts/src/ports.ts`, type-only, differing from the Repo-layout prose that says harness defines them), and the access filter being built by construction (filtered search, the code-only probe, public titles, the 8-token leak definition). A template (`docs/adr/0000-template.md`) fixes the shape every future ADR must use.
Why: Rule 2 requires an ADR before contracts, stack or prompt-pack behaviour can change again; writing these three down now gives that rule something to point at, and the ports note resolves a reader-visible conflict between two parts of the spec. No code or contract changed; the ADRs only record what the spec and log already say, each with its source.
Alternatives: Leave the decisions only in the build plan and decision log, with no `docs/adr/` folder yet.
Reversible: Only by a new ADR superseding one of these.

### 18 Oct 2026 · 0.4 Builder writes the ADR text · decided by team lead · risk: low
Decided: For task 0.4 the builder wrote the ADR text directly from the build plan, PRD and decision log; `architect` did not pre-draft it, but still reviews every ADR and its findings are fixed before merge.
Why: Saves tokens; these ADRs only record decisions already made, so there is nothing for architect to decide up front.
Alternatives: Architect drafts the full ADR text first and the builder copies it, as the plan and the merge-gate skill describe.
Reversible: Yes; later ADRs can go back to architect drafting.

### 18 Oct 2026 · 0.4 Heading check has its own tests · decided by tdd-guide · risk: low
Decided: Added `docs/adr/test_check_headings.py` (stdlib unittest) next to `docs/adr/check-headings.py`, and the script takes an optional folder argument so tests can run it on temporary folders.
Why: The brief asked for tests first; a folder argument lets the tests check failures without breaking the real ADRs.
Alternatives: Only run the script by hand against the real folder.
Reversible: Yes, delete the test file.

### 18 Oct 2026 · 0.4 Review · decided by team lead · risk: low
Decided: check-headings.py does not flag a heading that appears twice; it checks only that every template heading is present and in order. The lead fixed four wording findings in the ADRs and the README in this PR.
Why: Duplicate headings are harmless and nothing in the spec asks for the check; later ADR edits need three reviewers, so cheap fixes were made now.
Alternatives: Add a duplicate check.
Reversible: Yes.

### 18 Oct 2026 · 0.3 Contracts created · decided by team lead · risk: high
Decided: The shared contracts now exist as Zod schemas, exactly matching the build plan's Core contracts. Tests fail if the code and the spec drift apart. Unknown fields are rejected, and the limits in the spec comments are enforced. From now on, changing a contract needs an ADR.
Why: Every package builds on these shapes; the tests prove they match the spec.
Alternatives: Hand-written TypeScript types without runtime checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Ports live in contracts · decided by team lead · risk: medium
Decided: The ports (Guard, Tool, RetrievalIndex, the stores, UsageMeter, ModelGateway, TraceSink, AlertSink) are type-only interfaces in packages/contracts/src/ports.ts, with no Zod schemas and no fixtures. The db, gateway and ingest adapters implement them by importing contracts, although the spec's repo layout says the harness defines them.
Why: Adapters can implement them without depending on the harness; functions can't be Zod data.
Alternatives: Define them in packages/harness.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Spec shapes kept as written · decided by team lead · risk: low
Decided: TurnEvent hint_rung keeps rung as a number and TurnTrace guards keep action as a plain string, as the spec says; at runtime hint_rung must be a whole number from 0 to 4.
Why: No type change to the spec, but bad rungs are still caught.
Alternatives: Change the types to the rung union and the guard action enum (needs an ADR).
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Conditional rules enforced · decided by team lead · risk: medium
Decided: Four rules from the spec comments are checked at runtime: an entitlement has a subscriptionId exactly when its source is subscription; no module is both allowed and locked (fail closed); a message turn needs text; a skill_action turn needs a skill. Each has a valid and an invalid fixture. TeacherQuestion.answeredAt has no rule.
Why: The spec states them in comments; checking them stops bad data at the boundary.
Alternatives: Leave them to the code that uses the data.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Field formats · decided by team lead · risk: medium
Decided: Timestamps are ISO 8601 with Z or an offset. Languages are a lowercase 2–3 letter primary tag. Currency is three capital letters. Market is a two-capital-letter ISO 3166 code or the word "global" (no invented codes; the pilot market stays your decision). Ids are any non-empty string. Counts, token numbers, versions, minor-unit amounts and cost are whole numbers from 0 up. Mastery p is between 0 and 1. Characters are counted as Unicode code points and words as runs of non-space. Attachment mime must start with image/.
Why: The spec gives these fields as plain strings and numbers; these are the narrowest formats it implies.
Alternatives: No format checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 No default message limit in the contract · decided by team lead · risk: low
Decided: PackageConfig.dailyMessageLimit is required in the contract; the studio and the seed fill in 20.
Why: A Zod default would make the field optional in the input type and break the exact match with the spec.
Alternatives: A Zod default of 20.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Zod version and strict objects · decided by tdd-guide · risk: low
Decided: Contracts pin zod 4.6.7 exactly (the newest stable 4.x on npm today). Every object schema is strict, so unknown keys are errors, not silently dropped; a client-sent packageId on a turn is rejected. Optional fields use Zod's exactOptional, so the types match the spec exactly and an explicit undefined is rejected.
Why: Zod 4 has the features the plan needs; strict objects catch typos and client-sent access fields.
Alternatives: zod 3; stripping unknown keys.
Reversible: Yes for the version; strictness only by ADR.

### 18 Oct 2026 · 0.3 Prompt-pack version is semver · decided by tdd-guide · risk: low
Decided: AgentConfig.promptPackVersion must be a semantic version such as 1.0.0 or 2.1.0-rc.1, because the spec comment says one semver pins the prompt-pack set.
Why: Catches values like "latest" that would break pinning.
Alternatives: Any string.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Size caps and safe formats · decided by tdd-guide · risk: medium
Decided: After review, the contracts cap sizes and narrow formats the spec left open. Ids are 1–128 letters, digits, _ or -. An attachment storage key is a relative path of at most 200 safe characters with no ".." part; an attachment is a PNG, JPEG, WebP or HEIC image of 1 byte to 20 MB. A skill payload is at most 16 KB of JSON. Turn text is also capped at 8,000 UTF-16 units before the 4,000-character count. Guard reasons are at most 500 characters; rewrite text and alert excerpts at most 8,000. Each locale PII pattern is at most 500 characters and must be a valid regular expression. The numbers live in LIMITS.
Why: Untrusted or model-made data reaches storage, prompts and alerts; small fixed caps stop abuse and runaway output at the boundary.
Alternatives: No caps; caps enforced only in the API layer.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Turn context must be consistent · decided by tdd-guide · risk: medium
Decided: A turn context is rejected if a retrieved chunk comes from a module the entitlement doesn't allow or from another teacher, or if the entitlement's package id, package version or agent id don't match the package and agent in the context.
Why: Fails closed if a bug ever mixes another package's or teacher's material into a turn.
Alternatives: Leave the checks to the pipeline code.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 One shared zod copy · decided by tdd-guide · risk: low
Decided: Contracts lists zod 4.6.7 as a peer dependency (and a dev dependency for its own tests), and each consumer installs zod itself; the harness now lists zod 4.6.7 because it uses the contracts at runtime.
Why: Every package then shares one zod, so schemas and their types stay compatible.
Alternatives: zod as a normal dependency of contracts.
Reversible: Yes.

### 18 Oct 2026 · 0.3 Review · decided by team lead · risk: low
Decided: The type cast in packages/harness/src/testing/fixtures.test.ts stays for now; the ports-in-contracts note goes into ADR-0002 (task 0.4). MEDIUM review findings were fixed in this PR, not deferred, because contracts freeze on merge.
Why: The cast is test-only and narrow; fixing contracts later would need an ADR and three reviewers.
Alternatives: Defer the MEDIUMs to a follow-up task.
Reversible: Yes.

### 18 Oct 2026 · 0.2 MinIO image from a community build · decided by tdd-guide · risk: medium
Decided: The local S3 server is `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, a maintained community build of the MinIO server with dated release tags, because the official MinIO images are no longer published.
Why: The amendment asks for MinIO pinned to a dated release tag; this is the only source found that still has one. It is dev-only, and the app talks plain S3, so it can be swapped without code changes.
Alternatives: `bitnamilegacy/minio` (frozen at 2025.7, no updates); Chainguard's MinIO (free tier is `latest` only); a different S3 server such as SeaweedFS or RustFS; building MinIO from source in our own image.
Reversible: Yes, one image line in docker/compose.yaml.

### 18 Oct 2026 · 0.2 Other image pins · decided by tdd-guide · risk: low
Decided: `pgvector/pgvector:0.8.1-pg16`, `redis:7.4.6-alpine`, `caddy:2.10.2-alpine`, and `node:22.22.3-alpine3.22` for both app images (the same Node as `.nvmrc` 22 in dev).
Why: Exact tags as amendment 2 asks; pgvector's image is Postgres 16 with the extension built in.
Alternatives: Floating tags such as `pg16`, `7-alpine`, `2-alpine`, `22-alpine`.
Reversible: Yes.

### 18 Oct 2026 · 0.2 S3 client · decided by lead · risk: low
Decided: The storage round-trip uses the AWS SDK v3 S3 client (`@aws-sdk/client-s3` 3.1152.0, exact), with path-style addressing on by default for MinIO.
Why: Production is any S3-compatible bucket, not necessarily MinIO (amendment 7).
Alternatives: The MinIO JS SDK.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Ports and defaults · decided by tdd-guide · risk: low
Decided: Only Caddy publishes a port, on 127.0.0.1:8080 (`EDMATE_HTTP_PORT`), plus MinIO's API and console on 127.0.0.1:9000/9001; web, worker, Postgres and Redis stay on the compose network. Compose runs with no env file: every setting has a dev default (`edmate` / `edmate-dev` / `edmate-dev-storage`) documented in docker/env.example.
Why: Port 3000 is taken on this machine (amendment 4); binding to 127.0.0.1 keeps the dev passwords off the local network; agents cannot create env files (amendment 3).
Alternatives: Publish on all interfaces; require an env file.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Standalone web image · decided by lead · risk: low
Decided: The web image runs Next.js standalone output (`output: 'standalone'` in apps/web/next.config.ts) as the `node` user; the worker image uses `pnpm deploy --prod` and runs as `node`.
Why: Small runtime images (about 200 MB) with no dev dependencies or root process.
Alternatives: `pnpm --filter web start` on a full install.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Worker healthcheck · decided by tdd-guide · risk: low
Decided: The worker counts as healthy when its container can open a connection to Redis, its queue.
Why: The worker has no HTTP port yet and app code was out of scope; this shows the process is up and its one dependency is reachable.
Alternatives: A heartbeat file or HTTP endpoint written by the worker (needs a change to apps/worker/src/index.ts); no healthcheck.
Reversible: Yes, when real queues land.

### 18 Oct 2026 · 0.2 Review · decided by team lead · risk: low
Decided: Three LOW review notes stay as they are: the MinIO healthcheck in docker/compose.yaml uses the image's own `mc`; apps/web/Dockerfile has no `outputFileTracingRoot`; roundtrip.ts picks a random object key by default. The MinIO community image is pinned by digest.
Why: Each is shown working in the evidence; none affects production.
Alternatives: Add a custom healthcheck, set outputFileTracingRoot, pass an explicit key.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Lead-approved risky merges · decided by tdd-guide · risk: high
Decided: The merge gate passes a risky branch only when review.md names every reviewer its risk groups need (listed in risk-paths.txt) and the handoff has a risk: high entry; otherwise it fails. It no longer reads the PR label and never says "needs human". A risky path with no reviewers line fails the gate.
Why: Your decision that the lead merges everything; this keeps the specialists and puts every risky merge on your skim list.
Alternatives: Keep a human step for some groups.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Decision checks · decided by lead · risk: low
Decided: A [wontfix] finding passes only if a decision entry for the task names its file. `board.py done` needs each handoff `Decided:` line word for word in the log.
Why: Simple, mechanical, hard to satisfy by accident.
Alternatives: Count entries; fuzzy matching.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Locale packs count as safety · decided by tdd-guide · risk: medium
Decided: Changes to content/locales need safety-reviewer and a safety-review.md, like the other child-safety paths.
Why: The scope change put locales in the safety group, and the safety review file goes with that group.
Alternatives: safety-reviewer only, no safety-review.md.
Reversible: Yes, one line in the gate.

### 18 Oct 2026 · 0.7 Wontfix file match · decided by tdd-guide · risk: low
Decided: The file a [wontfix] finding covers is its first word that looks like a path (has a slash or a file extension). An entry passes if it names that path or just the file name.
Why: Matches the review.md format; file names are how people write decisions.
Alternatives: Require the full path.
Reversible: Yes.

` ignored, safety-review.md for safety paths and locales, destructive migration needs `database-reviewer`, a glob with no `# reviewers:` line fails closed, never exit 3. `Wontfix` (6 cases).
- `test_board.py` (11): `done` refused with no handoff / no `## Decisions` / a `Decided:` line not in the log word for word / a condensed line (board file unchanged each time); `None` and whitespace-only differences pass; `next` warns for a planning task with no plan.md and not once it exists; other statuses unchanged.
- `test_hooks.py` (9): runs main's hooks unchanged (no edits): force-push denied, push to main allowed when the secret scan is clean and denied when it flags (a tracked `.npmrc`), label deny, `gh pr merge` needs a number, `.env` deny, no asks; guard-paths denies secrets/key files, allows contracts and harness files.

Gate demo in a temp repo (`contracts` change, `risk: high` entry present):
```
$ merge_gate.py 9.9   (reviewers missing) -> exit 1
  risky packages/contracts/src/x.ts
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing architect
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing security-reviewer
RESULT: FAIL — fix the items above, re-run the reviewers, then run the gate again.
$ merge_gate.py 9.9   (all three named) -> exit 0
  risky packages/contracts/src/x.ts
RESULT: PASS — risky, lead-approved: the required reviewers ran and a risk: high decision is logged. ...
```

`python3 .githooks/secret-scan.py --all`: clean (see final commit).

### 18 Oct 2026 · Merge policy · decided by you · risk: high
Decided: No permission prompts from the repo's hooks, and the team lead decides every merge, risky ones included. A risky merge needs the right specialist reviewers (safety-reviewer for child safety, security-reviewer for access, payments, sign-in and keys, architect for contracts and ADRs) and is logged as risk: high. Hard blocks stay: no secrets or key files, secret scan before pushes, harness purity, no force-push.
Why: You don't want to approve merges or edits; the lead holds the context.
Alternatives: Your approval for risky paths (the old rule).
Reversible: Yes; restore the ask rules and the merge gate's exit 3.

### 18 Oct 2026 · Repo and push policy · decided by you · risk: high
Decided: The code is now on GitHub at github.com/sid2305/edmate (public). Agents push, including straight to main; there is no human push step. Force-push stays blocked, and every push to main runs the secret scan first and is refused if anything is flagged.
Why: You don't want to run pushes yourself.
Alternatives: Agents push task branches only and the human pushes main; PR-only merges.
Reversible: Yes; restore the deny rule in guard-bash.sh.

### 18 Oct 2026 · Merge policy · decided by you · risk: high
Decided: Changes to packages/contracts no longer need your approval. The team lead decides, provided an ADR (written by architect) explains the change, security-reviewer and an Opus typescript-reviewer have reviewed it, and the lead logs it as risk: high. ADRs about the tech stack or prompt-pack behaviour, and all other risky paths, still need you.
Why: You don't want to be the bottleneck for contract changes.
Alternatives: Keep your approval for every contract change.
Reversible: Yes; put packages/contracts back on the human list.

### 17 Oct 2026 · Board · decided by you · risk: low
Decided: Added task 0.7, harness fixes found in the 0.1 dry run: a local human approval for the merge gate, decision-log checks, shell-write guards for protected paths, and planner and plan-file fixes.
Why: Without them, risky tasks can't pass the gate before GitHub exists, and some rules are only enforced for the Edit and Write tools.
Alternatives: Live with the gaps until CI (0.5).
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: Pinned pnpm 12.14.0, Turborepo 2.11.9, ESLint 10.13, Vitest 5.0.5, Next.js 16.4.2, React 19.3.1, BullMQ 6.3.16, Node 22.x. TypeScript 6.0.3, not 7, because the ESLint TypeScript plugin doesn't support 7 yet.
Why: Newest stable versions that work together on Node 22.
Alternatives: TypeScript 7 without type-aware linting.
Reversible: Yes, by bumping versions.

### 17 Oct 2026 · 0.1 Harness purity rule · decided by tdd-guide · risk: medium
Decided: Two narrow exceptions to the harness import rule: `vitest` in test files only, and tooling config files at the harness root (eslint.config.js, vitest.config.ts). Everything else fails closed, including relative paths that leave the package, unreadable import paths and indirect use of `require`.
Why: Harness tests need vitest and the lint config needs its preset; neither ships as harness code.
Alternatives: Vitest globals with no exceptions.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by you · risk: low
Decided: `packages/payments` is not created as an empty workspace; the payments milestone (M10) creates it.
Why: Same rule as the other risky folders: no empty placeholders in risky paths.
Alternatives: An empty shell like contracts, which would also need your approval.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by planner · risk: low
Decided: `edmate --version` runs from the built output; no dev-mode entrypoint. The web app gets no Tailwind, shadcn or next-intl yet, only `/api/health` and the minimal pages Next.js needs.
Why: Matches the acceptance order (build, then test, lint); UI choices belong to the UI tasks.
Alternatives: A tsx dev entrypoint; wiring the UI stack now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: pnpm is a root dev dependency (no global install); install scripts are off by default; BullMQ uses its plain-JS fallback instead of a native add-on. Next.js's auto-generated AGENTS.md is off and next-env.d.ts is git-ignored.
Why: Repo rules forbid global installs; fewer install scripts means less supply-chain risk; the repo's CLAUDE.md already holds agent rules.
Alternatives: corepack enable; committing generated files.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Review · decided by team lead · risk: low
Decided: Two LOW review findings left as they are: the CLI reads its own package.json with an unchecked type cast, and the worker test passes a fake Redis with a type cast.
Why: Neither handles outside data.
Alternatives: Validate with Zod; build a typed fake connection.
Reversible: Yes.

### 17 Oct 2026 · Tech stack · decided by Claude (lead), at your request · risk: medium
Decided: Keep TypeScript end to end; no Rust. Revisit only for a single hot spot at scale, as a Rust service behind an existing port, with its own ADR.
Why: Turns are dominated by model, database and network waits, not our code; one language lets every app share the Zod contracts; the libraries we need (Next.js, Auth.js, AI SDK, Drizzle, BullMQ, payment SDKs) are TypeScript-first; agents and contributors move faster in TypeScript.
Alternatives: Rust backend with a TypeScript front end; Rust for the harness only.
Reversible: Yes, per component behind ports.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by you · risk: low
Decided: The scaffold does not create empty placeholder folders in risky or safety paths (harness access and guardrails, prompt packs, skills, locales, safety and locked evals, ADRs). The task that fills each folder creates it; the README lists the full layout.
Why: Empty files there would trigger safety review and approval for nothing.
Alternatives: Create every folder now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Harness purity rule · decided by you · risk: low
Decided: The harness may import only contracts, zod, mathjs and its own files. Node built-ins (like node:crypto or fs) are blocked too.
Why: Rule 3 taken literally keeps the harness free of hidden I/O; a later need gets an explicit allow-list entry and a log entry.
Alternatives: Allow all node: built-ins.
Reversible: Yes, a one-line lint change.

### 17 Oct 2026 · Product · decided by you · risk: high
Decided: When the teacher's material doesn't cover a question, the agent says so and sends the question to the teacher. The teacher answers from an inbox; the answer goes back to the student and becomes a teacher note and a test case, so the agent can answer similar questions next time. The agent never fills gaps with general knowledge.
Why: Keeps the teacher in the loop and makes the agent better with every answer.
Alternatives: Allow labelled general knowledge; strict "not covered" with no follow-up.
Reversible: Yes.

### 17 Oct 2026 · Scope · decided by you · risk: medium
Decided: MVP cuts from the review: Google and email sign-in (no phone OTP); two model adapters; provider subscriptions with manual monthly payouts; study plan and photo upload moved to P1; load test at 50 students; manual teacher verification and regulated-subject review. One course and one agent per teacher. A public teaching scorecard on teacher pages is in the MVP.
Why: A smaller pilot that still shows what makes Edmate different.
Alternatives: Full scope.
Reversible: Yes; each item returns as a P1 task.

### 17 Oct 2026 · Build plan · decided by Claude · risk: medium
Decided: Applied the independent review (Fable) to the plan before task 0.1: completed the core contracts (about 12 missing types, entitlement sources for teacher preview and evals, one status list, guard results that carry replacement text, timezone, structured skill events); a code-only probe so "locked" and "not covered" are told apart without locked text reaching any model; concurrent checks so the harness adds under ~600 ms; per-turn cost ceiling and a default of 20 messages a day; the eval runner moved before the guards, with seeded suites; a defined "leak"; gates scoped by change. New tasks: demo teacher content (1.8), prompt packs v1 (3.11), eval runner (3.12), seed suites (4.0), ask-the-teacher path (5.10), outline and style drafters (5.11), scorecard (7.8), questions inbox (8.9). Now 104 tasks.
Why: The contracts freeze at task 0.3; fixing them later would need ADRs and rework.
Alternatives: Start building and fix as we go.
Reversible: Yes, until 0.3 merges.

### 17 Oct 2026 · Setup · decided by you · risk: low
Decided: All coding work (tdd-guide, build-error-resolver) runs on Opus 5.5 at medium effort, pinned in their agent files. The team lead no longer switches models for coding; cheaper defaults and per-task choices still apply to planning, review and docs agents.
Why: Code quality matters most where code is written; medium effort keeps token use in check.
Alternatives: Sonnet by default with Opus only for risky tasks.
Reversible: Yes, two lines in the agent files.

### 17 Oct 2026 · Setup · decided by you · risk: medium
Decided: The team lead picks each agent's model per task to save tokens. Every agent has a cheap default (mostly Sonnet, Haiku for docs lookup); the lead moves up to Opus only for risky or core tasks, or after two failed fix rounds. The safety reviewer always runs on Opus. The model used is recorded per task on the board.
Why: Most tasks don't need the most expensive model; the record shows where it is worth paying for.
Alternatives: One fixed model per agent.
Reversible: Yes, edit the table in the team-lead skill.

### 17 Oct 2026 · Product · decided by you · risk: medium
Decided: Edmate is country-neutral. Currency, language, helplines, payments, tax and privacy rules live in a locale pack per market; prices are stored as amount + currency. The pilot launches in one market, chosen later.
Why: Keep the platform open to any market; adding one later should mean adding a pack, not rewriting code.
Alternatives: India only.
Reversible: Yes, but cheapest to decide now, before the contracts freeze (task 0.3).

### 17 Oct 2026 · Setup · decided by Claude · risk: medium
Decided: The agent team changes for v0.3. The life-skills content-author is replaced by a pedagogy-author (platform prompt packs, skill and persona templates, the demo course). The safety-reviewer and eval-author now also cover locked content and regulated-subject advice. The access filter, payments and webhooks, and skill templates count as risky paths. marketing-agent and market-research move into the Validate phase; seo-specialist moves to the website phase; search-first is added for library choices.
Why: Teachers now bring their own course material, and the new promises (locked packages, payments) need the same protection as safety code.
Alternatives: Keep the v0.2 agents unchanged.
Reversible: Yes.

### 17 Oct 2026 · Build plan v0.3 · decided by Claude · risk: medium
Decided: Rewrote the build plan for PRD v0.3: 14 milestones, 94 tasks. The harness is still built and proven first (M0–M7), now with the access filter at its centre (task 5.4) and an exit gate requiring zero locked-content leaks. Payments (M10) and the trust console (M12) can run alongside. The v0.2 plan and PRD are archived in docs/archive/.
Why: The product changed from a school harness to a teacher-agent marketplace.
Alternatives: Patch the v0.2 plan.
Reversible: Yes; task IDs changed, so nothing built against the old plan exists yet.

### 17 Oct 2026 · Product · decided by you · risk: high
Decided: Edmate is a platform where a student finds the right teacher and learns with that teacher's AI agent. Teachers build the agent from their own knowledge and sell packages that control what the agent knows and can do. Not classroom-based, not a school replacement.
Why: Your direction for the product (PRD v0.3).
Alternatives: The v0.2 free, school-based life-skills harness.
Reversible: Yes, before code is built.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: Nothing private or personal goes into the repo. A secret scan blocks credentials, private keys, personal emails and home-folder paths at three points: when an agent edits a file, at every git commit, and (from task 0.5) in CI. GitHub secret scanning and push protection are switched on when the repo is created.
Why: The repo is public, and anything pushed can be copied before it is deleted.
Alternatives: Rely on .gitignore only.
Reversible: Yes, but a leaked key must always be rotated, never just deleted.

### 16 Oct 2026 · Setup · decided by Claude · risk: low
Decided: This repo's commits use your private GitHub address (11736444+sid2305@users.noreply.github.com) instead of your Gmail. Your global git settings are unchanged.
Why: Every commit's email is public in a public repo.
Alternatives: Keep the Gmail address.
Reversible: Yes, one git setting.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Agents act on GitHub through a private GitHub App (edmate-bot), not your account. Its key lives outside the repo in ~/.edmate-bot/.
Why: GitHub can then tell agent actions from yours, so only you can give the human-approved label, and you can approve the bot's PRs.
Alternatives: A second "machine" GitHub account; your own account with a hook.
Reversible: Yes.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: The GitHub repo is public.
Why: Edmate is open source; branch protection and Actions minutes are free for public repos.
Alternatives: Private until the exit gate (needs GitHub Pro for branch protection).
Reversible: Partly. Anything already public may have been copied.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Code is MIT-licensed. Curriculum content stays CC BY-SA 4.0, as the PRD says.
Why: MIT is the easiest for schools, NGOs and other programmes to adopt.
Alternatives: Apache 2.0; AGPL.
Reversible: Only for future versions.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: The team lead merges PRs itself once reviews are done, every CRITICAL and HIGH finding is fixed and re-checked, and the gates are green. You are asked only for risky or ambiguous changes.
Why: Waiting on you for every PR would stall the build; the lead holds the full context.
Alternatives: You approve every PR.
Reversible: Yes, by editing `risk-paths.txt` or the merge-gate skill.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: Child-safety code, frozen contracts and ADRs, keys, sign-in, data isolation, migrations that delete data, and the `.claude/` and `.github/` config count as risky and need your `human-approved` label.
Why: The PRD calls a safety incident with a minor "existential", and these areas are hard to undo.
Alternatives: The lead also merges these.
Reversible: Yes, edit `.claude/skills/merge-gate/risk-paths.txt`.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Keep this decision log as one Markdown file, newest first, written only by the team lead on `main`.
Why: One writer means no merge conflicts between parallel agents; Markdown is easy to read anywhere.
Alternatives: One file per decision; a Claude Doc.
Reversible: Yes.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Host the code on GitHub and use GitHub Actions for CI gates, the merge-gate check and risk labels (added with task 0.5).
Why: GitHub then enforces the merge rules, rather than us trusting an agent to follow them.
Alternatives: Local checks only.
Reversible: Yes.
Open: private repo with GitHub Pro, or public now; a separate bot account for agent PRs (see the board's decisions).

### 15 Oct 2026 · Setup · decided by you · risk: medium
Decided: Use ECC's agents and skills as a library: copy only what each phase needs into the repo, instead of installing all of ECC.
Why: All of ECC adds about 35k tokens to every session, and its generic rules clash with the build plan.
Alternatives: Full ECC install; ECC plugin scoped to this project.
Reversible: Yes.

### 15 Oct 2026 · Setup · decided by you · risk: low
Decided: Use ECC agents instead of a custom role-based team (team lead, PM, designer and so on). Keep 3 Edmate-only agents ECC lacks: safety-reviewer, content-author, eval-author.
Why: ECC's agents are already tested; Edmate needs only the gaps filled.
Alternatives: A custom team of about 12 role agents.
Reversible: Yes.

### 15 Oct 2026 · Setup · decided by you · risk: low
Decided: Everything lives in `~/edmate` with project-level settings; nothing is installed globally.
Why: Keeps your other projects untouched, and the setup versioned with the code.
Alternatives: Global install in `~/.claude`.
Reversible: Yes.
