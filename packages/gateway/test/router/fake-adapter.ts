// Fake ModelAdapters for router tests. Each wraps a ScriptedGateway (task 2.6) and turns its
// ScriptedProviderError into a GatewayError, the way mapProviderError does at a real adapter's
// boundary; harness cannot know about GatewayError (rule 3), so the translation lives here.
import type { ModelChunk, ModelRequest } from '@edmate/contracts';
import {
  type GatewayScript,
  manualClock,
  ScriptedGateway,
  ScriptedProviderError,
} from '@edmate/harness/testing';
import type { ZodType } from 'zod';
import { GatewayError, type GatewayStopReason } from '../../src/adapters/errors.js';
import type { AdapterCapabilities, ModelAdapter } from '../../src/adapters/types.js';
import type { ProviderId } from '../../src/keys/providers.js';

export const FULL_CAPABILITIES: AdapterCapabilities = {
  tools: true,
  streaming: true,
  json: true,
  vision: false,
  embeddings: true,
  maxContextTokens: 100_000,
};

export interface FakeAdapterOptions {
  readonly id?: ProviderId;
  readonly model?: string;
  readonly capabilities?: Partial<AdapterCapabilities>;
  readonly script?: GatewayScript;
  /** The retry hint a scripted error step maps to. */
  readonly retryableOnError?: boolean;
  /** Set on mapped errors; real adapters only pair it with retryable: false. */
  readonly reason?: GatewayStopReason;
}

export interface FakeAdapter extends ModelAdapter {
  readonly calls: { stream: number; generateObject: number; embed: number };
}

export function fakeAdapter(opts: FakeAdapterOptions = {}): FakeAdapter {
  const id = opts.id ?? 'anthropic';
  const model = opts.model ?? 'fake-model';
  const gw = new ScriptedGateway(opts.script ?? {}, manualClock());
  const calls = { stream: 0, generateObject: 0, embed: 0 };
  const map = (err: unknown): unknown =>
    err instanceof ScriptedProviderError
      ? new GatewayError(
          err.code === 'rate_limited' ? 'rate_limited' : 'provider_error',
          opts.retryableOnError ?? true,
          id,
          `${id}: ${err.message}`,
          opts.reason,
        )
      : err;

  async function* stream(req: ModelRequest): AsyncGenerator<ModelChunk> {
    try {
      yield* gw.stream(req);
    } catch (err) {
      throw map(err);
    }
  }

  return {
    id,
    model,
    capabilities: { ...FULL_CAPABILITIES, ...opts.capabilities },
    calls,
    stream(req) {
      calls.stream++;
      return stream(req);
    },
    async generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> {
      calls.generateObject++;
      try {
        return await gw.generateObject(req, schema);
      } catch (err) {
        throw map(err);
      }
    },
    async embed(texts: string[]) {
      calls.embed++;
      try {
        return await gw.embed(texts);
      } catch (err) {
        throw map(err);
      }
    },
  };
}

/** An adapter whose every call throws `err` before producing anything. */
export function failingAdapter(err: Error, opts: FakeAdapterOptions = {}): FakeAdapter {
  const base = fakeAdapter(opts);
  const calls = base.calls;
  return {
    ...base,
    calls,
    stream() {
      calls.stream++;
      return {
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(err) }),
      };
    },
    generateObject() {
      calls.generateObject++;
      return Promise.reject(err);
    },
    embed() {
      calls.embed++;
      return Promise.reject(err);
    },
  };
}

export function req(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    tier: 'main',
    system: 'You are a tutor.',
    messages: [{ role: 'user', content: 'Hi' }],
    maxOutputTokens: 64,
    ...overrides,
  };
}

export async function collect(it: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const out: ModelChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

export async function collectUntilError(
  it: AsyncIterable<ModelChunk>,
): Promise<{ seen: ModelChunk[]; err: unknown }> {
  const seen: ModelChunk[] = [];
  try {
    for await (const c of it) seen.push(c);
  } catch (err) {
    return { seen, err };
  }
  return { seen, err: undefined };
}

export const text = (t: string): ModelChunk => ({ type: 'text', text: t });
