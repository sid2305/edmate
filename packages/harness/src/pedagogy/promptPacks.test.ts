import { describe, expect, it } from 'vitest';
import {
  fixturePromptPackRaw,
  fixturePromptPackSet,
  FIXTURE_PROMPT_PACK_VERSION,
} from '../testing/promptPackFixtures.js';
import {
  createPromptPackLibrary,
  FRAME_SECTIONS,
  MODE_PACKS,
  packKindOf,
  parsePromptPackSet,
  placeholdersOf,
  PromptPackError,
  type RawPromptPackSet,
  renderTemplate,
  REQUIRED_PACKS,
  resolvePromptPackSet,
  SKILL_PACKS,
  UnknownPromptPackVersionError,
} from './promptPacks.js';

/** A deep copy of plain JSON data (the harness has no DOM or Node globals). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function raw(): RawPromptPackSet {
  return clone(fixturePromptPackRaw);
}

function issuesOf(value: unknown): string[] {
  try {
    parsePromptPackSet(value);
  } catch (e) {
    expect(e).toBeInstanceOf(PromptPackError);
    return (e as PromptPackError).issues.map((i) => `${i.path}: ${i.message}`);
  }
  throw new Error('expected parsePromptPackSet to throw');
}

function withFrame(edit: (body: string) => string): RawPromptPackSet {
  const r = raw();
  const frame = r.packs.frame;
  if (frame === undefined) throw new Error('fixture has no frame');
  frame.body = edit(frame.body);
  return r;
}

describe('pack names', () => {
  it('requires safety, one pack per MVP skill, every mode and the frame', () => {
    expect(REQUIRED_PACKS).toEqual([
      'safety',
      'explain',
      'coach',
      'practice',
      'feedback',
      'mock_interview',
      'revision',
      'locked',
      'ask_teacher',
      'redirect',
      'distress',
      'fallback',
      'frame',
    ]);
    expect(SKILL_PACKS).not.toContain('study_plan');
  });

  it('knows each pack kind', () => {
    expect(packKindOf('safety')).toBe('safety');
    expect(packKindOf('frame')).toBe('frame');
    for (const s of SKILL_PACKS) expect(packKindOf(s)).toBe('skill');
    for (const m of MODE_PACKS) expect(packKindOf(m)).toBe('mode');
  });
});

describe('parsePromptPackSet', () => {
  it('parses the fixture set into frozen packs and frame sections', () => {
    const set = parsePromptPackSet(raw());
    expect(set.version).toBe(FIXTURE_PROMPT_PACK_VERSION);
    expect(Object.keys(set.packs).sort()).toEqual([...REQUIRED_PACKS].sort());
    expect(Object.keys(set.frame).sort()).toEqual(Object.keys(FRAME_SECTIONS).sort());
    expect(set.packs.coach).toMatchObject({ name: 'coach', kind: 'skill', version: '0.1.0' });
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.packs.coach)).toBe(true);
    expect(Object.isFrozen(set.frame)).toBe(true);
    expect(set).toEqual(fixturePromptPackSet);
  });

  it('trims bodies and frame sections', () => {
    const r = raw();
    const safety = r.packs.safety;
    if (safety === undefined) throw new Error('no safety');
    safety.body = `\n\n  ${safety.body}  \n`;
    expect(parsePromptPackSet(r).packs.safety.body).toBe(fixturePromptPackSet.packs.safety.body);
  });

  it('collects every issue instead of stopping at the first', () => {
    const r = raw();
    delete r.packs.coach;
    delete r.packs.distress;
    expect(issuesOf(r)).toEqual([
      'packs.coach: missing required pack',
      'packs.distress: missing required pack',
    ]);
  });

  it('rejects a value that is not a set', () => {
    expect(issuesOf(null)[0]).toMatch(/^: /);
    expect(issuesOf({ ...raw(), version: 'latest' })).toEqual([
      expect.stringMatching(/^version: /),
    ]);
    expect(issuesOf({ ...raw(), extra: 1 }).length).toBe(1);
  });

  it('rejects a pack with bad semver, an empty body, an empty reviewer or the wrong kind', () => {
    const r = raw();
    const p = r.packs;
    if (!p.coach || !p.explain || !p.locked || !p.practice) throw new Error('fixture');
    p.coach.version = '1.0';
    p.explain.body = '   ';
    p.locked.kind = 'skill';
    p.practice.reviewedBy = '';
    // Sorted by path, so the order never depends on which check found the issue.
    expect(issuesOf(r)).toEqual([
      expect.stringMatching(/^packs\.coach\.version: /),
      'packs.explain.body: empty',
      'packs.locked.kind: must be "mode", got "skill"',
      expect.stringMatching(/^packs\.practice\.reviewedBy: /),
    ]);
  });

  it('rejects an unknown pack name', () => {
    const r = raw();
    const coach = r.packs.coach;
    if (coach === undefined) throw new Error('fixture');
    r.packs.study_plan = { ...coach };
    expect(issuesOf(r)).toEqual(['packs.study_plan: unknown pack']);
  });

  it('rejects an unknown placeholder in a pack and in a frame section', () => {
    const r = withFrame((b) => b.replace('{{move}}', '{{move}} {{student_name}}'));
    const coach = r.packs.coach;
    if (coach === undefined) throw new Error('fixture');
    coach.body += ' {{answer}}';
    expect(issuesOf(r)).toEqual([
      'packs.coach.body: unknown placeholder {{answer}}',
      'packs.frame.decision: unknown placeholder {{student_name}}',
    ]);
  });

  it('rejects a malformed placeholder', () => {
    const r = withFrame((b) => b.replace('{{move}}', '{{ Move }}'));
    expect(issuesOf(r)).toEqual([
      'packs.frame.decision: unknown placeholder {{ Move }}',
      'packs.frame.decision: missing required placeholder {{move}}',
    ]);
  });

  it('rejects a frame section missing a required placeholder', () => {
    const r = withFrame((b) => b.replace('{{helplines}}', ''));
    expect(issuesOf(r)).toEqual(['packs.frame.locale: missing required placeholder {{helplines}}']);
  });

  it('allows an optional placeholder to be absent', () => {
    const r = withFrame((b) => b.replace('{{mistake_tags}}', ''));
    expect(parsePromptPackSet(r).frame.style).not.toContain('{{mistake_tags}}');
  });

  it('rejects a missing, unknown, duplicate or empty frame section, and text before the first', () => {
    const missing = withFrame((b) => b.replace(/## tools\n[^#]*/, ''));
    expect(issuesOf(missing)).toEqual(['packs.frame.tools: missing section']);

    const unknown = withFrame((b) => `${b}\n## epilogue\nhello`);
    expect(issuesOf(unknown)).toEqual(['packs.frame.epilogue: unknown section']);

    const dup = withFrame((b) => `${b}\n## tools\n[[TOOLS2]] {{tools}}`);
    expect(issuesOf(dup)).toEqual(['packs.frame.tools: duplicate section']);

    const empty = withFrame((b) => b.replace(/## locked-generic\n[^#]*/, '## locked-generic\n\n'));
    expect(issuesOf(empty)).toEqual(['packs.frame.locked-generic: empty']);

    const before = withFrame((b) => `stray text\n${b}`);
    expect(issuesOf(before)).toEqual(['packs.frame: text before the first section']);
  });

  it('does not treat a `##` inside a line as a section', () => {
    const r = withFrame((b) => b.replace('[[TOOLS]]', '[[TOOLS]] a ## b'));
    expect(parsePromptPackSet(r).frame.tools).toContain('a ## b');
  });
});

describe('createPromptPackLibrary', () => {
  const v2 = parsePromptPackSet({ ...raw(), version: '0.2.0-fixture' });

  it('maps each set version to its set, frozen', () => {
    const lib = createPromptPackLibrary([fixturePromptPackSet, v2]);
    expect([...lib.keys()]).toEqual([FIXTURE_PROMPT_PACK_VERSION, '0.2.0-fixture']);
    expect(lib.get('0.2.0-fixture')).toBe(v2);
    expect(Object.isFrozen(lib)).toBe(true);
    expect(() => (lib as Map<string, unknown>).set('x', v2)).toThrow(TypeError);
    expect(() => (lib as Map<string, unknown>).delete(FIXTURE_PROMPT_PACK_VERSION)).toThrow(
      TypeError,
    );
    expect(() => (lib as Map<string, unknown>).clear()).toThrow(TypeError);
    expect(lib.size).toBe(2);
  });

  it('rejects a duplicate version, including one that differs only in build metadata', () => {
    expect(() => createPromptPackLibrary([v2, v2])).toThrow(
      'duplicate prompt-pack set version 0.2.0-fixture',
    );
    const build = parsePromptPackSet({ ...raw(), version: '0.2.0-fixture+b2' });
    expect(() => createPromptPackLibrary([v2, build])).toThrow(
      'duplicate prompt-pack set version 0.2.0-fixture+b2',
    );
  });

  it('resolves exactly the pinned version, else throws', () => {
    const lib = createPromptPackLibrary([fixturePromptPackSet]);
    expect(resolvePromptPackSet(lib, FIXTURE_PROMPT_PACK_VERSION)).toBe(fixturePromptPackSet);
    expect(() => resolvePromptPackSet(lib, '9.9.9')).toThrow(UnknownPromptPackVersionError);
    expect(() => resolvePromptPackSet(lib, '9.9.9')).toThrow('no prompt-pack set 9.9.9');
  });
});

describe('renderTemplate', () => {
  it('fills each placeholder once', () => {
    expect(renderTemplate('a {{x}} b {{y}} {{x}}', { x: '1', y: '2' })).toBe('a 1 b 2 1');
  });

  it('is single-pass: data containing placeholders or $ patterns stays literal', () => {
    expect(renderTemplate('[{{x}}] [{{y}}]', { x: '{{y}}', y: "$& $1 $$ $'" })).toBe(
      "[{{y}}] [$& $1 $$ $']",
    );
  });

  it('throws on a placeholder with no value (load-time validation makes this a bug)', () => {
    expect(() => renderTemplate('{{x}}', {})).toThrow('no value for placeholder {{x}}');
  });

  it('lists placeholders in order, with duplicates', () => {
    expect(placeholdersOf('{{a}} {{b}} {{a}} {{ c }}')).toEqual(['a', 'b', 'a', ' c ']);
    expect(placeholdersOf('no slots')).toEqual([]);
  });
});
