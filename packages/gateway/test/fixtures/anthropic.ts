// Anthropic Messages API shapes (SSE for streams, JSON otherwise), from the public docs.
import { sse } from '../helpers/fetch-mock.js';
import { type ContractFixtures, EXPECTED } from './contract.js';

const MODEL = 'claude-fixture';

const messageStart = [
  'message_start',
  {
    type: 'message_start',
    message: {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      model: MODEL,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: EXPECTED.inputTokens, output_tokens: 1 },
    },
  },
] as const;

const messageEnd = (stopReason: string) =>
  [
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: EXPECTED.outputTokens },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ] as const;

function toolStream(name: string, partialJson: string): string {
  return sse([
    messageStart,
    [
      'content_block_start',
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: EXPECTED.toolCall.id, name, input: {} },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: partialJson },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ...messageEnd('tool_use'),
  ]);
}

function message(text: string, stopReason = 'end_turn'): string {
  return JSON.stringify({
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: EXPECTED.inputTokens, output_tokens: EXPECTED.outputTokens },
  });
}

const errorBody = (type: string, msg: string) =>
  JSON.stringify({ type: 'error', error: { type, message: msg } });

function textStream(stopReason: string): string {
  return sse([
    messageStart,
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    ...EXPECTED.textDeltas.map(
      (text) =>
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        ] as const,
    ),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ...messageEnd(stopReason),
  ]);
}

export const anthropicFixtures: ContractFixtures = {
  textStream: { body: textStream('end_turn') },
  truncatedStream: { body: textStream('max_tokens') },
  filteredStream: { body: textStream('refusal') },
  toolCallStream: {
    body: toolStream(EXPECTED.toolCall.wireName, JSON.stringify(EXPECTED.toolCall.args)),
  },
  unknownToolStream: { body: toolStream('not_offered', '{}') },
  malformedToolStream: { body: toolStream(EXPECTED.toolCall.wireName, '{"topic": fra') },
  midStreamError: {
    body: sse([
      messageStart,
      [
        'content_block_start',
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      ],
      ['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
    ]),
  },
  object: { body: message(JSON.stringify(EXPECTED.object)) },
  badObject: { body: message(JSON.stringify({ answer: 'forty-two' })) },
  truncatedObject: { body: message('{"answ', 'max_tokens') },
  truncatedValidObject: { body: message(JSON.stringify(EXPECTED.object), 'max_tokens') },
  filteredObject: { body: message('I cannot help with that.', 'refusal') },
  rateLimited: { status: 429, body: errorBody('rate_limit_error', 'Number of requests exceeded') },
  contextTooLong: {
    status: 400,
    body: errorBody('invalid_request_error', 'prompt is too long: 210000 tokens > 200000 maximum'),
  },
  serverError: { status: 500, body: errorBody('api_error', 'Internal server error') },
};
