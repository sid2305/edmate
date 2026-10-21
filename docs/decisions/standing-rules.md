# Standing rules

Hand-picked decisions from `docs/decisions/log.md` that still hold as ongoing policy, not one-off choices. `python3 .claude/skills/board/board.py digest` copies each bullet into `docs/decisions/digest.md` and refuses a bullet whose citation is not a digest entry in the log (a human decision, or a risk: high lead decision). Never add a rule the log doesn't hold; to change one, log the new decision first.

One bullet per rule: `- <rule> (cites: <date · title of the log entry>)`.

- The pilot targets the US only; India work is parked. (cites: 21 Oct 2026 · US is the first region; India parked)
- Build the platform end to end and raise agent quality first; payments (M10) come last. (cites: 18 Oct 2026 · Payments come last)
- MVP first: M4 polish is parked, safety review runs once at the pilot gate, and the lead signs eval cases. (cites: 20 Oct 2026 · MVP first: M4 polish parked, safety review once at the pilot gate, the lead signs eval cases)
- The agent teaches and replies in English only; Hindi and Hinglish are a safety net in detection, not a teaching language. (cites: 18 Oct 2026 · Pilot language: English only, with a Hindi/Hinglish safety net)
- Crisis replies stay in English for the pilot, even when distress is detected in Hindi or Hinglish. (cites: 19 Oct 2026 · Crisis replies stay in English for the pilot)
- Learners are 13 or older. (cites: 18 Oct 2026 · Minimum learner age)
- Every hard distress phrase stays hard near a game word; occasional false pages are accepted. (cites: 19 Oct 2026 · Distress detection drops the game-talk exemption)
- A distress alert is an SMS to the on-call phone with an email backup. (cites: 19 Oct 2026 · Distress alerts go by SMS to the on-call phone with email backup)
- Repeated jailbreak strikes tighten checks for the rest of the session and notify the trust team once; the student is not paused. (cites: 19 Oct 2026 · Repeated jailbreak strikes: stricter checks and a trust-team notice, no pause)
- The guard chain fails closed on every failure. (cites: 18 Oct 2026 · 4.1 The guard chain fails closed on every failure)
- The lead decides every merge, risky ones included, after the required specialist reviewers, and logs it risk: high; a contracts change also needs an ADR. (cites: 18 Oct 2026 · Merge policy)
- Agents push, main included, only after a clean secret scan; force-push stays blocked. (cites: 18 Oct 2026 · Repo and push policy)
