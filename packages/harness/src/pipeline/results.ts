// Runtime checks on what each step returns. A result that fails its schema counts as the step
// failing, so a buggy step hits its failure policy instead of passing bad data along. Guard
// entries are strict (no `reason` text), so no step can smuggle text into the trace (ADR-0003).
import {
  AgentConfigSchema,
  LIMITS,
  AttemptSchema,
  ChunkSchema,
  EntitlementSchema,
  IntentSchema,
  LearnerProfileSchema,
  LocalePackSchema,
  MessageSchema,
  PackageConfigSchema,
  PedagogyDecisionSchema,
  PersonaSchema,
  SafetyAlertSchema,
  SafetyEventCodeSchema,
  SkillSchema,
  SourceRefSchema,
  StyleCardSchema,
  TurnContextSchema,
  TurnTraceSchema,
  UsageSchema,
} from '@edmate/contracts';
import { z } from 'zod';
import { HelpStateSchema } from '../pedagogy/helpState.js';
import type { PolicyReason } from '../pedagogy/policy.js';
import type { RolePlay } from '../pedagogy/roleplay.js';
import type {
  BuiltContext,
  DecideResult,
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
  helpState: z.unknown().optional(),
});

export const ScrubbedSchema: z.ZodType<Scrubbed> = z.strictObject({
  text: z.string().exactOptional(),
  skillPayload: z.unknown().exactOptional(),
  guards,
});

export const PreGuardResultSchema: z.ZodType<PreGuardResult> = z.discriminatedUnion('result', [
  z.strictObject({ result: z.literal('ok'), guards, usage }),
  z.strictObject({
    result: z.literal('block'),
    guards,
    usage,
    reply: z.string().min(1).exactOptional(),
    alert: SafetyAlertSchema.exactOptional(),
    code: SafetyEventCodeSchema.exclude(['self_harm']).exactOptional(),
  }),
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
  helpState: HelpStateSchema,
  helpStateUnreadable: z.literal(true).exactOptional(),
  answerKeyDropped: z.int().min(1).exactOptional(),
});

export const EscalateResultSchema: z.ZodType<EscalateResult> = z.strictObject({
  replyText: z.string(),
  alert: SafetyAlertSchema.exactOptional(),
});

export const GenerateResultSchema: z.ZodType<GenerateResult> = z.strictObject({
  draft: z.string().max(LIMITS.modelTextMaxLength),
  raw: z.string().max(LIMITS.modelTextMaxLength).exactOptional(),
  withheld: z.boolean().exactOptional(),
  locked: z.enum(['hit', 'failed']).exactOptional(),
  held: z.boolean().exactOptional(),
  practiceAnswerKey: z.array(z.string()).readonly().exactOptional(),
});

export const PostGuardResultSchema: z.ZodType<PostGuardResult> = z.discriminatedUnion('result', [
  z.strictObject({ result: z.literal('ok'), guards, usage }),
  z.strictObject({
    result: z.literal('replace'),
    text: z.string(),
    escalateToTeacher: z.literal(true).exactOptional(),
    groundingRewrote: z.literal(true).exactOptional(),
    guards,
    usage,
  }),
  z.strictObject({
    result: z.literal('escalate'),
    alert: SafetyAlertSchema,
    text: z.string(),
    guards,
    usage,
  }),
]);

/** Every PolicyReason; the Record type makes the compiler reject a missing or extra one. */
const POLICY_REASONS: Record<PolicyReason, true> = {
  explain: true,
  explain_check: true,
  practice_item: true,
  feedback: true,
  mock_interview: true,
  revision: true,
  skill_not_built: true,
  no_persona: true,
  pending_check: true,
  solved: true,
  step: true,
  climb: true,
  at_ceiling: true,
  solution_gated: true,
  no_progress_once: true,
  distress: true,
  skill_not_entitled: true,
  off_topic: true,
  misuse: true,
  meta: true,
  locked_module: true,
  not_covered: true,
  fallback: true,
};

/**
 * `PolicyResult.rolePlay` (13.skillpresent), checked here so a buggy policy value counts as
 * decide failing, like every other guard entry. Not a `z.discriminatedUnion`: its `question` /
 * `pause` / `resume` member shares one shape across three `phase` literals (pedagogy/roleplay.ts).
 */
const RolePlaySchema: z.ZodType<RolePlay> = z.union([
  z.strictObject({
    phase: z.enum(['question', 'pause', 'resume']),
    question: z.int().min(0),
    total: z.int().min(1),
  }),
  z.strictObject({ phase: z.literal('debrief'), total: z.int().min(1) }),
  z.strictObject({ phase: z.literal('stopped'), answered: z.int().min(0) }),
  z.strictObject({ phase: z.literal('ended') }),
]);

export const DecideResultSchema: z.ZodType<DecideResult> = z.strictObject({
  decision: PedagogyDecisionSchema,
  next: z.strictObject({ rung: TurnContextSchema.shape.helpRung, help: HelpStateSchema }),
  reason: z.enum(Object.keys(POLICY_REASONS) as [PolicyReason, ...PolicyReason[]]),
  promptPack: z.strictObject({ set: z.string().min(1), packs: z.record(z.string(), z.string()) }),
  sources: z.array(SourceRefSchema),
  // 13.skillpresent: PolicyResult.skill/.rolePlay ride alongside `decision` (never inside it, so
  // PedagogyDecision stays byte-identical); generate reads them to emit the harness-computed
  // progress `skill` event with no new model-callable tool.
  skill: SkillSchema.nullable().exactOptional(),
  rolePlay: RolePlaySchema.exactOptional(),
});
