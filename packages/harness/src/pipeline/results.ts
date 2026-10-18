// Runtime checks on what each step returns. A result that fails its schema counts as the step
// failing, so a buggy step hits its failure policy instead of passing bad data along. Guard
// entries are strict (no `reason` text), so no step can smuggle text into the trace (ADR-0003).
import {
  AgentConfigSchema,
  AttemptSchema,
  ChunkSchema,
  EntitlementSchema,
  IntentSchema,
  LearnerProfileSchema,
  LocalePackSchema,
  MessageSchema,
  PackageConfigSchema,
  PersonaSchema,
  SafetyAlertSchema,
  StyleCardSchema,
  TurnContextSchema,
  TurnTraceSchema,
  UsageSchema,
} from '@edmate/contracts';
import { z } from 'zod';
import type {
  BuiltContext,
  Entitled,
  EscalateResult,
  GenerateResult,
  PostGuardResult,
  PreGuardResult,
  RouteResult,
  Scrubbed,
} from './types.js';

const guards = TurnTraceSchema.shape.guards;
const usage = z.array(UsageSchema);

export const EntitledSchema: z.ZodType<Entitled> = z.strictObject({
  entitlement: EntitlementSchema,
  agent: AgentConfigSchema,
  pkg: PackageConfigSchema,
  locale: LocalePackSchema,
  styleCard: StyleCardSchema,
});

export const ScrubbedSchema: z.ZodType<Scrubbed> = z.strictObject({
  text: z.string().exactOptional(),
  guards,
});

export const PreGuardResultSchema: z.ZodType<PreGuardResult> = z.discriminatedUnion('result', [
  z.strictObject({ result: z.literal(['ok', 'block']), guards, usage }),
  z.strictObject({ result: z.literal('escalate'), alert: SafetyAlertSchema, guards, usage }),
]);

export const RouteResultSchema: z.ZodType<RouteResult> = z.strictObject({
  intent: IntentSchema,
  attempt: AttemptSchema,
  usage,
});

export const RouteFallbackSchema = z.strictObject({ intent: IntentSchema, attempt: AttemptSchema });

export const BuiltContextSchema: z.ZodType<BuiltContext> = z.strictObject({
  profile: LearnerProfileSchema,
  history: z.array(MessageSchema),
  retrieved: z.array(ChunkSchema),
  lockedHit: z.boolean(),
  persona: PersonaSchema.exactOptional(),
  helpRung: TurnContextSchema.shape.helpRung,
});

export const EscalateResultSchema: z.ZodType<EscalateResult> = z.strictObject({
  replyText: z.string(),
  alert: SafetyAlertSchema.exactOptional(),
});

export const GenerateResultSchema: z.ZodType<GenerateResult> = z.strictObject({
  draft: z.string(),
  usage,
});

export const PostGuardResultSchema: z.ZodType<PostGuardResult> = z.discriminatedUnion('result', [
  z.strictObject({ result: z.literal('ok'), guards, usage }),
  z.strictObject({ result: z.literal('replace'), text: z.string(), guards, usage }),
]);
