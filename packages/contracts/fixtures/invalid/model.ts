import {
  modelChunkToolCall,
  modelPolicyMinimal,
  modelRequestFull,
  modelRequestMinimal,
} from '../valid/model.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  {
    schema: 'ModelPolicy',
    name: 'missing the main tier',
    value: { tiers: { small: modelPolicyMinimal.tiers.small } },
    path: ['tiers', 'main'],
  },
  {
    schema: 'ModelPolicy',
    name: 'per-agent embeddings are not allowed',
    value: {
      ...modelPolicyMinimal,
      embeddings: { provider: 'test-provider', model: 'test-embed' },
    },
    path: [],
  },
  {
    schema: 'ModelRequest',
    name: 'system role inside messages',
    value: { ...modelRequestMinimal, messages: [{ role: 'system', content: 'x' }] },
    path: ['messages', 0, 'role'],
  },
  {
    schema: 'ModelRequest',
    name: 'float maxOutputTokens',
    value: { ...modelRequestMinimal, maxOutputTokens: 1.5 },
    path: ['maxOutputTokens'],
  },
  {
    schema: 'ModelRequest',
    name: 'explicit undefined for an optional key',
    value: { ...modelRequestFull, temperature: undefined },
    path: ['temperature'],
  },
  {
    schema: 'ModelChunk',
    name: 'unknown chunk type',
    value: { type: 'image', data: '' },
    path: ['type'],
  },
  {
    schema: 'ModelChunk',
    name: 'tool_call without id',
    value: { ...modelChunkToolCall, id: '' },
    path: ['id'],
  },
];
