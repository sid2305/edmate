// Snapshot of the composed prompt, from a real-on-disk prompt-pack set (task 3.11a). Runs
// against the v1.0.0-shaped fixture set checked into this package's own test fixtures now; 3.11b
// points `DIR` at `content/prompt-packs` once the real pack prose lands (its own PR keeps this
// file's snapshot, updating it only where the real prose changes the composed prompt — see the
// 3.11 plan, "snapshot tests from 3.6 updated").
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
const DIR = resolve(here, '../test/fixtures/prompt-packs/v1');
const PERSONA_DIR = resolve(here, '../test/fixtures/skills/mock_interview/valid');
const SET_VERSION = '1.0.0';

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

describe('on-disk prompt-pack set: composed-prompt snapshots', () => {
  it('loads with no issues and exposes set 1.0.0', () => {
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
