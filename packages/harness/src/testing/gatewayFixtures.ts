// Reusable gateway scripts for harness tests (2.3 fallback, 3.1 pipeline, 3.7 orchestrator).
// Synthetic data only; the chunk shapes are checked against schemas.ModelChunk in fixtures.test.ts.
import { modelChunkToolCall, usageMain, usageSmall } from '@edmate/contracts/fixtures';
import type {
  ScriptedEmbedCall,
  ScriptedObjectCall,
  ScriptedStreamCall,
} from './scriptedGateway.js';

export const scriptedStreamText = {
  steps: [
    { type: 'text', text: 'What do you notice ' },
    { type: 'text', text: 'about the denominators?' },
    { type: 'usage', usage: usageMain },
  ],
} satisfies ScriptedStreamCall;

export const scriptedStreamToolCall = {
  steps: [
    modelChunkToolCall,
    { type: 'text', text: 'The calculator says 5/6.' },
    { type: 'usage', usage: usageMain },
  ],
} satisfies ScriptedStreamCall;

export const scriptedStreamWithDelay = {
  steps: [
    { type: 'text', text: 'Let me think' },
    { type: 'delay', ms: 1500 },
    { type: 'text', text: ' about that.' },
    { type: 'usage', usage: usageMain },
  ],
} satisfies ScriptedStreamCall;

export const scriptedStreamProviderError = {
  steps: [
    { type: 'text', text: 'Partial' },
    { type: 'error', code: 'provider_error' },
  ],
} satisfies ScriptedStreamCall;

export const scriptedObjectIntent = {
  value: { intent: 'question' },
  usage: usageSmall,
} satisfies ScriptedObjectCall;

export const scriptedEmbedPair = {
  vectors: [
    [0.1, 0.2, 0.3],
    [0.3, 0.2, 0.1],
  ],
  usage: usageSmall,
} satisfies ScriptedEmbedCall;
