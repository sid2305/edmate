// The dev model (task 9.0, decision D2): a scripted provider adapter for a local stack with no
// provider key, so a builder can run a chat turn end to end. It replaces only the provider adapter
// (`factories.anthropic`): the metered router, guards, pricing and commit stay real.
//
// It stands in for the safety classifiers (it answers every classifier "all clear"), so it is
// honoured only on a local stack: `EDMATE_DEV_MODEL` must be exactly `scripted` AND `AUTH_URL` must
// be plain http on localhost, 127.0.0.1 or [::1]. The compose image runs NODE_ENV=production, so
// the guard never looks at NODE_ENV. Anything else set fails closed (`EDMATE_DEV_MODEL`).
import type { ModelChunk, ModelRequest } from '@edmate/contracts';
import type { ModelAdapter, ProviderAdapterFactories } from '@edmate/gateway';
import { ADVICE_JUDGE_SYSTEM, GROUNDING_JUDGE_SYSTEM } from '@edmate/harness';
import type { ZodType } from 'zod';
import { TurnUnavailableError } from './routes';

type Env = Readonly<Record<string, string | undefined>>;

export const DEV_MODEL_PREFIX = '[dev model]';
export const DEV_MODEL_NO_MATERIAL = `${DEV_MODEL_PREFIX} No teacher material was found for this question.`;

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether the dev model is on. Unset or empty: off (today's behaviour). Exactly `scripted` with a
 * local http `AUTH_URL`: on. Any other value, or `scripted` anywhere else: throws
 * `TurnUnavailableError('EDMATE_DEV_MODEL')` (never quoting the values).
 */
export function devModelEnabled(env: Env): boolean {
  const flag = env.EDMATE_DEV_MODEL;
  if (flag === undefined || flag === '') return false;
  if (flag !== 'scripted' || !isLocalAuthUrl(env.AUTH_URL)) {
    throw new TurnUnavailableError('EDMATE_DEV_MODEL');
  }
  return true;
}

function isLocalAuthUrl(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'http:' && url.username === '' && url.password === '' && LOCAL_HOSTS.has(url.hostname);
}

/**
 * The fixed "all clear" verdicts, in order. `generateObject` returns the first one the schema
 * accepts: moderation and jailbreak, distress, grounding judge, advice judge, route fallback
 * (intent alone, then intent and attempt), and the session summary.
 */
const CANDIDATES: readonly unknown[] = [
  { category: 'none' },
  { distress: false },
  { grounded: true },
  { personalAdvice: false },
  { intent: 'on_task' },
  { intent: 'on_task', attempt: 'none' },
  { summary: `${DEV_MODEL_PREFIX} A short session recap.` },
];

/**
 * The first retrieved teacher material in a request, as the composer renders it
 * (`[1] <title> · <locator> · <kind>` then the text fenced in `<<<` / `>>>`), or undefined.
 */
export function firstMaterial(system: string): string | undefined {
  const m = /^\[1\] [^\n]*\n<<<\n([\s\S]*?)\n>>>/m.exec(system);
  const text = m?.[1]?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/**
 * The post-guard judges (grounding 4.7, advice 4.8) ask for strict JSON as streamed text, keyed by
 * their exact fixed rubric: they get the "all clear" verdict, like the classifiers (9.0 Phase C).
 */
const JUDGE_VERDICTS: ReadonlyMap<string, string> = new Map([
  [GROUNDING_JUDGE_SYSTEM, '{"grounded": true}'],
  [ADVICE_JUDGE_SYSTEM, '{"personalAdvice": false}'],
]);

/** A rough token count for usage (about 4 characters a token, at least 1). */
function tokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function devModelAdapter(model: string): ModelAdapter {
  return {
    id: 'anthropic',
    model,
    capabilities: {
      tools: true,
      streaming: true,
      json: true,
      vision: false,
      embeddings: false,
      maxContextTokens: 200_000,
    },
    stream(req: ModelRequest): AsyncIterable<ModelChunk> {
      const material = firstMaterial(req.system);
      const reply =
        JUDGE_VERDICTS.get(req.system) ??
        (material === undefined
          ? DEV_MODEL_NO_MATERIAL
          : `${DEV_MODEL_PREFIX} From your teacher's material: "${material}"`);
      const input = req.system + req.messages.map((m) => m.content).join('\n');
      return (async function* devStream(): AsyncGenerator<ModelChunk> {
        for (const part of reply.match(/\S+\s*/g) ?? [reply]) yield { type: 'text', text: part };
        yield {
          type: 'usage',
          usage: { model, tier: req.tier, inputTokens: tokens(input), outputTokens: tokens(reply), costMicroUsd: 0 },
        };
      })();
    },
    generateObject<T>(_req: ModelRequest, schema: ZodType<T>): Promise<T> {
      for (const candidate of CANDIDATES) {
        const parsed = schema.safeParse(candidate);
        if (parsed.success) return Promise.resolve(parsed.data);
      }
      return Promise.reject(new Error('dev model: no fixed answer fits this schema'));
    },
    embed(): Promise<number[][]> {
      return Promise.reject(new Error('dev model: embed is not supported'));
    },
  };
}

/** Provider factories with the dev adapter in place of Anthropic. */
export function devFactories(): ProviderAdapterFactories {
  return { anthropic: (model: string) => devModelAdapter(model) };
}
