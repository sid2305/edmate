// What every provider's fixtures encode, so one contract suite can check any adapter.
// Fixtures are hand-built from each provider's public API shape, never recorded (rule 4).
import type { FakeResponse } from '../helpers/fetch-mock.js';

export const EXPECTED = {
  textDeltas: ['Hello', ', world'],
  inputTokens: 25,
  outputTokens: 15,
  toolCall: {
    id: 'call_1',
    /** Edmate's name; the wire name has the dot replaced. */
    name: 'practice.next_item',
    wireName: 'practice_next_item',
    args: { topic: 'fractions' },
  },
  object: { answer: 42 },
  embeddings: [
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
  ],
} as const;

export interface ContractFixtures {
  /** Streams EXPECTED.textDeltas, then usage EXPECTED.inputTokens / outputTokens. */
  readonly textStream: FakeResponse;
  /** Streams one call of EXPECTED.toolCall under its wire name. */
  readonly toolCallStream: FakeResponse;
  /** Streams a call of a tool that was never offered. */
  readonly unknownToolStream: FakeResponse;
  /** Streams a call of an offered tool whose arguments are not JSON. */
  readonly malformedToolStream: FakeResponse;
  /** Streams some text, then an in-stream error event. */
  readonly midStreamError: FakeResponse;
  /** A non-streamed reply holding EXPECTED.object as JSON. */
  readonly object: FakeResponse;
  /** A non-streamed reply whose JSON does not fit the schema. */
  readonly badObject: FakeResponse;
  /** EXPECTED.embeddings; only for adapters that declare embeddings. */
  readonly embeddings?: FakeResponse;
  readonly rateLimited: FakeResponse;
  readonly contextTooLong: FakeResponse;
  readonly serverError: FakeResponse;
}
