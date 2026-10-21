// The system-prompt composer (build plan § Teaching engine › Prompt packs). Order:
//   safety preamble → skill or mode pack (→ persona) → style card → locale pack → decision block
//   (move, rung, "do not say" list) → retrieved material with sources → learner summary (teaching
//   turns only).
// Optional sections are left out when they have nothing to show. Pure and deterministic.
//
// All prose comes from the pinned prompt-pack set; this file renders only data (ids, numbers,
// helpline lines, numbered sources) into the pack's placeholders. No country fact lives here.
//
// Locked material (ADR-0003): every retrieved chunk is checked against the entitlement before
// anything is rendered; one outside it throws LockedMaterialError, whose message names no text.
import type { AgentConfig, Chunk, Lang, SourceRef, TurnContext } from '@edmate/contracts';
import { personaQuestionsAsked } from './helpState.js';
import { fenced, inline } from './dataText.js';
import { resolveDisclaimer } from './disclaimer.js';
import type { PolicyResult } from './policy.js';
import {
  type ModePackName,
  type PromptPackRef,
  type PromptPackSet,
  renderTemplate,
  type RequiredFrameSection,
  rolePlaySections,
  SKILL_PACKS,
  type SkillPackName,
} from './promptPacks.js';
import { ROLEPLAY_PHASE_SECTION, type RolePlay, type RolePlaySection } from './roleplay.js';

/** A retrieved chunk outside the entitlement reached the composer. Never carries chunk text. */
export class LockedMaterialError extends Error {
  override readonly name = 'LockedMaterialError';
}

/** The set handed in is not the one the agent pins. */
export class PromptPackMismatchError extends Error {
  override readonly name = 'PromptPackMismatchError';
}

export type ComposeMode = ModePackName | SkillPackName;

export interface ComposeInput {
  ctx: TurnContext;
  policy: PolicyResult;
  /** The student's language for this turn (`TurnInput.lang`). */
  lang: Lang;
  /** Must be the set `ctx.agent.promptPackVersion` pins. */
  set: PromptPackSet;
}

export interface Composed {
  systemPrompt: string;
  /** Lines up with the `[n]` numbers in the material section (for the `sources` event). */
  sources: SourceRef[];
  promptPack: PromptPackRef;
  mode: ComposeMode;
  /**
   * True when the pinned agent's `languages` was not exactly `PILOT_LANGUAGES` and the reply
   * language was clamped to English instead (defence in depth; see `PILOT_LANGUAGES`). The
   * runner reports this to the background log by name only; nothing here carries agent content.
   */
  languageClamped: boolean;
}

/**
 * Pilot policy (18 Oct 2026 decision, docs/decisions/log.md): the agent teaches and replies in
 * English only. Named once here (the harness cannot import `@edmate/content`'s own copy of this
 * constant, used by the content-validation side of the same policy).
 */
export const PILOT_LANGUAGES: readonly Lang[] = ['en'];

function isPilotLanguages(languages: readonly Lang[]): boolean {
  return (
    languages.length === PILOT_LANGUAGES.length &&
    languages.every((l, idx) => l === PILOT_LANGUAGES[idx])
  );
}

/**
 * Which pack carries the turn. Distress is told apart by `reason`, so a distressed student never
 * gets the off-topic redirect wording.
 */
export function composeMode(p: Pick<PolicyResult, 'move' | 'reason' | 'skill'>): ComposeMode {
  if (p.reason === 'distress') return 'distress';
  if (p.move === 'redirect') return 'redirect';
  if (p.move === 'locked') return 'locked';
  if (p.move === 'ask_teacher') return 'ask_teacher';
  if (p.reason === 'fallback') return 'fallback';
  const skill = SKILL_PACKS.find((s) => s === p.skill);
  if (skill === undefined) {
    throw new Error(`no prompt pack for move "${p.move}" with skill "${p.skill ?? 'none'}"`);
  }
  return skill;
}

/** Modes that may show the teacher's material. `ask_teacher` keeps it to help with what is covered. */
function showsMaterial(mode: ComposeMode): boolean {
  return mode === 'ask_teacher' || (SKILL_PACKS as readonly string[]).includes(mode);
}

/**
 * The student's language when the agent allows it, else English. Pilot policy
 * (`PILOT_LANGUAGES`): an agent pinned to anything other than English only is clamped to English
 * here regardless of what the student asked for or what the agent config claims to allow; while
 * the pilot holds, `agent.languages` is always `['en']` once it passes the clamp, so English is
 * also the only fallback.
 */
export function replyLanguage(lang: Lang, agent: Pick<AgentConfig, 'languages'>): Lang {
  return isPilotLanguages(agent.languages) && agent.languages.includes(lang) ? lang : 'en';
}

export { DATA_CLOSE, DATA_OPEN } from './dataText.js';

function checkScope(ctx: TurnContext): void {
  const e = ctx.entitlement;
  const allowed = new Set(e.allowedModuleIds);
  ctx.retrieved.forEach((c, i) => {
    if (c.teacherId !== e.teacherId || !allowed.has(c.moduleId)) {
      throw new LockedMaterialError(`retrieved[${String(i)}] is outside the entitlement`);
    }
  });
}

/**
 * The decision block's move line. A feedback turn (always `hint`, rung 0) gets the frame's
 * `move-feedback` line when the set's frame has one (ADR-0012); a frame without it (sets 1.0.0 and
 * 1.1.0) composes exactly as before. Rung 0 is required too, so a feedback turn that ever reaches a
 * higher rung keeps the ladder's own hint line rather than skipping it.
 */
function moveInstruction(p: PolicyResult, f: PromptPackSet['frame']): string {
  const feedback = f['move-feedback'];
  if (p.skill === 'feedback' && p.move === 'hint' && p.rung === 0 && feedback !== undefined) {
    return feedback;
  }
  return f[moveSection(p)];
}

function moveSection(p: PolicyResult): RequiredFrameSection {
  if (p.move === 'hint') return p.rung >= 2 ? 'move-hint-2' : 'move-hint-1';
  return `move-${p.move}` as const;
}

/** The phase's section, filled with the server's numbers only (ADR-0013 §3). */
function rolePlayState(r: RolePlay, s: Readonly<Record<RolePlaySection, string>>): string {
  const text = s[ROLEPLAY_PHASE_SECTION[r.phase]];
  switch (r.phase) {
    case 'question':
    case 'pause':
    case 'resume':
      return renderTemplate(text, {
        question_number: String(r.question),
        question_total: String(r.total),
      });
    case 'debrief':
      return renderTemplate(text, { question_total: String(r.total) });
    case 'stopped':
      return renderTemplate(text, { questions_answered: String(r.answered) });
    case 'ended':
      return text;
  }
}

function materialBlock(chunks: readonly Chunk[]): string {
  return chunks
    .map((c, i) => {
      const s = c.source;
      return `[${String(i + 1)}] ${inline(s.title)} · ${inline(s.locator)} · ${s.kind}\n${fenced(c.text)}`;
    })
    .join('\n\n');
}

export function composeSystemPrompt(i: ComposeInput): Composed {
  const { ctx, policy, set } = i;
  if (set.version !== ctx.agent.promptPackVersion) {
    throw new PromptPackMismatchError(
      `prompt-pack set ${set.version} is not the agent's ${ctx.agent.promptPackVersion}`,
    );
  }
  checkScope(ctx);
  const mode = composeMode(policy);
  const f = set.frame;
  const distress = mode === 'distress';
  const teaching = (SKILL_PACKS as readonly string[]).includes(mode);
  const chunks = showsMaterial(mode) ? ctx.retrieved : [];
  const parts: string[] = [set.packs.safety.body];

  let modeText = set.packs[mode].body;
  if (mode === 'locked') {
    // Only the student's own package name; never a locked module's id, title or text.
    const reply =
      ctx.pkg.lockedReply === 'name_package'
        ? renderTemplate(f['locked-name-package'], { package_name: inline(ctx.pkg.name) })
        : f['locked-generic'];
    modeText = `${modeText}\n\n${reply}`;
  }
  parts.push(modeText);

  // The role-play form (5.8, ADR-0013 §3): a role-play turn is told apart by the policy's reason
  // (or the mock_interview pack), never by `ctx.persona` or the turn's skill, so a closed move on a
  // persona turn (off_topic, not covered, locked) composes its own mode with no role. With the
  // legacy form, nothing below changes.
  const rpSections = rolePlaySections(f);
  const rolePlayTurn =
    rpSections !== undefined && (policy.reason === 'mock_interview' || mode === 'mock_interview');
  let moveLine: string | undefined;
  if (rolePlayTurn) {
    const p = ctx.persona;
    const r = policy.rolePlay;
    // A bug, never a content error: the runner falls back (no persona) when compose throws.
    if (p === undefined || r === undefined) {
      throw new Error("compose: a role-play turn needs a persona and the policy's rolePlay");
    }
    parts.push(
      renderTemplate(f.persona, {
        persona_name: inline(p.name),
        persona_style: fenced(p.style),
        persona_must_not: fenced(p.mustNot.join('; ')),
        roleplay_state: rolePlayState(r, rpSections),
      }),
    );
    moveLine = rpSections['move-roleplay'];
  } else if (mode === 'mock_interview' && ctx.persona !== undefined) {
    // The legacy form (sets 1.0.0 to 1.2.0), byte-identical to before 5.8. It clamps only to
    // [1, max(1, M)], not to PERSONA_QUESTIONS_MAX (ADR-0013 §5): left as it was on purpose.
    const p = ctx.persona;
    parts.push(
      renderTemplate(f.persona, {
        persona_name: inline(p.name),
        persona_style: fenced(p.style),
        persona_must_not: fenced(p.mustNot.join('; ')),
        persona_end_after: String(p.endAfterQuestions),
        // The server's count, already including this turn (3.11d): never the model's own. Shown
        // within [1, M] (3.11e), so "question 0 of M" and "question M+1 of M" never appear.
        questions_asked: String(
          Math.min(
            Math.max(1, personaQuestionsAsked(policy.next.help)),
            Math.max(1, p.endAfterQuestions),
          ),
        ),
      }),
    );
  }

  // A distress reply carries no teaching voice: no style card, no learner summary.
  if (!distress) {
    parts.push(
      renderTemplate(f.style, {
        style_card: fenced(ctx.styleCard.text),
        mistake_tags: ctx.styleCard.mistakeTags.map(inline).join(', '),
      }),
    );
  }

  const helplines = ctx.locale.helplines;
  parts.push(
    renderTemplate(f.locale, {
      reply_language: replyLanguage(i.lang, ctx.agent),
      currency_code: ctx.locale.currency.code,
      currency_format: inline(ctx.locale.currency.format),
      helplines:
        helplines.length === 0
          ? f['no-helplines']
          : helplines
              .map((h) => `- ${inline(h.name)}: ${inline(h.number)} (${inline(h.kind)})`)
              .join('\n'),
    }),
  );

  const subject = ctx.agent.regulatedSubject;
  if (!distress && subject !== undefined) {
    parts.push(
      renderTemplate(f.disclaimer, {
        disclaimer: resolveDisclaimer(subject, ctx.locale, f['generic-disclaimer']),
      }),
    );
  }

  // Distress gets no move name and no skills list: nothing that reads as a lesson.
  parts.push(
    distress
      ? renderTemplate(f['decision-distress'], { move_instruction: f['move-distress'] })
      : renderTemplate(f.decision, {
          move: policy.move,
          rung: String(policy.rung),
          skills: ctx.entitlement.skills.join(', '),
          move_instruction: moveLine ?? moveInstruction(policy, f),
        }),
  );
  // The answer key goes here and nowhere else in the prompt (task 3.6, lead answer Q4), and
  // only on teaching turns: a closed mode (locked, ask_teacher, redirect, distress, fallback)
  // never discusses the problem, so it gets no answer key at all. Only `promptKeys` is rendered,
  // never `mustNotReveal`: a practice key or a carried key never enters the prompt (5.6c,
  // ADR-0011), and the guards get the full `mustNotReveal` on the decision.
  if (teaching && policy.promptKeys.length > 0) {
    parts.push(
      renderTemplate(f['do-not-say'], {
        do_not_say: policy.promptKeys.map((s) => `- ${JSON.stringify(s)}`).join('\n'),
      }),
    );
  }
  if (policy.tools.length > 0) {
    parts.push(renderTemplate(f.tools, { tools: policy.tools.map(inline).join(', ') }));
  }
  if (chunks.length > 0) {
    parts.push(renderTemplate(f.material, { sources: materialBlock(chunks) }));
  }
  // Only on teaching turns, like the answer key (3.11d, ADR-0009): a closed mode (locked,
  // ask_teacher, redirect, distress, fallback) never gets the learner summary, which may name
  // content from before a downgrade or a module lock.
  const summary = ctx.profile.lastSummary;
  if (teaching && summary !== undefined && summary.trim() !== '') {
    parts.push(renderTemplate(f.learner, { last_summary: fenced(summary) }));
  }

  return {
    systemPrompt: parts.join('\n\n'),
    sources: chunks.map((c) => ({ ...c.source })),
    promptPack: {
      set: set.version,
      packs: {
        safety: set.packs.safety.version,
        [mode]: set.packs[mode].version,
        frame: set.packs.frame.version,
      },
    },
    mode,
    languageClamped: !isPilotLanguages(ctx.agent.languages),
  };
}
