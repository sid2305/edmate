// Prompt packs (build plan § Teaching engine › Prompt packs): the platform's system-prompt text,
// versioned as a set. `AgentConfig.promptPackVersion` pins one set; each pack in it keeps its own
// semver, listed by the set's manifest (task 3.6, lead answer Q2).
//
// Pure: the harness receives already-read packs (the file loader lives in @edmate/content) and
// validates them here, so a bad pack fails at load time, never mid-turn. All prose comes from
// packs; code renders only data into the fixed `{{placeholder}}` slots each template allows.
import { AgentConfigSchema } from '@edmate/contracts';
import { z } from 'zod';
import { FrozenMap } from './frozenMap.js';
import type { RolePlaySection } from './roleplay.js';

/** One pack per MVP skill. `study_plan` (P1) has none: the policy sends it to `redirect`. */
export const SKILL_PACKS = [
  'explain',
  'coach',
  'practice',
  'feedback',
  'mock_interview',
  'revision',
] as const;
export type SkillPackName = (typeof SKILL_PACKS)[number];

/** Packs for the moves that replace teaching, plus distress wording and the `ask` fallback. */
export const MODE_PACKS = ['locked', 'ask_teacher', 'redirect', 'distress', 'fallback'] as const;
export type ModePackName = (typeof MODE_PACKS)[number];

export const REQUIRED_PACKS = ['safety', ...SKILL_PACKS, ...MODE_PACKS, 'frame'] as const;
export type PackName = (typeof REQUIRED_PACKS)[number];

export const PACK_KINDS = ['safety', 'skill', 'mode', 'frame'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export function packKindOf(name: PackName): PackKind {
  if (name === 'safety' || name === 'frame') return name;
  return (SKILL_PACKS as readonly string[]).includes(name) ? 'skill' : 'mode';
}

export interface Slots {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

const NONE: Slots = Object.freeze({ required: [], optional: [] });
const slots = (required: string[], optional: string[] = []): Slots =>
  Object.freeze({ required: Object.freeze(required), optional: Object.freeze(optional) });

/**
 * The frame pack's `## sections` and the placeholders each may use. Every section is required
 * except those in `OPTIONAL_FRAME_SECTIONS`; an unknown one is an error, so a typo never silently
 * drops text.
 */
export const FRAME_SECTIONS = Object.freeze({
  style: slots(['style_card'], ['mistake_tags']),
  locale: slots(['reply_language', 'currency_code', 'currency_format', 'helplines']),
  disclaimer: slots(['disclaimer']),
  'generic-disclaimer': NONE,
  'no-helplines': NONE,
  decision: slots(['move', 'rung', 'move_instruction', 'skills']),
  /** Distress: no move name and no skills list, only the caring instruction. */
  'decision-distress': slots(['move_instruction']),
  'do-not-say': slots(['do_not_say']),
  tools: slots(['tools']),
  material: slots(['sources']),
  learner: slots(['last_summary']),
  /**
   * Two forms (5.8, ADR-0013 §3), checked across the frame by `checkPersonaForm`: the legacy form
   * takes the server's count (`questions_asked` of `persona_end_after`, 3.11d, ADR-0009); the
   * role-play form takes `roleplay_state` (the phase's section, filled by the server).
   */
  persona: slots(
    ['persona_name', 'persona_style', 'persona_must_not'],
    ['persona_end_after', 'questions_asked', 'roleplay_state'],
  ),
  'teacher-label': NONE,
  'empty-turn': slots([], ['kind']),
  'locked-name-package': slots(['package_name']),
  'locked-generic': NONE,
  'move-ask': NONE,
  'move-hint-1': NONE,
  'move-hint-2': NONE,
  'move-worked_example': NONE,
  'move-explain': NONE,
  'move-solution': NONE,
  'move-check': NONE,
  'move-redirect': NONE,
  'move-locked': NONE,
  'move-ask_teacher': NONE,
  'move-distress': NONE,
  /** Feedback turns' move line (ADR-0012). Optional: frames before 1.1.0 leave it out. */
  'move-feedback': NONE,
  // The role-play sections (5.8, ADR-0013 §3): optional, all or none, and only with the
  // persona section's role-play form. Every slot is a number the server works out.
  'move-roleplay': NONE,
  'roleplay-question': slots(['question_number', 'question_total']),
  'roleplay-pause': slots(['question_number', 'question_total']),
  'roleplay-resume': slots(['question_number', 'question_total']),
  'roleplay-debrief': slots(['question_total']),
  'roleplay-stopped': slots(['questions_answered']),
  'roleplay-ended': NONE,
} satisfies Record<string, Slots>);
export type FrameSection = keyof typeof FRAME_SECTIONS;

/** The seven role-play sections (5.8, ADR-0013 §3), in frame order. All or none. */
export const ROLEPLAY_SECTIONS = Object.freeze([
  'move-roleplay',
  'roleplay-question',
  'roleplay-pause',
  'roleplay-resume',
  'roleplay-debrief',
  'roleplay-stopped',
  'roleplay-ended',
] as const satisfies readonly RolePlaySection[]);

// Compile-time guard: ROLEPLAY_SECTIONS lists every RolePlaySection.
type MissingRolePlaySection = Exclude<RolePlaySection, (typeof ROLEPLAY_SECTIONS)[number]>;
const _allRolePlaySections: [MissingRolePlaySection] extends [never] ? true : never = true;
void _allRolePlaySections;

/**
 * The only frame sections a frame may leave out: `move-feedback` on its own (ADR-0012) and the
 * role-play group (ADR-0013). When present, each is checked like every other section: not empty,
 * and only its allowed placeholders.
 */
export const OPTIONAL_FRAME_SECTIONS = Object.freeze([
  'move-feedback',
  ...ROLEPLAY_SECTIONS,
] as const);
export type OptionalFrameSection = (typeof OPTIONAL_FRAME_SECTIONS)[number];
/** Every frame section a set must have (all but `OPTIONAL_FRAME_SECTIONS`). */
export type RequiredFrameSection = Exclude<FrameSection, OptionalFrameSection>;

function isOptionalSection(name: string): boolean {
  return (OPTIONAL_FRAME_SECTIONS as readonly string[]).includes(name);
}

export interface PromptPack {
  readonly name: PackName;
  readonly version: string;
  readonly kind: PackKind;
  /** The named human who signed the pack off (build plan rule 7); `fixture` in tests. */
  readonly reviewedBy: string;
  readonly body: string;
}

export interface PromptPackSet {
  /** The set's semver: what `AgentConfig.promptPackVersion` pins. */
  readonly version: string;
  readonly reviewedBy: string;
  readonly packs: Readonly<Record<PackName, PromptPack>>;
  /** The frame pack's body split into its sections (trimmed); optional ones may be absent. */
  readonly frame: Readonly<
    Record<RequiredFrameSection, string> & Partial<Record<OptionalFrameSection, string>>
  >;
}

/** Set version → set. Built once by the composition root and passed in as `deps.promptPacks`. */
export type PromptPackLibrary = ReadonlyMap<string, PromptPackSet>;

/** Which set and which pack versions a composed prompt used (for CommitRecord, lead answer Q1). */
export interface PromptPackRef {
  set: string;
  packs: Record<string, string>;
}

const SemverSchema = AgentConfigSchema.shape.promptPackVersion;

const RawPackSchema = z.strictObject({
  version: SemverSchema,
  kind: z.enum(PACK_KINDS),
  reviewedBy: z.string().min(1),
  body: z.string(),
});
const RawSetSchema = z.strictObject({
  version: SemverSchema,
  reviewedBy: z.string().min(1),
  packs: z.record(z.string(), z.unknown()),
});

/** What a loader hands in: the manifest plus each pack's front matter and body, by name. */
export interface RawPromptPackSet {
  version: string;
  reviewedBy: string;
  packs: Record<string, z.input<typeof RawPackSchema>>;
}

export interface PromptPackIssue {
  /** Dotted path, for example `packs.frame.locale`; empty for the whole value. */
  path: string;
  message: string;
}

export class PromptPackError extends Error {
  override readonly name = 'PromptPackError';

  constructor(readonly issues: readonly PromptPackIssue[]) {
    super(`invalid prompt-pack set:\n${issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`);
  }
}

export class UnknownPromptPackVersionError extends Error {
  override readonly name = 'UnknownPromptPackVersionError';
}

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const SLOT_NAME = /^[a-z_]+$/;
const SECTION_LINE = /^## (\S+)[ \t]*$/;

/** The names between `{{` and `}}`, in order, untrimmed. */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
}

/**
 * Fills each `{{name}}` in one pass: inserted values are never scanned again, so data that holds
 * `{{...}}` or `$&` stays literal. A placeholder with no value throws (load-time validation makes
 * that a bug, never a turn-time content error).
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const v = Object.hasOwn(values, name) ? values[name] : undefined;
    if (v === undefined) throw new Error(`no value for placeholder {{${name}}}`);
    return v;
  });
}

function checkSlots(template: string, allowed: Slots, path: string, out: PromptPackIssue[]): void {
  const found = placeholdersOf(template);
  const ok = new Set([...allowed.required, ...allowed.optional]);
  for (const name of new Set(found)) {
    if (!SLOT_NAME.test(name) || !ok.has(name)) {
      out.push({ path, message: `unknown placeholder {{${name}}}` });
    }
  }
  for (const name of allowed.required) {
    if (!found.includes(name)) {
      out.push({ path, message: `missing required placeholder {{${name}}}` });
    }
  }
}

/** The legacy persona form's count slots (3.11d); the role-play form has neither. */
const COUNT_SLOTS = ['persona_end_after', 'questions_asked'] as const;

/**
 * The frame uses exactly one persona form (ADR-0013 §3). Legacy: both count slots, no
 * `roleplay_state` and none of the role-play sections. Role-play: `roleplay_state`, neither count
 * slot and all seven sections. Every missing or extra item is reported.
 */
function checkPersonaForm(sections: Readonly<Record<string, string>>, out: PromptPackIssue[]) {
  const persona = sections.persona;
  if (persona === undefined) return; // reported as a missing section
  const found = new Set(placeholdersOf(persona));
  if (found.has('roleplay_state')) {
    for (const slot of COUNT_SLOTS) {
      if (found.has(slot)) {
        out.push({
          path: 'packs.frame.persona',
          message: `{{${slot}}} is not allowed with {{roleplay_state}}`,
        });
      }
    }
    for (const name of ROLEPLAY_SECTIONS) {
      if (!Object.hasOwn(sections, name)) {
        out.push({
          path: `packs.frame.${name}`,
          message: 'missing section (the persona section uses {{roleplay_state}})',
        });
      }
    }
    return;
  }
  for (const slot of COUNT_SLOTS) {
    if (!found.has(slot)) {
      out.push({
        path: 'packs.frame.persona',
        message: `missing {{${slot}}} (the legacy form needs both count slots)`,
      });
    }
  }
  for (const name of ROLEPLAY_SECTIONS) {
    if (Object.hasOwn(sections, name)) {
      out.push({
        path: `packs.frame.${name}`,
        message: 'not allowed without {{roleplay_state}} in the persona section',
      });
    }
  }
}

/**
 * The role-play sections as a group: all seven, or `undefined` (a legacy frame). `parsePromptPackSet`
 * guarantees a loaded frame has all or none, so a caller never handles one missing on its own.
 */
export function rolePlaySections(
  frame: PromptPackSet['frame'],
): Readonly<Record<RolePlaySection, string>> | undefined {
  const out: Partial<Record<RolePlaySection, string>> = {};
  for (const name of ROLEPLAY_SECTIONS) {
    const text = frame[name];
    if (text === undefined) return undefined;
    out[name] = text;
  }
  return Object.freeze(out as Record<RolePlaySection, string>);
}

function parseFrame(body: string, out: PromptPackIssue[]): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let lines: string[] = [];
  const close = () => {
    if (current === null) {
      if (lines.join('').trim() !== '') {
        out.push({ path: 'packs.frame', message: 'text before the first section' });
      }
      return;
    }
    const path = `packs.frame.${current}`;
    if (!Object.hasOwn(FRAME_SECTIONS, current)) {
      out.push({ path, message: 'unknown section' });
    } else if (Object.hasOwn(sections, current)) {
      out.push({ path, message: 'duplicate section' });
    } else {
      const text = lines.join('\n').trim();
      if (text === '') out.push({ path, message: 'empty' });
      else checkSlots(text, FRAME_SECTIONS[current as FrameSection], path, out);
      sections[current] = text;
    }
  };
  for (const line of body.split('\n')) {
    const m = SECTION_LINE.exec(line);
    if (m === null) {
      lines.push(line);
      continue;
    }
    close();
    current = m[1] as string;
    lines = [];
  }
  close();
  for (const name of Object.keys(FRAME_SECTIONS)) {
    if (!Object.hasOwn(sections, name) && !isOptionalSection(name)) {
      out.push({ path: `packs.frame.${name}`, message: 'missing section' });
    }
  }
  checkPersonaForm(sections, out);
  return sections;
}

function zodIssues(error: z.ZodError, prefix: string): PromptPackIssue[] {
  return error.issues.map((i) => ({
    path: [prefix, ...i.path.map(String)].filter((p) => p !== '').join('.'),
    message: i.message,
  }));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Validates a whole set and collects every issue; throws PromptPackError if there is any. */
export function parsePromptPackSet(raw: unknown): PromptPackSet {
  const issues: PromptPackIssue[] = [];
  const top = RawSetSchema.safeParse(raw);
  if (!top.success) throw new PromptPackError(zodIssues(top.error, ''));

  const packs: Partial<Record<PackName, PromptPack>> = {};
  let frame: Record<string, string> = {};
  for (const [name, value] of Object.entries(top.data.packs)) {
    const path = `packs.${name}`;
    if (!(REQUIRED_PACKS as readonly string[]).includes(name)) {
      issues.push({ path, message: 'unknown pack' });
      continue;
    }
    const p = RawPackSchema.safeParse(value);
    if (!p.success) {
      issues.push(...zodIssues(p.error, path));
      continue;
    }
    const packName = name as PackName;
    const kind = packKindOf(packName);
    if (p.data.kind !== kind) {
      issues.push({ path: `${path}.kind`, message: `must be "${kind}", got "${p.data.kind}"` });
    }
    const body = p.data.body.trim();
    if (body === '') issues.push({ path: `${path}.body`, message: 'empty' });
    else if (kind === 'frame') frame = parseFrame(body, issues);
    else checkSlots(body, NONE, `${path}.body`, issues);
    packs[packName] = {
      name: packName,
      version: p.data.version,
      kind,
      reviewedBy: p.data.reviewedBy,
      body,
    };
  }
  for (const name of REQUIRED_PACKS) {
    if (!Object.hasOwn(top.data.packs, name)) {
      issues.push({ path: `packs.${name}`, message: 'missing required pack' });
    }
  }
  if (issues.length > 0) {
    // Stable sort by path, so the report never depends on which check ran first.
    throw new PromptPackError(
      issues.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    );
  }
  return deepFreeze({
    version: top.data.version,
    reviewedBy: top.data.reviewedBy,
    packs: packs as Record<PackName, PromptPack>,
    frame: frame as PromptPackSet['frame'],
  });
}

/**
 * Indexes sets by version. Two sets whose versions differ only in build metadata (`+...`) count
 * as the same version (semver precedence ignores build metadata), so they are a duplicate too.
 */
export function createPromptPackLibrary(sets: readonly PromptPackSet[]): PromptPackLibrary {
  const seen = new Set<string>();
  for (const s of sets) {
    const key = s.version.replace(/\+.*$/, '');
    if (seen.has(key)) throw new Error(`duplicate prompt-pack set version ${s.version}`);
    seen.add(key);
  }
  return new FrozenMap(
    sets.map((s) => [s.version, s] as const),
    'the prompt-pack library',
  );
}

/** The set an agent pins, exactly; an unknown version throws (the turn never reaches a model). */
export function resolvePromptPackSet(lib: PromptPackLibrary, version: string): PromptPackSet {
  const set = lib.get(version);
  if (set === undefined) throw new UnknownPromptPackVersionError(`no prompt-pack set ${version}`);
  return set;
}
