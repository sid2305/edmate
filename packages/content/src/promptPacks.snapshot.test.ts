// Snapshot of the composed prompt, from the real on-disk prompt-pack set (tasks 3.11a, 3.11b).
// Loads the reviewed v1.0.0 prose from `content/prompt-packs` and the two persona templates from
// `content/skills/mock_interview`, so any edit to a pack or template shows up here as a
// reviewable snapshot diff (the 3.11 plan, "snapshot tests from 3.6 updated").
//
// `composeSystemPrompt` and `composeMode` are both pure and re-exported from `@edmate/harness`;
// this is content-side proof that the on-disk v1.0.0 shape renders through them, not a change to
// the composer itself (frozen for this task).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Entitlement,
  PackageConfig,
  Persona,
  Skill,
  TurnContext,
  TurnInput,
} from '@edmate/contracts';
import { SkillSchema } from '@edmate/contracts';
import {
  demoChunkScored,
  demoPackageFree,
  localePackMinimal,
  turnContextFull,
} from '@edmate/contracts/fixtures';
import {
  composeSystemPrompt,
  decidePolicy,
  fallbackPolicy,
  type HelpState,
  MODE_PACKS,
  type PolicyResult,
  resolvePromptPackSet,
} from '@edmate/harness';
import { describe, expect, it } from 'vitest';
import { readPersonaTemplateDir } from './personaTemplates.js';
import { readPromptPackLibrary } from './promptPacks.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../..');
const DIR = resolve(REPO_ROOT, 'content/prompt-packs');
const PERSONA_DIR = resolve(REPO_ROOT, 'content/skills/mock_interview');
const SET_VERSION = '1.2.0';

const library = readPromptPackLibrary(DIR);
const set = resolvePromptPackSet(library, SET_VERSION);

const { templates: personaTemplates, issues: personaIssues } = readPersonaTemplateDir(PERSONA_DIR);
if (personaIssues.length > 0) throw new Error(`invalid persona templates:\n${personaIssues.join('\n')}`);

/** Drops the template's own review metadata: `ctx.persona` is `Persona`-shaped, not reviewed. */
function asPersona(t: (typeof personaTemplates)[number]): Persona {
  return {
    id: t.id,
    name: t.name,
    style: t.style,
    mustNot: t.mustNot,
    endAfterQuestions: t.endAfterQuestions,
  };
}

const ALL_SKILLS = SkillSchema.options;

interface CtxOverrides extends Partial<Omit<TurnContext, 'pkg' | 'entitlement'>> {
  pkg?: Partial<PackageConfig>;
  entitlement?: Partial<Entitlement>;
}

/** A schema-valid turn context pinned to this set's version: covered, rung 0, on_task, no persona. */
function ctx(o: CtxOverrides = {}): TurnContext {
  const { pkg, entitlement, ...rest } = o;
  const base: TurnContext = {
    ...turnContextFull,
    agent: { ...turnContextFull.agent, promptPackVersion: SET_VERSION },
  };
  delete base.persona;
  return {
    ...base,
    history: [],
    retrieved: [demoChunkScored],
    lockedHit: false,
    helpRung: 0,
    intent: 'on_task',
    attempt: 'none',
    ...rest,
    pkg: { ...turnContextFull.pkg, ...pkg },
    entitlement: { ...turnContextFull.entitlement, ...entitlement },
  };
}

const help: HelpState = {
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  lockedStopped: false,
  answerKey: ['5/6'],
};

function turnOf(
  kind: TurnInput['kind'] = 'message',
  skill?: Skill,
): Pick<TurnInput, 'kind' | 'skill'> {
  return skill === undefined ? { kind } : { kind, skill };
}

interface Case {
  name: string;
  covers: string;
  mode: string;
  ctx: TurnContext;
  policy: PolicyResult;
}

function skillCase(skill: (typeof ALL_SKILLS)[number]): Case {
  const c = ctx({
    entitlement: { skills: [...ALL_SKILLS] },
    ...(skill === 'mock_interview' ? { persona: asPersona(personaTemplates[0]!) } : {}),
  });
  return {
    name: `skill ${skill}`,
    covers: skill,
    mode: skill === 'study_plan' ? 'redirect' : skill,
    ctx: c,
    policy: decidePolicy({
      ctx: c,
      turn: turnOf('skill_action', skill),
      help,
    }),
  };
}

function rungCase(rung: 0 | 1 | 2 | 3 | 4): Case {
  const c = ctx({
    entitlement: { skills: [...ALL_SKILLS] },
    helpRung: rung === 0 ? 0 : ((rung - 1) as 0 | 1 | 2 | 3),
  });
  const h: HelpState = { ...help, attemptLogged: true };
  return {
    name: `coach rung ${String(rung)}`,
    covers: 'coach',
    mode: 'coach',
    ctx: c,
    policy: decidePolicy({
      ctx: c,
      turn: turnOf(rung === 0 ? 'message' : 'hint_request'),
      help: h,
    }),
  };
}

function modeCase(name: string, mode: string, c: TurnContext, p: PolicyResult): Case {
  return { name, covers: mode, mode, ctx: c, policy: p };
}

const notCovered = ctx({
  entitlement: { skills: [...ALL_SKILLS] },
  retrieved: [{ ...demoChunkScored, score: 0.1 }],
});
const lockedGenericCtx = ctx({
  entitlement: { skills: [...ALL_SKILLS] },
  retrieved: [],
  lockedHit: true,
});
const lockedNamePackageCtx = ctx({
  entitlement: { skills: [...ALL_SKILLS] },
  retrieved: [],
  lockedHit: true,
  pkg: { ...demoPackageFree, lockedReply: 'name_package' },
});
const offTopic = ctx({ entitlement: { skills: [...ALL_SKILLS] }, intent: 'off_topic' });
const distress = ctx({ entitlement: { skills: [...ALL_SKILLS] }, intent: 'distress' });
// A distressed student mid mock-interview: the persona must disappear from the prompt entirely
// (3.11 lead answer, item 8).
const distressWithPersona = ctx({
  entitlement: { skills: [...ALL_SKILLS] },
  intent: 'distress',
  persona: asPersona(personaTemplates[1] ?? personaTemplates[0]!),
});

// Regulated-subject cases: the locale either has a disclaimer for the agent's `regulatedSubject`
// or falls back to the frame's generic one (3.11 lead answer, item 8: "investing with and without
// a market disclaimer").
const regulatedAgent = {
  ...turnContextFull.agent,
  promptPackVersion: SET_VERSION,
  regulatedSubject: 'investing' as const,
};
const investingWithDisclaimer: TurnContext = {
  ...ctx({ entitlement: { skills: [...ALL_SKILLS] } }),
  agent: regulatedAgent,
};
const investingNoDisclaimer: TurnContext = {
  ...ctx({ entitlement: { skills: [...ALL_SKILLS] } }),
  agent: regulatedAgent,
  locale: localePackMinimal,
};

const CASES: Case[] = [
  ...ALL_SKILLS.map(skillCase),
  ...([0, 1, 2, 3, 4] as const).map(rungCase),
  modeCase(
    'mode locked (generic reply)',
    'locked',
    lockedGenericCtx,
    decidePolicy({ ctx: lockedGenericCtx, turn: turnOf(), help }),
  ),
  modeCase(
    'mode locked (name_package reply)',
    'locked',
    lockedNamePackageCtx,
    decidePolicy({ ctx: lockedNamePackageCtx, turn: turnOf(), help }),
  ),
  modeCase(
    'mode ask_teacher',
    'ask_teacher',
    notCovered,
    decidePolicy({ ctx: notCovered, turn: turnOf(), help }),
  ),
  modeCase(
    'mode redirect (off_topic)',
    'redirect',
    offTopic,
    decidePolicy({ ctx: offTopic, turn: turnOf(), help }),
  ),
  modeCase('mode distress', 'distress', distress, decidePolicy({ ctx: distress, turn: turnOf(), help })),
  modeCase(
    'mode distress (mid mock-interview, persona set)',
    'distress',
    distressWithPersona,
    decidePolicy({ ctx: distressWithPersona, turn: turnOf(), help }),
  ),
  modeCase(
    'mode fallback',
    'fallback',
    { ...ctx(), retrieved: [] },
    fallbackPolicy(ctx(), help),
  ),
  modeCase(
    'investing with a market disclaimer',
    'coach',
    investingWithDisclaimer,
    decidePolicy({
      ctx: investingWithDisclaimer,
      turn: turnOf('skill_action', 'coach'),
      help,
    }),
  ),
  modeCase(
    'investing without a market disclaimer (falls back to generic)',
    'coach',
    investingNoDisclaimer,
    decidePolicy({
      ctx: investingNoDisclaimer,
      turn: turnOf('skill_action', 'coach'),
      help,
    }),
  ),
  ...personaTemplates.map(
    (t): Case =>
      modeCase(
        `mock_interview with persona template "${t.name}"`,
        'mock_interview',
        ctx({ entitlement: { skills: [...ALL_SKILLS] }, persona: asPersona(t) }),
        decidePolicy({
          ctx: ctx({ entitlement: { skills: [...ALL_SKILLS] }, persona: asPersona(t) }),
          turn: turnOf('skill_action', 'mock_interview'),
          help,
        }),
      ),
  ),
];

/** Compares two `x.y.z` versions numerically; prerelease tags are not used in real sets. */
function versionAbove(v: string, floor: string): boolean {
  const a = v.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

describe('feedback move line in real sets (ADR-0012)', () => {
  it('every set whose feedback pack is newer than 1.0.0 has move-feedback', () => {
    const newer = [...library.values()].filter((s) =>
      versionAbove(s.packs.feedback.version, '1.0.0'),
    );
    expect(newer.map((s) => s.version)).toContain(SET_VERSION);
    for (const s of newer) {
      expect(s.frame['move-feedback'], `set ${s.version}`).toMatch(/^\[\[MOVE-FEEDBACK\]\] /);
    }
  });

  it('a feedback turn on this set uses move-feedback, not hint-1, and keeps no-execution', () => {
    const c = skillCase('feedback');
    const r = composeSystemPrompt({ ctx: c.ctx, policy: c.policy, lang: 'en', set });
    expect(r.systemPrompt).toContain('[[MOVE-FEEDBACK]]');
    expect(r.systemPrompt).not.toContain('[[MOVE-HINT-1]]');
    expect(r.systemPrompt).toContain('Never run, execute, trace or step through it');
  });

  it('sets 1.0.0 and 1.1.0 keep the old frame and feedback pack', () => {
    for (const v of ['1.0.0', '1.1.0']) {
      const old = resolvePromptPackSet(library, v);
      expect(old.packs.feedback.version).toBe('1.0.0');
      expect(old.frame['move-feedback']).toBeUndefined();
    }
  });

  it('versionAbove compares numerically', () => {
    expect(versionAbove('1.10.0', '1.9.0')).toBe(true);
    expect(versionAbove('1.0.0', '1.0.0')).toBe(false);
    expect(versionAbove('0.9.9', '1.0.0')).toBe(false);
  });
});

describe('on-disk prompt-pack set: composed-prompt snapshots', () => {
  it('loads with no issues and exposes set 1.2.0', () => {
    expect(set.version).toBe(SET_VERSION);
  });

  it('loads exactly the two persona templates, both valid', () => {
    expect(personaTemplates).toHaveLength(2);
  });

  it('cover every skill and every mode', () => {
    const covered = new Set(CASES.map((c) => c.covers));
    for (const s of ALL_SKILLS) expect(covered, s).toContain(s);
    for (const m of MODE_PACKS) expect(covered, m).toContain(m);
  });

  it('case names are unique', () => {
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = composeSystemPrompt({ ctx: c.ctx, policy: c.policy, lang: 'en', set });
    expect(r.mode).toBe(c.mode);
    expect({
      move: c.policy.move,
      rung: c.policy.rung,
      mode: r.mode,
      sources: r.sources,
    }).toMatchSnapshot('meta');
    expect(r.systemPrompt).toMatchSnapshot('systemPrompt');
  });
});
