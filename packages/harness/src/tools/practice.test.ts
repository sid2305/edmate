// Task 5.6 Phase B: `practice.next_item`'s leak proof, strict input and entitlement scoping.
import { turnContextFull } from '@edmate/contracts/fixtures';
import type { TurnContext } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { toolSpec } from '../pipeline/tools.js';
import { demoPracticeBank } from './demoPracticeBank.js';
import { NoPracticeItemError, practiceNextItemTool } from './practice.js';
import { PRACTICE_ID_MAX, PRACTICE_KEYS_MAX_JSON } from '../pedagogy/helpState.js';
import {
  generatedAnswerKeyFor,
  generateItem,
  type PracticeBank,
  type PracticeScope,
} from './practiceItems.js';
import type { DemoPracticeRecord } from './demoPracticeBank.js';

const SCOPE: PracticeScope = {
  teacherId: turnContextFull.entitlement.teacherId,
  allowedModuleIds: turnContextFull.entitlement.allowedModuleIds,
};

/** Every candidate form of `key` the shared matcher reads, folded like it folds text. */
function serializedContains(value: unknown, key: string): boolean {
  const json = JSON.stringify(value as object) ?? '';
  return json.toLowerCase().includes(key.trim().toLowerCase());
}

describe('practiceNextItemTool', () => {
  const t = practiceNextItemTool(demoPracticeBank());

  it('is the practice-skill tool, strict input, no answerKey in its output schema', () => {
    expect(t.tool.name).toBe('practice.next_item');
    expect(t.tool.skill).toBe('practice');
    expect(
      t.tool.output.safeParse({ id: 'x', kind: 'numeric', level: 1, prompt: 'p' }).success,
    ).toBe(true);
    expect(
      t.tool.output.safeParse({
        id: 'x',
        kind: 'numeric',
        level: 1,
        prompt: 'p',
        answerKey: ['7'],
      }).success,
    ).toBe(false);
  });

  it.each([
    ['empty object', {}, true],
    ['level 1', { level: 1 }, true],
    ['level 2', { level: 2 }, true],
    ['level 3', { level: 3 }, true],
    ['level 0 (out of range)', { level: 0 }, false],
    ['level 4 (out of range)', { level: 4 }, false],
    ['a string level', { level: '1' }, false],
    ['topicId (model may not choose a topic)', { topicId: 'arithmetic' }, false],
    ['id (model may not choose an item)', { id: 'demo:arithmetic:1:a' }, false],
    ['exclude (model may not choose ids)', { exclude: ['x'] }, false],
    ['an extra key', { level: 1, extra: true }, false],
    ['null', null, false],
  ])('input schema: %s → %s', (_label, candidate, ok) => {
    expect(t.tool.input.safeParse(candidate).success).toBe(ok);
  });

  it('describes its input to the model as a JSON Schema with no topic or id field', () => {
    const spec = toolSpec(t) as { inputSchema: { properties: Record<string, unknown> } };
    expect(Object.keys(spec.inputSchema.properties)).toEqual(['level']);
  });

  it('runs and returns only { id, kind, level, prompt, options? } — never the key', async () => {
    const out = await t.tool.run({ level: 1 }, turnContextFull);
    expect(out).toEqual(
      expect.objectContaining({ id: expect.any(String), kind: 'numeric', level: 1 }),
    );
    expect(Object.keys(out as object).sort()).toEqual(['id', 'kind', 'level', 'prompt']);
    expect(out).not.toHaveProperty('answerKey');
    expect(out).not.toHaveProperty('topicId');
  });

  it.each([1, 2, 3] as const)(
    'level %s: no serialized output ever contains its own answer key (bank or generated)',
    async (level) => {
      for (let i = 0; i < 20; i++) {
        const out = await t.tool.run({ level }, turnContextFull);
        const key = t.answerKeyFor((out as { id: string }).id, SCOPE);
        expect(key).toBeDefined();
        for (const k of key ?? []) {
          expect(serializedContains(out, k)).toBe(false);
        }
      }
    },
  );

  it('present() strips nothing extra (the output already excludes the key) and names skill practice', async () => {
    const out = await t.tool.run({ level: 1 }, turnContextFull);
    const shown = t.present?.(out, turnContextFull);
    expect(shown?.skill).toBe('practice');
    expect(shown?.payload).toEqual(out);
    const key = t.answerKeyFor((out as { id: string }).id, SCOPE);
    for (const k of key ?? []) {
      expect(serializedContains(shown, k)).toBe(false);
    }
  });

  it('answerKeyFor: undefined for an id outside scope (another teacher/module)', async () => {
    const out = await t.tool.run({ level: 1 }, turnContextFull);
    const outOfScope: PracticeScope = { teacherId: 'tch_other', allowedModuleIds: ['mod_other'] };
    expect(t.answerKeyFor((out as { id: string }).id, outOfScope)).toBeUndefined();
  });

  it('answerKeyFor: undefined for an id this bank/generator never produced', () => {
    expect(t.answerKeyFor('nonsense-id', SCOPE)).toBeUndefined();
  });

  it('answerKeyFor: a bank item’s key resolves straight from the bank, in scope', () => {
    const bankScope: PracticeScope = { ...SCOPE, allowedModuleIds: ['module-arithmetic'] };
    expect(t.answerKeyFor('demo:arithmetic:1:a', bankScope)).toEqual(['7']);
  });

  it('defaults to level 1 when the model names none', async () => {
    const out = await t.tool.run({}, turnContextFull);
    expect((out as { level: number }).level).toBe(1);
  });

  it('toOutput keeps options when the item has them (mcq is unservable today, but the field is wired)', async () => {
    const withOptions = {
      pick: () => ({
        id: 'fixture:opt',
        teacherId: SCOPE.teacherId,
        topicId: 'x',
        moduleId: 'mod_test_01',
        level: 1 as const,
        kind: 'numeric' as const,
        prompt: 'p',
        options: ['a', 'b'],
      }),
      // 5.6a: not 'a', which the fixture's retrieved chunk holds as a word.
      answerKeyFor: () => ['qzx'],
      itemFor: () => undefined,
    };
    const withOpt = practiceNextItemTool(withOptions);
    const out = await withOpt.tool.run({ level: 1 }, turnContextFull);
    expect((out as { options?: string[] }).options).toEqual(['a', 'b']);
  });

  it('a generated item’s key still resolves even once the bank has nothing at that level in scope', async () => {
    const empty = practiceNextItemTool(demoPracticeBank([]));
    const out = await empty.tool.run({ level: 1 }, turnContextFull);
    const key = empty.answerKeyFor((out as { id: string }).id, SCOPE);
    expect(key).toEqual(generatedAnswerKeyFor((out as { id: string }).id));
    expect(key).toBeDefined();
  });

  it('fails closed (NoPracticeItemError) when the entitlement allows no module at all', async () => {
    const noModules: TurnContext = {
      ...turnContextFull,
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [] },
      retrieved: [],
    };
    await expect(t.tool.run({ level: 1 }, noModules)).rejects.toThrow(NoPracticeItemError);
  });
});

// The demo bank's own module ids (not the contracts fixtures' 'mod_test_*' — a different
// teacher's content in these scope tests, on purpose, so a mismatch between the two would show
// up as "no item" rather than silently matching).
const MODULE_ARITHMETIC = 'module-arithmetic';
const MODULE_FRACTIONS = 'module-fractions';
const MODULE_ALGEBRA = 'module-algebra';

function ctxWith(fields: Partial<TurnContext>): TurnContext {
  return {
    ...turnContextFull,
    entitlement: { ...turnContextFull.entitlement, ...fields.entitlement },
    retrieved: fields.retrieved ?? [],
  };
}

describe('practiceNextItemTool: scope — no item outside the entitlement is ever served', () => {
  it('a subscription scoped to one module only ever gets that module’s items, bank or generated', async () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const oneModule = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MODULE_FRACTIONS] },
    });
    for (let i = 0; i < 10; i++) {
      for (const level of [1, 2, 3] as const) {
        const out = await t.tool.run({ level }, oneModule);
        const id = (out as { id: string }).id;
        expect(
          id === 'demo:fractions:1:a' || id === 'demo:fractions:2:a' || id.startsWith('gen:'),
        ).toBe(true);
        if (id.startsWith('gen:')) expect(id).toContain(`${MODULE_FRACTIONS}:practice`);
      }
    }
  });

  it('prefers the top retrieved chunk’s module over any other allowed module', async () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const ctx = ctxWith({
      entitlement: {
        ...turnContextFull.entitlement,
        allowedModuleIds: [MODULE_ARITHMETIC, MODULE_FRACTIONS],
      },
      retrieved: [{ ...turnContextFull.retrieved[0]!, moduleId: MODULE_FRACTIONS }],
    });
    const out = await t.tool.run({ level: 1 }, ctx);
    expect((out as { id: string }).id).toBe('demo:fractions:1:a');
  });

  it('falls back to the first allowed module when there is no retrieved chunk', async () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const ctx = ctxWith({
      entitlement: {
        ...turnContextFull.entitlement,
        allowedModuleIds: [MODULE_ARITHMETIC, MODULE_FRACTIONS],
      },
      retrieved: [],
    });
    const out = await t.tool.run({ level: 1 }, ctx);
    expect((out as { id: string }).id).toBe('demo:arithmetic:1:a');
  });

  it('ignores a top retrieved chunk whose module is not allowed (fails closed to the allowed set)', async () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const ctx = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MODULE_ARITHMETIC] },
      retrieved: [{ ...turnContextFull.retrieved[0]!, moduleId: MODULE_ALGEBRA }],
    });
    const out = await t.tool.run({ level: 1 }, ctx);
    expect((out as { id: string }).id).toBe('demo:arithmetic:1:a');
  });

  it('activeModuleId hook: used only when there is no (allowed) top retrieved chunk', async () => {
    const t = practiceNextItemTool(demoPracticeBank(), {
      activeModuleId: () => MODULE_FRACTIONS,
    });
    const ctx = ctxWith({
      entitlement: {
        ...turnContextFull.entitlement,
        allowedModuleIds: [MODULE_ARITHMETIC, MODULE_FRACTIONS],
      },
      retrieved: [],
    });
    const out = await t.tool.run({ level: 1 }, ctx);
    expect((out as { id: string }).id).toBe('demo:fractions:1:a');
  });

  it('activeModuleId hook: ignored when it names a module outside the entitlement', async () => {
    const t = practiceNextItemTool(demoPracticeBank(), {
      activeModuleId: () => 'module-not-allowed',
    });
    const ctx = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MODULE_ARITHMETIC] },
      retrieved: [],
    });
    const out = await t.tool.run({ level: 1 }, ctx);
    expect((out as { id: string }).id).toBe('demo:arithmetic:1:a');
  });
});

describe('practiceNextItemTool: session state and issued items (5.6 Phase C, ADR-0010)', () => {
  const two = ctxWith({
    entitlement: {
      ...turnContextFull.entitlement,
      allowedModuleIds: [MODULE_ARITHMETIC, MODULE_FRACTIONS],
    },
    retrieved: [],
  });
  const idOf = (out: unknown) => (out as { id: string }).id;

  it('exclude: a served bank item is not served again (a generated one takes its place)', async () => {
    const t = practiceNextItemTool(demoPracticeBank(), { exclude: ['demo:arithmetic:1:a'] });
    const id = idOf(await t.tool.run({ level: 1 }, two));
    expect(id).not.toBe('demo:arithmetic:1:a');
    expect(id).toContain(`${MODULE_ARITHMETIC}:practice`);
  });

  it('forSession binds the served list and the active module, and keeps the hooks', async () => {
    const base = practiceNextItemTool(demoPracticeBank());
    const bound = base.forSession({ servedItemIds: [], activeModuleId: MODULE_FRACTIONS });
    expect(bound.tool.name).toBe('practice.next_item');
    expect(idOf(await bound.tool.run({ level: 1 }, two))).toBe('demo:fractions:1:a');
    const served = base.forSession({ servedItemIds: ['demo:arithmetic:1:a'] });
    expect(idOf(await served.tool.run({ level: 1 }, two))).not.toBe('demo:arithmetic:1:a');
    expect(served.issuedItem).toBeTypeOf('function');
  });

  it('forSession with no active module falls back to the options hook, then the first module', async () => {
    const hooked = practiceNextItemTool(demoPracticeBank(), {
      activeModuleId: () => MODULE_FRACTIONS,
    }).forSession({ servedItemIds: [] });
    expect(idOf(await hooked.tool.run({ level: 1 }, two))).toBe('demo:fractions:1:a');
    const plain = practiceNextItemTool(demoPracticeBank()).forSession({ servedItemIds: [] });
    expect(idOf(await plain.tool.run({ level: 1 }, two))).toBe('demo:arithmetic:1:a');
  });

  it('issuedItem: a bank item gives its id, its module and its key, looked up on the server', async () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const fr = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MODULE_FRACTIONS] },
    });
    const out = await t.tool.run({ level: 2 }, fr);
    expect(t.issuedItem(out, fr)).toEqual({
      itemId: 'demo:fractions:2:a',
      moduleId: MODULE_FRACTIONS,
      topicId: 'fractions',
      answerKey: ['1/2'],
      shown: [(out as { prompt: string }).prompt],
    });
    expect(serializedContains(out, '1/2')).toBe(false);
  });

  it('issuedItem: the module is the one allowed module the id resolves in', () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const out = { id: 'demo:fractions:1:a', kind: 'numeric', level: 1, prompt: 'p' };
    expect(t.issuedItem(out, two)?.moduleId).toBe(MODULE_FRACTIONS);
  });

  it('issuedItem: a generated item gives the generator’s key and its module, but no topicId (fix round 1: a generated item has no real topic, so evidence must not attach one)', async () => {
    const t = practiceNextItemTool(demoPracticeBank(), { exclude: ['demo:arithmetic:1:a'] });
    const out = await t.tool.run({ level: 1 }, two);
    const id = idOf(out);
    const issued = t.issuedItem(out, two);
    expect(issued).toEqual({
      itemId: id,
      moduleId: MODULE_ARITHMETIC,
      answerKey: [...(generatedAnswerKeyFor(id) ?? [])],
      shown: [(out as { prompt: string }).prompt],
    });
    expect(issued).not.toHaveProperty('topicId');
  });

  it('issuedItem: undefined (fail closed) for an invalid output, an unknown id or one outside the scope', () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const arith = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MODULE_ARITHMETIC] },
    });
    const item = (id: string) => ({ id, kind: 'numeric', level: 1, prompt: 'p' });
    expect(t.issuedItem({ id: 'demo:arithmetic:1:a' }, arith)).toBeUndefined();
    expect(t.issuedItem(item('no-such-item'), arith)).toBeUndefined();
    expect(t.issuedItem(item('demo:fractions:1:a'), arith)).toBeUndefined();
    expect(t.issuedItem(item(`gen:${MODULE_FRACTIONS}:practice:1:2+3`), arith)).toBeUndefined();
  });

  it('issuedItem: an empty key fails closed too (an item that can’t be protected)', () => {
    const bank = demoPracticeBank();
    const empty = { ...bank, answerKeyFor: () => [] };
    const t = practiceNextItemTool(empty);
    const out = { id: 'demo:arithmetic:1:a', kind: 'numeric', level: 1, prompt: 'p' };
    expect(t.issuedItem(out, two)).toBeUndefined();
  });

  it('the output schema caps the item id at PRACTICE_ID_MAX', () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const at = { id: 'x'.repeat(PRACTICE_ID_MAX), kind: 'numeric', level: 1, prompt: 'p' };
    expect(t.tool.output.safeParse(at).success).toBe(true);
    expect(t.tool.output.safeParse({ ...at, id: `${at.id}x` }).success).toBe(false);
  });

  it('issuedItem: shown is the prompt and the options, never the id or level', () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const out = {
      id: 'demo:arithmetic:1:a',
      kind: 'numeric',
      level: 1,
      prompt: 'p',
      options: ['o'],
    };
    expect(t.issuedItem(out, two)?.shown).toEqual(['p', 'o']);
  });

  it('issuedItem: a module id over PRACTICE_ID_MAX fails closed', () => {
    const long = 'm'.repeat(PRACTICE_ID_MAX + 1);
    const bank: PracticeBank = {
      pick: () => undefined,
      itemFor: () => undefined,
      answerKeyFor: () => ['5'],
    };
    const t = practiceNextItemTool(bank);
    const ctx = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [long] },
    });
    const out = { id: 'bank:1', kind: 'numeric', level: 1, prompt: 'p' };
    expect(t.issuedItem(out, ctx)).toBeUndefined();
  });

  it('issuedItem: fails closed when no single allowed module resolves the id', () => {
    // An inconsistent bank: a key for the whole scope but none for any one module.
    const bank: PracticeBank = {
      pick: () => undefined,
      itemFor: () => undefined,
      answerKeyFor: (_id, scope) => (scope.allowedModuleIds.length > 1 ? ['5'] : undefined),
    };
    const out = { id: 'bank:1', kind: 'numeric', level: 1, prompt: 'p' };
    expect(practiceNextItemTool(bank).issuedItem(out, two)).toBeUndefined();
  });

  it('issuedItem: fails closed when the key union would push HelpState over its limit', () => {
    // One allowed module: a bank that resolves every id would resolve it in both of `two`'s.
    const one = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MODULE_ARITHMETIC] },
    });
    const big = 'k'.repeat(PRACTICE_KEYS_MAX_JSON);
    const bank: PracticeBank = {
      pick: () => undefined,
      itemFor: () => undefined,
      answerKeyFor: () => [big],
    };
    const out = { id: 'bank:1', kind: 'numeric', level: 1, prompt: 'p' };
    expect(practiceNextItemTool(bank).issuedItem(out, one)).toBeUndefined();
    // The session's earlier keys count too.
    const half = 'h'.repeat(PRACTICE_KEYS_MAX_JSON / 2);
    const halfBank: PracticeBank = {
      pick: () => undefined,
      itemFor: () => undefined,
      answerKeyFor: () => [half],
    };
    const fresh = practiceNextItemTool(halfBank).forSession({ servedItemIds: [] });
    expect(fresh.issuedItem?.(out, one)).toBeDefined();
    const full = practiceNextItemTool(halfBank).forSession({
      servedItemIds: [],
      issuedKeys: ['x'.repeat(PRACTICE_KEYS_MAX_JSON / 2)],
    });
    expect(full.issuedItem?.(out, one)).toBeUndefined();
  });

  it("issuedItem: undefined for a bank id under another teacher's scope (5.6c)", () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const other = ctxWith({
      entitlement: { ...turnContextFull.entitlement, teacherId: 'tch_other' },
    });
    const out = { id: 'demo:arithmetic:1:a', kind: 'numeric', level: 1, prompt: 'p' };
    expect(
      t.issuedItem(out, {
        ...other,
        entitlement: { ...other.entitlement, allowedModuleIds: [MODULE_ARITHMETIC] },
      }),
    ).toBeUndefined();
    expect(t.issuedItem(out, two)).toBeDefined();
  });

  it('issuedItem: undefined when the id resolves in two allowed modules (5.6c)', () => {
    const bank: PracticeBank = {
      pick: () => undefined,
      itemFor: () => undefined,
      answerKeyFor: () => ['5'],
    };
    const out = { id: 'bank:1', kind: 'numeric', level: 1, prompt: 'p' };
    expect(practiceNextItemTool(bank).issuedItem(out, two)).toBeUndefined();
  });

  it('issuedItem: a generated id resolves through the one parser, in its own module only', () => {
    const t = practiceNextItemTool(demoPracticeBank([]));
    const item = (id: string) => ({ id, kind: 'numeric', level: 1, prompt: 'p' });
    expect(t.issuedItem(item(`gen:${MODULE_FRACTIONS}:practice:1:2+3`), two)).toMatchObject({
      moduleId: MODULE_FRACTIONS,
      answerKey: ['5'],
    });
    // A 4-digit operand, or the wrong op for the level, is not a generated id.
    expect(t.issuedItem(item(`gen:${MODULE_FRACTIONS}:practice:1:2000+3`), two)).toBeUndefined();
    expect(t.issuedItem(item(`gen:${MODULE_FRACTIONS}:practice:1:2*3`), two)).toBeUndefined();
  });

  it('run under another teacher with the same module never serves the bank item (5.6c)', async () => {
    const t = practiceNextItemTool(demoPracticeBank());
    const other = ctxWith({
      entitlement: {
        ...turnContextFull.entitlement,
        teacherId: 'tch_other',
        allowedModuleIds: [MODULE_ARITHMETIC],
      },
    });
    for (const level of [1, 2, 3] as const) {
      const out = await t.tool.run({ level }, other);
      expect(idOf(out)).toMatch(/^gen:module-arithmetic:practice:/);
    }
  });

  it('issuedItem: the cap counts held keys too (5.6c)', () => {
    const half = 'h'.repeat(PRACTICE_KEYS_MAX_JSON / 2);
    const bank: PracticeBank = {
      pick: () => undefined,
      itemFor: () => undefined,
      answerKeyFor: () => [half],
    };
    const arith = ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MODULE_ARITHMETIC] },
    });
    const out = { id: 'bank:1', kind: 'numeric', level: 1, prompt: 'p' };
    const base = practiceNextItemTool(bank);
    expect(base.forSession({ servedItemIds: [] }).issuedItem(out, arith)).toBeDefined();
    const held = base.forSession({
      servedItemIds: [],
      heldKeys: ['x'.repeat(PRACTICE_KEYS_MAX_JSON / 2)],
    });
    expect(held.issuedItem(out, arith)).toBeUndefined();
  });

  it('forSession heldKeys: never serves an item whose prompt shows a held key', async () => {
    // Level 1 sums: hold every key the first generated items would have.
    const base = practiceNextItemTool(demoPracticeBank(), { exclude: ['demo:arithmetic:1:a'] });
    const first = await base.tool.run({ level: 1 }, two);
    const key = base.issuedItem(first, two)?.answerKey ?? [];
    const bound = base.forSession({ servedItemIds: ['demo:arithmetic:1:a'], heldKeys: key });
    const next = (await bound.tool.run({ level: 1 }, two)) as { id: string; prompt: string };
    expect(next.id).not.toBe(idOf(first));
    expect(bound.issuedItem?.(next, two)?.answerKey).not.toEqual(key);
    // Held "1": no item whose prompt names 1 is served.
    const one = base.forSession({ servedItemIds: ['demo:arithmetic:1:a'], heldKeys: ['1'] });
    const p = ((await one.tool.run({ level: 1 }, two)) as { prompt: string }).prompt;
    expect(p).not.toMatch(/(?<![0-9])1(?![0-9])/);
  });
});

describe("practiceNextItemTool: no item whose key is in this turn's chunks (5.6a)", () => {
  const MOD = MODULE_ARITHMETIC;
  const rec = (id: string, prompt: string, key: string): DemoPracticeRecord => ({
    item: {
      id,
      teacherId: SCOPE.teacherId,
      topicId: 'linear',
      moduleId: MOD,
      level: 1,
      kind: 'numeric',
      prompt,
    },
    answerKey: [key],
  });
  const RECS = [
    rec('fx:a', 'Solve for x: x - 1000 = 3321.', '4321'),
    rec('fx:b', 'Solve for y: y - 2000 = 3456.', '5456'),
  ];
  const chunkWith = (text: string, field: 'text' | 'title' | 'locator' = 'text') => {
    const base = turnContextFull.retrieved[0]!;
    return {
      ...base,
      moduleId: MOD,
      text: field === 'text' ? text : base.text,
      source: {
        ...base.source,
        ...(field === 'title' ? { title: text } : {}),
        ...(field === 'locator' ? { locator: text } : {}),
      },
    };
  };
  const ctxOf = (chunks: ReturnType<typeof chunkWith>[]) =>
    ctxWith({
      entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MOD] },
      retrieved: chunks,
    });
  const idOf = (out: unknown) => (out as { id: string }).id;

  it('a bank item whose key is in a retrieved chunk is skipped for the next valid one', async () => {
    const t = practiceNextItemTool(demoPracticeBank(RECS));
    expect(idOf(await t.tool.run({ level: 1 }, ctxOf([chunkWith('nothing here')])))).toBe('fx:a');
    for (const field of ['text', 'title', 'locator'] as const) {
      const ctx = ctxOf([chunkWith('so x is 4,321 then', field)]);
      expect(idOf(await t.tool.run({ level: 1 }, ctx))).toBe('fx:b');
    }
  });

  it('a generated item whose key is in a chunk moves on to the next variant', async () => {
    // Level 3 products: find a generated item with a 3-digit key (short keys are not checked).
    const scope: PracticeScope = { teacherId: SCOPE.teacherId, allowedModuleIds: [MOD] };
    const before: string[] = [];
    let target = generateItem(scope, 3, before);
    while (target !== undefined && (target.answerKey[0] ?? '').length < 3) {
      before.push(target.item.id);
      target = generateItem(scope, 3, before);
    }
    const key = target?.answerKey[0];
    if (target === undefined || key === undefined) throw new Error('no 3-digit generated key');
    const t = practiceNextItemTool(demoPracticeBank([]), { exclude: before });
    expect(idOf(await t.tool.run({ level: 3 }, ctxOf([chunkWith('no numbers')])))).toBe(
      target.item.id,
    );
    const ctx = ctxOf([chunkWith(`the product is ${key}`)]);
    const out = await t.tool.run({ level: 3 }, ctx);
    expect(idOf(out)).not.toBe(target.item.id);
    expect(t.issuedItem(out, ctx)?.answerKey).not.toEqual([key]);
  });

  it('a short numeric key in a chunk does not refuse the item (lead answer, 20 Oct)', async () => {
    const t = practiceNextItemTool(demoPracticeBank([rec('fx:s', 'What is 3 + 4?', '7')]));
    const ctx = ctxOf([chunkWith('there are 7 days')]);
    expect(idOf(await t.tool.run({ level: 1 }, ctx))).toBe('fx:s');
  });
});

describe('practiceNextItemTool: activeItem (5.6b), scoped to the entitlement', () => {
  const t = practiceNextItemTool(demoPracticeBank());
  const inModules = (allowedModuleIds: string[], teacherId = SCOPE.teacherId) =>
    ctxWith({ entitlement: { ...turnContextFull.entitlement, teacherId, allowedModuleIds } });

  it('rebuilds a bank item in scope: prompt, options and its own key', () => {
    expect(t.activeItem('demo:arithmetic:1:a', inModules([MODULE_ARITHMETIC]))).toEqual({
      prompt: 'What is 3 + 4?',
      answerKey: ['7'],
    });
    expect(t.activeItem('demo:algebra:3:a', inModules([MODULE_ALGEBRA]))).toEqual({
      prompt: 'Which of these numbers is prime?',
      options: ['A) 6', 'B) 7', 'C) 8'],
      answerKey: ['B'],
    });
  });

  it('returns undefined for another teacher, another module or an unknown id', () => {
    expect(t.activeItem('demo:arithmetic:1:a', inModules([MODULE_ARITHMETIC], 'tch_other'))).toBe(
      undefined,
    );
    expect(t.activeItem('demo:arithmetic:1:a', inModules([MODULE_FRACTIONS]))).toBeUndefined();
    expect(t.activeItem('nonsense-id', inModules([MODULE_ARITHMETIC]))).toBeUndefined();
  });

  it('round-trips a generated item: its prompt and key recomputed from the id, in scope only', async () => {
    const gen = practiceNextItemTool(demoPracticeBank([]));
    const ctx = inModules([MODULE_FRACTIONS]);
    const out = (await gen.tool.run({ level: 2 }, ctx)) as { id: string; prompt: string };
    expect(gen.activeItem(out.id, ctx)).toEqual({
      prompt: out.prompt,
      answerKey: generatedAnswerKeyFor(out.id),
    });
    expect(gen.activeItem(out.id, inModules([MODULE_ARITHMETIC]))).toBeUndefined();
    expect(gen.activeItem('gen:module-fractions:practice:2:12+3', ctx)).toBeUndefined();
  });

  it('a bank that knows the item but not its key gives undefined (fail closed)', () => {
    const odd: PracticeBank = {
      ...demoPracticeBank(),
      itemFor: () => undefined,
      answerKeyFor: () => undefined,
    };
    const ctx = inModules([MODULE_ARITHMETIC]);
    expect(practiceNextItemTool(odd).activeItem('demo:arithmetic:1:a', ctx)).toBeUndefined();
    const empty: PracticeBank = { ...demoPracticeBank(), answerKeyFor: () => [] };
    expect(practiceNextItemTool(empty).activeItem('demo:arithmetic:1:a', ctx)).toBeUndefined();
  });

  it('the session-bound copy has the same hook', () => {
    const bound = t.forSession({ servedItemIds: [] });
    expect(bound.activeItem('demo:arithmetic:1:a', inModules([MODULE_ARITHMETIC]))?.prompt).toBe(
      'What is 3 + 4?',
    );
  });
});

describe('practiceNextItemTool: a held label key and a new listing (5.6b)', () => {
  const MOD = MODULE_ARITHMETIC;
  const rec = (id: string, prompt: string): DemoPracticeRecord => ({
    item: {
      id,
      teacherId: SCOPE.teacherId,
      topicId: 'sums',
      moduleId: MOD,
      level: 1,
      kind: 'short',
      prompt,
      options: ['A) 39', 'B) 41', 'C) 44'],
    },
    answerKey: ['42'],
  });
  const ctx = ctxWith({
    entitlement: { ...turnContextFull.entitlement, allowedModuleIds: [MOD] },
    retrieved: [],
  });
  const idOf = (out: unknown) => (out as { id: string }).id;

  it('an item whose own listing names the held label is served (its listing is exempt)', async () => {
    const bank = demoPracticeBank([rec('fx:list', 'Which option is closest to 40 + 2?')]);
    const t = practiceNextItemTool(bank, { heldKeys: ['B'] });
    expect(idOf(await t.tool.run({ level: 1 }, ctx))).toBe('fx:list');
  });

  it('an item whose prompt says the held label is still refused', async () => {
    const bank = demoPracticeBank([rec('fx:says', 'The answer is B. Which is closest to 40 + 2?')]);
    const t = practiceNextItemTool(bank, { heldKeys: ['B'] });
    expect(idOf(await t.tool.run({ level: 1 }, ctx))).not.toBe('fx:says');
  });
});
