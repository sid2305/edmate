// OpenAI-style chat completions / embeddings shapes (as served by OpenRouter and self-hosted
// servers), from the public docs.
import { sse } from '../helpers/fetch-mock.js';
import { type ContractFixtures, EXPECTED } from './contract.js';

const MODEL = 'compatible-fixture';

const chunk = (delta: unknown, finishReason: string | null = null) =>
  [
    undefined,
    {
      id: 'chatcmpl-fixture',
      object: 'chat.completion.chunk',
      created: 0,
      model: MODEL,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    },
  ] as const;

const usageChunk = [
  undefined,
  {
    id: 'chatcmpl-fixture',
    object: 'chat.completion.chunk',
    created: 0,
    model: MODEL,
    choices: [],
    usage: {
      prompt_tokens: EXPECTED.inputTokens,
      completion_tokens: EXPECTED.outputTokens,
      total_tokens: EXPECTED.inputTokens + EXPECTED.outputTokens,
    },
  },
] as const;

const done = [undefined, '[DONE]'] as const;

function toolStream(name: string, args: string): string {
  return sse([
    chunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: EXPECTED.toolCall.id,
          type: 'function',
          function: { name, arguments: '' },
        },
      ],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }),
    chunk({}, 'tool_calls'),
    usageChunk,
    done,
  ]);
}

function completion(content: string, finishReason = 'stop'): string {
  return JSON.stringify({
    id: 'chatcmpl-fixture',
    object: 'chat.completion',
    created: 0,
    model: MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: {
      prompt_tokens: EXPECTED.inputTokens,
      completion_tokens: EXPECTED.outputTokens,
      total_tokens: EXPECTED.inputTokens + EXPECTED.outputTokens,
    },
  });
}

const errorBody = (code: string, message: string) =>
  JSON.stringify({ error: { message, type: 'invalid_request_error', code } });

function textStream(finishReason: string): string {
  return sse([
    chunk({ role: 'assistant', content: EXPECTED.textDeltas[0] }),
    chunk({ content: EXPECTED.textDeltas[1] }),
    chunk({}, finishReason),
    usageChunk,
    done,
  ]);
}

export const openAICompatibleFixtures: ContractFixtures = {
  textStream: { body: textStream('stop') },
  truncatedStream: { body: textStream('length') },
  filteredStream: { body: textStream('content_filter') },
  toolCallStream: {
    body: toolStream(EXPECTED.toolCall.wireName, JSON.stringify(EXPECTED.toolCall.args)),
  },
  unknownToolStream: { body: toolStream('not_offered', '{}') },
  malformedToolStream: { body: toolStream(EXPECTED.toolCall.wireName, '{"topic": fra') },
  midStreamError: {
    body: sse([
      chunk({ role: 'assistant', content: 'Hel' }),
      [undefined, { error: { message: 'upstream overloaded', code: 502 } }],
    ]),
  },
  object: { body: completion(JSON.stringify(EXPECTED.object)) },
  badObject: { body: completion(JSON.stringify({ answer: 'forty-two' })) },
  truncatedObject: { body: completion('{"answ', 'length') },
  truncatedValidObject: { body: completion(JSON.stringify(EXPECTED.object), 'length') },
  filteredObject: { body: completion('', 'content_filter') },
  embeddings: {
    body: JSON.stringify({
      object: 'list',
      data: EXPECTED.embeddings.map((embedding, index) => ({
        object: 'embedding',
        index,
        embedding,
      })),
      model: 'embed-fixture',
      usage: { prompt_tokens: 4, total_tokens: 4 },
    }),
  },
  rateLimited: { status: 429, body: errorBody('rate_limit_exceeded', 'Rate limit reached') },
  contextTooLong: {
    status: 400,
    body: errorBody(
      'context_length_exceeded',
      "This model's maximum context length is 8192 tokens.",
    ),
  },
  serverError: { status: 500, body: errorBody('server_error', 'The server had an error') },
};
