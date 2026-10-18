import { z } from 'zod';
import { count, tier } from './formats.js';
import { ToolNameSchema, UsageSchema } from './shared.js';

const ModelTargetSchema = z.strictObject({ provider: z.string(), model: z.string() });

// Embeddings are platform-wide config (provider, model, dims), never per agent: changing them
// re-indexes every teacher. So there is no embedding field here.
export const ModelPolicySchema = z.strictObject({
  tiers: z.record(tier(), ModelTargetSchema),
  fallback: ModelTargetSchema.exactOptional(),
});
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;

export const ModelRequestSchema = z.strictObject({
  tier: tier(),
  system: z.string(),
  messages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string() })),
  tools: z
    .array(
      z.strictObject({ name: ToolNameSchema, description: z.string(), inputSchema: z.unknown() }),
    )
    .exactOptional(),
  maxOutputTokens: count(),
  temperature: z.number().exactOptional(),
  cacheKey: z.string().exactOptional(),
});
export type ModelRequest = z.infer<typeof ModelRequestSchema>;

export const ModelChunkSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({
    type: z.literal('tool_call'),
    id: z.string().min(1),
    name: ToolNameSchema,
    args: z.unknown(),
  }),
  z.strictObject({ type: z.literal('usage'), usage: UsageSchema }),
]);
export type ModelChunk = z.infer<typeof ModelChunkSchema>;
