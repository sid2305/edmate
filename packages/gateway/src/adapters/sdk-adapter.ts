// The ModelGateway port over any AI SDK provider. Each provider file only builds the AI SDK
// models (with the revealed key) and declares capabilities; this file does the rest, so a
// third provider is one more small file and no caller changes.
//
// Retries and fallback are the router's job (task 2.3), so the SDK's own retries are off.
// The SDK's default onError logs to the console; it is replaced so nothing is logged here.
import type { ModelChunk, ModelRequest } from '@edmate/contracts';
import {
  type EmbeddingModel,
  type JSONSchema7,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
  embedMany,
  generateText,
  jsonSchema,
  Output,
  streamText,
  tool,
} from 'ai';
import type { ZodType } from 'zod';
import type { ProviderId } from '../keys/providers.js';
import { GatewayError, mapProviderError } from './errors.js';
import type { AdapterCapabilities, ModelAdapter } from './types.js';

export interface SdkAdapterParts {
  readonly id: ProviderId;
  readonly model: string;
  readonly languageModel: LanguageModel;
  /** Absent when the provider (or this deployment) has no embedding model. */
  readonly embeddingModel?: EmbeddingModel;
  readonly capabilities: AdapterCapabilities;
}

// Providers accept tool names matching this; Edmate's names may contain dots (practice.next_item).
const WIRE_NAME_UNSAFE = /[^A-Za-z0-9_-]/g;
const WIRE_NAME_MAX = 64;

interface Tools {
  readonly set: ToolSet | undefined;
  /** Wire name -> Edmate tool name. */
  readonly names: ReadonlyMap<string, string>;
}

/** Offers tools under provider-safe names; the model's calls are mapped back. Never executed here. */
function toTools(tools: ModelRequest['tools']): Tools {
  const names = new Map<string, string>();
  if (tools === undefined || tools.length === 0) return { set: undefined, names };
  const set: ToolSet = {};
  for (const t of tools) {
    const base = t.name.replace(WIRE_NAME_UNSAFE, '_').slice(0, WIRE_NAME_MAX);
    let wire = base;
    for (let n = 2; names.has(wire); n += 1) {
      const suffix = `_${n}`;
      wire = base.slice(0, WIRE_NAME_MAX - suffix.length) + suffix;
    }
    names.set(wire, t.name);
    set[wire] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema as JSONSchema7),
    });
  }
  return { set, names };
}

function toMessages(messages: ModelRequest['messages']): ModelMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function callSettings(req: ModelRequest) {
  return {
    instructions: req.system,
    messages: toMessages(req.messages),
    maxOutputTokens: req.maxOutputTokens,
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    maxRetries: 0,
  };
}

function tokens(n: number | undefined): number {
  return n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export function createSdkAdapter(parts: SdkAdapterParts): ModelAdapter {
  const { id, model, languageModel, embeddingModel, capabilities } = parts;
  const fail = (code: GatewayError['code'], retryable: boolean, what: string) =>
    new GatewayError(code, retryable, id, `${id}: ${what}`);

  async function* stream(req: ModelRequest): AsyncIterable<ModelChunk> {
    const tools = toTools(req.tools);
    let usage: LanguageModelUsage | undefined;
    try {
      const result = streamText({
        model: languageModel,
        ...callSettings(req),
        ...(tools.set === undefined ? {} : { tools: tools.set }),
        onError: () => {},
      });
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            yield { type: 'text', text: part.text };
            break;
          case 'tool-call': {
            const name = tools.names.get(part.toolName);
            if (name === undefined || part.invalid === true) {
              throw fail(
                'provider_error',
                false,
                'model returned an unknown or malformed tool call',
              );
            }
            yield { type: 'tool_call', id: part.toolCallId, name, args: part.input };
            break;
          }
          case 'finish':
            usage = part.totalUsage;
            break;
          case 'error':
            throw part.error;
          // No abort signal or SDK timeout is passed, so there is no 'abort' part; the
          // rest (step and block markers, reasoning) carry nothing the port has.
          default:
            break;
        }
      }
    } catch (err) {
      throw mapProviderError(err, id);
    }
    yield {
      type: 'usage',
      usage: {
        model,
        tier: req.tier,
        inputTokens: tokens(usage?.inputTokens),
        outputTokens: tokens(usage?.outputTokens),
        // Priced by metering (task 2.4), not here.
        costMicroUsd: 0,
      },
    };
  }

  async function generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> {
    try {
      const result = await generateText({
        model: languageModel,
        ...callSettings(req),
        output: Output.object({ schema }),
      });
      return result.output as T;
    } catch (err) {
      throw mapProviderError(err, id);
    }
  }

  async function embed(texts: string[]): Promise<number[][]> {
    if (embeddingModel === undefined) {
      throw fail(
        'provider_error',
        false,
        'no embedding model configured; embeddings are platform-wide config (task 2.7)',
      );
    }
    if (texts.length === 0) return [];
    try {
      const result = await embedMany({ model: embeddingModel, values: texts, maxRetries: 0 });
      return result.embeddings;
    } catch (err) {
      throw mapProviderError(err, id);
    }
  }

  return Object.freeze({
    id,
    model,
    capabilities: Object.freeze({ ...capabilities }),
    stream,
    generateObject,
    embed,
  });
}
