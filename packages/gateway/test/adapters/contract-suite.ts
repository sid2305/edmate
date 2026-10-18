// The shared adapter contract: stream, tool call, JSON (generateObject), embed and error
// mapping, run against fixtures. It knows nothing about any one provider: it takes a factory,
// fixtures and the expected capabilities, so a third adapter only adds a test file like
// anthropic.test.ts.
import type { ModelChunk, ModelRequest } from '@edmate/contracts';
import { ModelChunkSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GatewayError } from '../../src/adapters/errors.js';
import type { AdapterCapabilities, ModelAdapter } from '../../src/adapters/types.js';
import { Secret } from '../../src/keys/secret.js';
import { type ContractFixtures, EXPECTED } from '../fixtures/contract.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';
import { type FakeResponse, type FetchMock, fetchMock } from '../helpers/fetch-mock.js';

export interface ContractTarget {
  readonly name: string;
  readonly build: (
    keys: { readonly apiKey: Secret },
    fetch: typeof globalThis.fetch,
  ) => ModelAdapter;
  readonly fixtures: ContractFixtures;
  readonly capabilities: AdapterCapabilities;
  /** True when the captured request authenticates with exactly this key. */
  readonly sentKey: (headers: Readonly<Record<string, string>>, key: string) => boolean;
}

export const baseRequest: ModelRequest = {
  tier: 'main',
  system: 'You are a patient tutor.',
  messages: [
    { role: 'user', content: 'What is 2 + 2?' },
    { role: 'assistant', content: 'What do you think?' },
    { role: 'user', content: 'Four?' },
  ],
  maxOutputTokens: 256,
  temperature: 0.2,
};

export const toolRequest: ModelRequest = {
  ...baseRequest,
  tools: [
    {
      name: EXPECTED.toolCall.name,
      description: 'Pick the next practice item.',
      inputSchema: {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
        additionalProperties: false,
      },
    },
  ],
};

const AnswerSchema = z.strictObject({ answer: z.number() });

export async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const out: ModelChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

export async function caught(work: Promise<unknown>): Promise<GatewayError> {
  try {
    await work;
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayError);
    return err as GatewayError;
  }
  throw new Error('expected a GatewayError');
}

export function runContractSuite(target: ContractTarget): void {
  const setup = (responses: readonly FakeResponse[]) => {
    const key = fakeKey();
    const mock: FetchMock = fetchMock(responses);
    const adapter = target.build({ apiKey: Secret.of(key) }, mock.fetch);
    return { key, mock, adapter };
  };

  describe(`${target.name}: adapter contract`, () => {
    it('declares the expected capabilities', () => {
      const { adapter } = setup([]);
      expect(adapter.capabilities).toEqual(target.capabilities);
      expect(Object.isFrozen(adapter.capabilities)).toBe(true);
      expect(Object.isFrozen(adapter)).toBe(true);
    });

    it('stream(): text chunks in order, then one usage chunk', async () => {
      const { adapter, mock, key } = setup([target.fixtures.textStream]);
      const chunks = await collect(adapter.stream(baseRequest));
      for (const c of chunks) expect(ModelChunkSchema.safeParse(c).success).toBe(true);
      expect(chunks).toEqual([
        ...EXPECTED.textDeltas.map((text) => ({ type: 'text', text })),
        {
          type: 'usage',
          usage: {
            model: adapter.model,
            tier: 'main',
            inputTokens: EXPECTED.inputTokens,
            outputTokens: EXPECTED.outputTokens,
            costMicroUsd: 0,
          },
        },
      ]);
      expect(mock.requests).toHaveLength(1);
      const req = mock.requests[0]!;
      expect(req.method).toBe('POST');
      expect(target.sentKey(req.headers, key)).toBe(true);
      // The prompt reaches the provider: system, every message, the output cap.
      for (const text of [baseRequest.system, ...baseRequest.messages.map((m) => m.content)]) {
        expect(req.body.includes(text)).toBe(true);
      }
      expect(req.body.includes('256')).toBe(true);
    });

    it('stream(): a tool call comes back under its Edmate name with parsed args', async () => {
      const { adapter, mock } = setup([target.fixtures.toolCallStream]);
      const chunks = await collect(adapter.stream(toolRequest));
      expect(chunks[0]).toEqual({
        type: 'tool_call',
        id: EXPECTED.toolCall.id,
        name: EXPECTED.toolCall.name,
        args: EXPECTED.toolCall.args,
      });
      expect(chunks.at(-1)?.type).toBe('usage');
      expect(chunks).toHaveLength(2);
      // Offered under a provider-safe name; never executed by the adapter.
      expect(mock.requests[0]!.body.includes(`"${EXPECTED.toolCall.wireName}"`)).toBe(true);
      expect(mock.requests).toHaveLength(1);
    });

    it('stream(): a call of a tool never offered is a provider_error', async () => {
      const { adapter } = setup([target.fixtures.unknownToolStream]);
      const err = await caught(collect(adapter.stream(toolRequest)));
      expect(err.code).toBe('provider_error');
      expect(err.retryable).toBe(false);
    });

    it('stream(): a tool call with unparseable args is a provider_error', async () => {
      const { adapter } = setup([target.fixtures.malformedToolStream]);
      const err = await caught(collect(adapter.stream(toolRequest)));
      expect(err.code).toBe('provider_error');
      expect(err.retryable).toBe(false);
    });

    it('stream(): an error after streaming started is mapped, not swallowed', async () => {
      const { adapter, key } = setup([target.fixtures.midStreamError]);
      const err = await caught(collect(adapter.stream(baseRequest)));
      expect(err.code).toBe('provider_error');
      expect(leaks(JSON.stringify(err) + String(err.stack), key)).toBe(false);
    });

    it('stream(): HTTP errors map to GatewayError codes', async () => {
      const cases = [
        [target.fixtures.rateLimited, 'rate_limited', true],
        [target.fixtures.contextTooLong, 'input_too_large', false],
        [target.fixtures.serverError, 'provider_error', true],
      ] as const;
      for (const [fixture, code, retryable] of cases) {
        const { adapter, mock } = setup([fixture]);
        const err = await caught(collect(adapter.stream(baseRequest)));
        expect([err.code, err.retryable]).toEqual([code, retryable]);
        // No SDK retries: the router (task 2.3) decides.
        expect(mock.requests).toHaveLength(1);
      }
    });

    it('generateObject(): returns the schema-checked object', async () => {
      const { adapter, mock, key } = setup([target.fixtures.object]);
      const value = await adapter.generateObject(baseRequest, AnswerSchema);
      expect(value).toEqual(EXPECTED.object);
      expect(target.sentKey(mock.requests[0]!.headers, key)).toBe(true);
    });

    it('generateObject(): output that fails the schema is a validation error', async () => {
      const { adapter, mock } = setup([target.fixtures.badObject]);
      const err = await caught(adapter.generateObject(baseRequest, AnswerSchema));
      expect([err.code, err.retryable]).toEqual(['validation', false]);
      expect(mock.requests).toHaveLength(1);
    });

    it('generateObject(): HTTP errors map to GatewayError codes', async () => {
      const { adapter } = setup([target.fixtures.rateLimited]);
      const err = await caught(adapter.generateObject(baseRequest, AnswerSchema));
      expect([err.code, err.retryable]).toEqual(['rate_limited', true]);
    });

    if (target.capabilities.embeddings) {
      it('embed(): returns one vector per text', async () => {
        const embeddings = target.fixtures.embeddings;
        if (embeddings === undefined) throw new Error('fixture missing: embeddings');
        const { adapter, mock, key } = setup([embeddings]);
        const vectors = await adapter.embed(['one half', 'two thirds']);
        expect(vectors).toEqual(EXPECTED.embeddings);
        expect(target.sentKey(mock.requests[0]!.headers, key)).toBe(true);
      });

      it('embed(): an empty list makes no request', async () => {
        const { adapter, mock } = setup([]);
        expect(await adapter.embed([])).toEqual([]);
        expect(mock.requests).toHaveLength(0);
      });

      it('embed(): HTTP errors map to GatewayError codes', async () => {
        const { adapter } = setup([target.fixtures.serverError]);
        const err = await caught(adapter.embed(['x']));
        expect([err.code, err.retryable]).toEqual(['provider_error', true]);
      });
    } else {
      it('embed(): without an embedding model it fails cleanly and sends nothing', async () => {
        const { adapter, mock } = setup([]);
        const err = await caught(adapter.embed(['x']));
        expect([err.code, err.retryable]).toEqual(['provider_error', false]);
        expect(err.message.startsWith(`${adapter.id}: `)).toBe(true);
        expect(mock.requests).toHaveLength(0);
      });
    }
  });
}
