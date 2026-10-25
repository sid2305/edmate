# Manual WCAG 2.2 AA pass (human follow-up)

Task 13.1 adds an automated axe check (`apps/web/e2e/a11y.spec.ts`) to CI, asserting no
`serious`/`critical` WCAG 2.0 A/AA, 2.1 AA or 2.2 AA violation on the main public, student and
teacher pages. Axe only catches what a static/DOM analysis can see. This checklist hands the
rest — things that need a human, a keyboard, or a screen reader — to a person as a named
follow-up. This task does not do the pass itself.

Do this on the same pages the automated spec covers (`/`, `/sign-in`, `/home` signed in as a
student, `/teacher` signed in as a teacher), plus any page you reach by following a normal user
flow from them.

## Keyboard-only navigation and focus order

- [ ] Tab through the whole page without a mouse. Every interactive control (link, button, form
      field, menu) is reachable, and the order matches the visual reading order.
- [ ] The focus ring is visible at every stop (no control silently swallows focus or hides the
      outline).
- [ ] Opening a modal or menu moves focus into it; closing it returns focus to the control that
      opened it.
- [ ] No keyboard trap: you can always Tab/Shift+Tab (or Escape) back out of any widget.

## Screen reader pass (names, roles, live-region announcements)

Run with VoiceOver (macOS) or NVDA (Windows) — axe can check that a control has an accessible
name, but not that the name makes sense when read aloud, or that dynamic content is announced.

- [ ] Every button/link/field announces a name that makes sense out of context (not just "button"
      or "link").
- [ ] Headings read in a sensible outline (one `h1`, then `h2`/`h3` nested logically — not just
      "no missing levels", but "does this make sense as an outline").
- [ ] Streamed chat replies and turn status (`/home`) are announced as they arrive (a live
      region), not just visually updated.
- [ ] Teacher question/answer status changes (`/teacher`) are announced.

## 200% zoom and reflow

- [ ] Zoom the browser to 200%. Content reflows into a single column where appropriate; nothing
      is clipped, overlapping, or requires horizontal scrolling to read a sentence.
- [ ] Text spacing overrides (line height, paragraph spacing, letter/word spacing) don't break
      layout, per WCAG 1.4.12.

## Color contrast axe can't reach

Axe's contrast check only reaches text against a computed background it can resolve. Check by
eye (or a contrast picker) for:

- [ ] Non-text UI (icon-only buttons, input borders, focus indicators) against its background —
      WCAG 1.4.11 (non-text contrast), not the text contrast rule axe runs.
- [ ] Text over an image or gradient background, and text in a disabled-looking state that is
      still meant to be readable.

## Form error announcements

- [ ] Submitting an invalid form (e.g. sign-in, a teacher package form) announces the error to a
      screen reader at the moment it appears, not only via a visual color change.
- [ ] The error message is associated with its field (so a screen reader user lands on the field
      and hears why).

## Not in this checklist

- The signed-in Lighthouse performance/accessibility score and its own CI job belong to task
  9.1a, a separate follow-up with a different tool and a different accept line — not restated
  here.
- `app/teacher/live-classes/**` has no axe coverage yet (a different builder's in-flight work);
  once it lands, add it to both the automated spec and this manual pass.
