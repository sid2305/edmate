import type { ModelChunk, ModelPolicy, ModelRequest } from '../../src/index.js';
import { usageMain } from './shared.js';

export const modelPolicyMinimal = {
  tiers: {
    small: { provider: 'test-provider', model: 'test-small-model' },
    main: { provider: 'test-provider', model: 'test-main-model' },
  },
} satisfies ModelPolicy;

export const modelPolicyFull = {
  ...modelPolicyMinimal,
  fallback: { provider: 'test-fallback-provider', model: 'test-fallback-model' },
} satisfies ModelPolicy;

export const modelRequestMinimal = {
  tier: 'small',
  system: 'Classify the intent of the student message.',
  messages: [{ role: 'user', content: 'What is 7 times 8?' }],
  maxOutputTokens: 16,
} satisfies ModelRequest;

export const modelRequestFull = {
  tier: 'main',
  system: 'You are a patient tutor. Ask before you tell.',
  messages: [
    { role: 'user', content: 'How do I add fractions?' },
    { role: 'assistant', content: 'What do you notice about the denominators?' },
    { role: 'user', content: 'They are different.' },
  ],
  tools: [
    {
      name: 'calculator',
      description: 'Evaluates an arithmetic expression.',
      inputSchema: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
    },
  ],
  maxOutputTokens: 600,
  temperature: 0.2,
  cacheKey: 'agt_test_01:v3',
} satisfies ModelRequest;

export const modelChunkText = { type: 'text', text: 'What do you notice' } satisfies ModelChunk;
export const modelChunkToolCall = {
  type: 'tool_call',
  id: 'call_test_01',
  name: 'calculator',
  args: { expression: '1/2 + 1/3' },
} satisfies ModelChunk;
export const modelChunkUsage = { type: 'usage', usage: usageMain } satisfies ModelChunk;

export const valid = {
  ModelPolicy: [modelPolicyMinimal, modelPolicyFull],
  ModelRequest: [modelRequestMinimal, modelRequestFull],
  ModelChunk: [modelChunkText, modelChunkToolCall, modelChunkUsage],
};
