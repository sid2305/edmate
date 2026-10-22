// The dev model (task 9.0, D2): local-only, exact flag; replies quote the first retrieved material;
// classifiers get fixed "all clear" verdicts; an unknown schema and embed fail closed.
import { AttemptSchema, IntentSchema, type ModelChunk, type ModelRequest } from '@edmate/contracts';
import {
  ADVICE_JUDGE_SYSTEM,
  DistressVerdictSchema,
  GROUNDING_JUDGE_SYSTEM,
  JailbreakVerdictSchema,
  ModerationVerdictSchema,
  parseGroundingVerdict,
} from '@edmate/harness';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DEV_MODEL_NO_MATERIAL,
  devFactories,
  devModelAdapter,
  devModelEnabled,
  firstMaterial,
} from './devModel';
import { TurnUnavailableError } from './routes';

function req(system: string, tier: ModelRequest['tier'] = 'main'): ModelRequest {
  return { tier, system, messages: [{ role: 'user', content: 'What is the lesson fact?' }], maxOutputTokens: 100 };
}

/** Material the way the composer renders it (compose.ts materialBlock: `[n] title · locator · kind`, fenced). */
const SYSTEM_WITH_MATERIAL = [
  'You are a tutor.',
  'Style card:\n<<<\nWarm and brief.\n>>>',
  'Material:\n[1] Lesson one · p1 · material\n<<<\nThe Zorblat river freezes every Tuesday.\n>>>\n\n[2] Lesson two · p2 · material\n<<<\nSecond chunk.\n>>>',
].join('\n\n');

async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const out: ModelChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

const textOf = (chunks: ModelChunk[]) =>
  chunks.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('devModelEnabled', () => {
  it('is off when the flag is unset or empty, whatever AUTH_URL is', () => {
    expect(devModelEnabled({})).toBe(false);
    expect(devModelEnabled({ EDMATE_DEV_MODEL: '', AUTH_URL: 'https://edmate.example' })).toBe(false);
  });

  it('is on for exactly `scripted` with a local http AUTH_URL', () => {
    for (const url of ['http://localhost:8080', 'http://127.0.0.1:18080', 'http://[::1]:8080', 'http://localhost']) {
      expect(devModelEnabled({ EDMATE_DEV_MODEL: 'scripted', AUTH_URL: url })).toBe(true);
    }
  });

  it('fails closed for `scripted` anywhere that is not local http', () => {
    for (const url of [
      undefined,
      '',
      'not a url',
      'https://edmate.example',
      'https://localhost:8080',
      'http://10.0.0.5:8080',
      'http://localhost.evil.example',
      'http://user:pw@localhost:8080',
      'http://localhost@evil.example',
      'http://0.0.0.0:8080',
    ]) {
      const env = { EDMATE_DEV_MODEL: 'scripted', AUTH_URL: url };
      expect(() => devModelEnabled(env)).toThrow(TurnUnavailableError);
      expect(() => devModelEnabled(env)).toThrow('EDMATE_DEV_MODEL');
    }
  });

  it('accepts only the exact value', () => {
    for (const flag of ['yes', 'Scripted', ' scripted', 'scripted ', 'true', '1', ' ']) {
      expect(() => devModelEnabled({ EDMATE_DEV_MODEL: flag, AUTH_URL: 'http://localhost:8080' })).toThrow(
        'EDMATE_DEV_MODEL',
      );
    }
  });
});

describe('firstMaterial', () => {
  it('finds the first material block, not other fenced data', () => {
    expect(firstMaterial(SYSTEM_WITH_MATERIAL)).toBe('The Zorblat river freezes every Tuesday.');
    expect(firstMaterial('Style card:\n<<<\nWarm.\n>>>')).toBeUndefined();
    expect(firstMaterial('[1] t · p · material\n<<<\n   \n>>>')).toBeUndefined();
  });
});

describe('devModelAdapter.stream', () => {
  it('starts with [dev model] and quotes the first retrieved material, then reports usage', async () => {
    const chunks = await collect(devModelAdapter('claude-haiku-4-5').stream(req(SYSTEM_WITH_MATERIAL)));
    const text = textOf(chunks);
    expect(text.startsWith('[dev model]')).toBe(true);
    expect(text).toContain('The Zorblat river freezes every Tuesday.');
    expect(text).not.toContain('Second chunk');
    expect(chunks.filter((c) => c.type === 'text').length).toBeGreaterThan(1);
    const last = chunks.at(-1);
    expect(last?.type).toBe('usage');
    if (last?.type === 'usage') {
      expect(last.usage).toMatchObject({ model: 'claude-haiku-4-5', tier: 'main', costMicroUsd: 0 });
      expect(last.usage.inputTokens).toBeGreaterThan(0);
      expect(last.usage.outputTokens).toBeGreaterThan(0);
    }
  });

  it('with no material, gives the fixed no-material text and then a usage step', async () => {
    const chunks = await collect(devModelAdapter('m').stream(req('No material here.', 'small')));
    expect(textOf(chunks)).toBe(DEV_MODEL_NO_MATERIAL);
    expect(chunks.at(-1)).toMatchObject({ type: 'usage', usage: { model: 'm', tier: 'small' } });
  });
});

describe('devModelAdapter.stream for the post-guard judges (9.0 Phase C)', () => {
  it('answers the grounding judge with the strict grounded verdict', async () => {
    const chunks = await collect(devModelAdapter('m').stream(req(GROUNDING_JUDGE_SYSTEM, 'small')));
    expect(parseGroundingVerdict(textOf(chunks))).toBe(true);
    expect(chunks.at(-1)?.type).toBe('usage');
  });

  it('answers the advice judge with the strict no-personal-advice verdict', async () => {
    const chunks = await collect(devModelAdapter('m').stream(req(ADVICE_JUDGE_SYSTEM, 'small')));
    expect(JSON.parse(textOf(chunks))).toEqual({ personalAdvice: false });
    expect(chunks.at(-1)?.type).toBe('usage');
  });

  it('answers any other system prompt as a tutor reply, not a verdict', async () => {
    const chunks = await collect(devModelAdapter('m').stream(req(`${GROUNDING_JUDGE_SYSTEM} `)));
    expect(textOf(chunks)).toBe(DEV_MODEL_NO_MATERIAL);
  });
});

describe('devModelAdapter.generateObject', () => {
  // Copies of the harness schemas it does not export (grounding.ts, adviceGuard.ts,
  // modelFallback.ts, pipeline/results.ts, sessionSummary.ts); the route test runs the real ones.
  const schemas = {
    moderation: [ModerationVerdictSchema, { category: 'none' }],
    jailbreak: [JailbreakVerdictSchema, { category: 'none' }],
    distress: [DistressVerdictSchema, { distress: false }],
    grounding: [z.strictObject({ grounded: z.boolean() }), { grounded: true }],
    advice: [z.strictObject({ personalAdvice: z.boolean() }), { personalAdvice: false }],
    routeIntent: [z.strictObject({ intent: IntentSchema }), { intent: 'on_task' }],
    routeFallback: [z.strictObject({ intent: IntentSchema, attempt: AttemptSchema }), { intent: 'on_task', attempt: 'none' }],
  } as const;

  for (const [name, [schema, expected]] of Object.entries(schemas)) {
    it(`answers the ${name} schema all clear`, async () => {
      await expect(devModelAdapter('m').generateObject(req(''), schema as z.ZodType)).resolves.toEqual(expected);
    });
  }

  it('answers a session summary schema', async () => {
    const schema = z.strictObject({ summary: z.string().max(400) });
    const out = await devModelAdapter('m').generateObject(req(''), schema);
    expect(out.summary).toContain('[dev model]');
  });

  it('throws on a schema no fixed answer fits', async () => {
    const schema = z.strictObject({ somethingElse: z.number() });
    await expect(devModelAdapter('m').generateObject(req(''), schema)).rejects.toThrow('no fixed answer');
  });
});

describe('devModelAdapter.embed and devFactories', () => {
  it('embed throws', async () => {
    await expect(devModelAdapter('m').embed(['lesson'])).rejects.toThrow('not supported');
  });

  it('builds only an anthropic factory, bound to the asked model', () => {
    const f = devFactories();
    expect(Object.keys(f)).toEqual(['anthropic']);
    const adapter = f.anthropic?.('claude-sonnet-4-5');
    expect(adapter).toMatchObject({ id: 'anthropic', model: 'claude-sonnet-4-5' });
    expect(adapter?.capabilities.embeddings).toBe(false);
  });
});
