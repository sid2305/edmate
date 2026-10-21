# 1.7f handoff: sign the US locale pack

Status: **DONE**

Branch: `m1/1.7f-sign-us-locale` (pushed from local `work-1.7f`)
Worktree: this task's agent worktree (`.claude/worktrees/agent-a7d486d17e5ab7ffa`)

## Spec (board `1.7f`)
Sign `content/locales/US.yaml` (`reviewedBy: sid2305`, `reviewedOn: "2026-10-21"`), keeping
`privacyLaw` / `dataRegion` / `grievance` pending for counsel (task 3.10c). Update
`packages/content/src/realLocales.test.ts` so the US pack counts as signed and the no-consent
waiver applies to US learners 13-17, while IN and global still return `parent_needed`
(`consentRequired: true`). No other behaviour change. The human already signed (answer B-27,
21 Oct 2026); no further sign-off is asked.

## Changes
- `content/locales/US.yaml`: `reviewedBy: pending` → `reviewedBy: sid2305`; `reviewedOn` →
  `"2026-10-21"`. `privacyLaw`, `dataRegion`, `grievance` and `parentalConsentRequired: false`
  left untouched.
- `packages/content/src/realLocales.test.ts`: the "age rule per market" describe block now
  asserts the US pack is signed (`reviewedBy: 'sid2305'`), that `checkLocalePacks` no longer flags
  `reviewedBy` pending (only the three still-pending compliance text fields), that
  `agePolicyResolver` returns `{ minAge: 13, consentRequired: false }` for US and
  `{ minAge: 13, consentRequired: true }` for IN/global/unknown, and that an unsigned copy of the
  US pack (`reviewedBy: 'pending'`) still fails closed.

No change to `packages/content/src/agePolicy.ts` or any other source: `agePolicyFor` already
derives the waiver from `complianceSigned(pack)` (`reviewedBy` set and not `pending`), so signing
the YAML file alone flips the test's expected policy — the age-rule code needed no change, only
the fixture and the test's expectations.

## Acceptance evidence

```
$ cat content/locales/US.yaml | grep reviewed
reviewedBy: sid2305
reviewedOn: "2026-10-21"
```

```
$ export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH
$ corepack pnpm install        # up to date, no changes
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/content...
...
@edmate/content:test:  ✓ src/realLocales.test.ts (14 tests) 115ms
@edmate/content:test:  Test Files  23 passed (23)
@edmate/content:test:       Tests  375 passed (375)
 Tasks:    14 successful, 14 total
```

Coverage (from the same run, `@edmate/content`): 99.33% statements / 95.35% branch / 100% funcs /
99.86% lines — all above the 80% floor; `agePolicy.ts` is 100% across the board.

```
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

## Decisions

### 21 Oct 2026 · 1.7f US locale pack signed by the human (B-27) · decided by human (sid2305) · risk: high

- Decided: the US pack's compliance block is signed (`reviewedBy: sid2305`, `reviewedOn:
  2026-10-21`); its parental-consent waiver (board decision `min-age`, 18 Oct 2026) now applies to
  US learners aged 13-17. `privacyLaw`, `dataRegion` and `grievance` stay `pending` until counsel
  fills them in (task 3.10c); the US pack still has no helplines.
- Why: the US is the first and only pilot region (India is parked); the human reviewed and signed
  off on the age/consent rule for US learners so the platform can launch without a parent-consent
  gate blocking every US signup. The pack still fails closed on everything counsel has not yet
  reviewed.
- risk: high
