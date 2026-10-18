// Fixtures for every Core contracts schema. `harness/testing` and the scripted gateway reuse them.
// All data is synthetic (the repo is public): ids like `stu_test_01`, no names, contacts or excerpts.
import type { z } from 'zod';
import * as C from '../src/index.js';
import type { InvalidCase } from './invalid/case.js';
import { invalid as accessInvalid } from './invalid/access.js';
import { invalid as localeInvalid } from './invalid/locale.js';
import { invalid as memoryInvalid } from './invalid/memory.js';
import { invalid as modelInvalid } from './invalid/model.js';
import { invalid as safetyInvalid } from './invalid/safety.js';
import { invalid as sharedInvalid } from './invalid/shared.js';
import { invalid as teacherInvalid } from './invalid/teacher.js';
import { invalid as traceInvalid } from './invalid/trace.js';
import { invalid as turnInvalid } from './invalid/turn.js';
import { valid as accessValid } from './valid/access.js';
import { valid as localeValid } from './valid/locale.js';
import { valid as memoryValid } from './valid/memory.js';
import { valid as modelValid } from './valid/model.js';
import { valid as safetyValid } from './valid/safety.js';
import { valid as sharedValid } from './valid/shared.js';
import { valid as teacherValid } from './valid/teacher.js';
import { valid as traceValid } from './valid/trace.js';
import { valid as turnValid } from './valid/turn.js';

export type { InvalidCase } from './invalid/case.js';

/** Every data schema in Core contracts, by type name. */
export const schemas = {
  Lang: C.LangSchema,
  Skill: C.SkillSchema,
  Money: C.MoneySchema,
  ErrorCode: C.ErrorCodeSchema,
  Usage: C.UsageSchema,
  ToolName: C.ToolNameSchema,
  ModelPolicy: C.ModelPolicySchema,
  ModelRequest: C.ModelRequestSchema,
  ModelChunk: C.ModelChunkSchema,
  AgentConfig: C.AgentConfigSchema,
  StyleCard: C.StyleCardSchema,
  PackageConfig: C.PackageConfigSchema,
  Entitlement: C.EntitlementSchema,
  LocalePack: C.LocalePackSchema,
  LearnerProfile: C.LearnerProfileSchema,
  EvidenceEvent: C.EvidenceEventSchema,
  ChunkKind: C.ChunkKindSchema,
  SourceRef: C.SourceRefSchema,
  Chunk: C.ChunkSchema,
  Attachment: C.AttachmentSchema,
  Message: C.MessageSchema,
  TurnInput: C.TurnInputSchema,
  Intent: C.IntentSchema,
  Attempt: C.AttemptSchema,
  Persona: C.PersonaSchema,
  TurnContext: C.TurnContextSchema,
  PedagogyDecision: C.PedagogyDecisionSchema,
  TeacherQuestion: C.TeacherQuestionSchema,
  TurnEvent: C.TurnEventSchema,
  SafetyAlert: C.SafetyAlertSchema,
  GuardResult: C.GuardResultSchema,
  TurnTrace: C.TurnTraceSchema,
} as const;

export type SchemaName = keyof typeof schemas;

/** Valid values per schema: at least a minimal and a full case, and one per union variant. */
export const validFixtures: {
  readonly [K in SchemaName]: readonly z.infer<(typeof schemas)[K]>[];
} = {
  ...sharedValid,
  ...modelValid,
  ...teacherValid,
  ...accessValid,
  ...localeValid,
  ...memoryValid,
  ...turnValid,
  ...safetyValid,
  ...traceValid,
};

const allInvalid: readonly InvalidCase[] = [
  ...sharedInvalid,
  ...modelInvalid,
  ...teacherInvalid,
  ...accessInvalid,
  ...localeInvalid,
  ...memoryInvalid,
  ...turnInvalid,
  ...safetyInvalid,
  ...traceInvalid,
];

/** Values each schema must reject, by schema name. */
export const invalidFixtures: { readonly [K in SchemaName]: readonly InvalidCase[] } =
  Object.fromEntries(
    Object.keys(schemas).map((name) => [name, allInvalid.filter((c) => c.schema === name)]),
  ) as { [K in SchemaName]: InvalidCase[] };

/** Cases whose `schema` names no schema (a typo); the registry test requires this to be empty. */
export const unknownInvalidCases: readonly InvalidCase[] = allInvalid.filter(
  (c) => !(c.schema in schemas),
);

export {
  demoEntitlementEval,
  demoEntitlementPreview,
  demoEntitlementSubscription,
} from './valid/access.js';
export { demoLocalePack, localePackMinimal } from './valid/locale.js';
export { demoLearnerProfile, evidenceCheck, learnerProfileNew } from './valid/memory.js';
export {
  modelChunkText,
  modelChunkToolCall,
  modelChunkUsage,
  modelPolicyFull,
  modelPolicyMinimal,
  modelRequestFull,
  modelRequestMinimal,
} from './valid/model.js';
export {
  demoSafetyAlert,
  guardBlock,
  guardEscalate,
  guardOk,
  guardRewrite,
} from './valid/safety.js';
export { moneyFree, moneyPaid, usageMain, usageSmall } from './valid/shared.js';
export {
  demoAgentConfig,
  demoPackageFree,
  demoPackagePaid,
  demoStyleCard,
} from './valid/teacher.js';
export { demoTurnTrace } from './valid/trace.js';
export {
  demoAttachment,
  demoChunk,
  demoChunkScored,
  demoPedagogyDecision,
  demoPersona,
  demoTurnContext,
  demoTurnInput,
  messageAgent,
  messageStudent,
  sourceMaterial,
  teacherQuestionAnswered,
  teacherQuestionOpen,
  turnContextFull,
  turnEvents,
  turnInputHint,
  turnInputSkillAction,
} from './valid/turn.js';
