import { z } from 'zod';
import { EntitlementSchema } from './access.js';
import { count, id, timestamp } from './formats.js';
import { countChars, LIMITS } from './limits.js';
import { LocalePackSchema } from './locale.js';
import { LearnerProfileSchema } from './memory.js';
import { AgentConfigSchema, PackageConfigSchema, StyleCardSchema } from './teacher.js';
import { ErrorCodeSchema, LangSchema, SkillSchema, ToolNameSchema, UsageSchema } from './shared.js';

const rung = () => z.literal([0, 1, 2, 3, 4]);

/** Teacher notes are the teacher's answers and corrections; retrieval ranks them first. */
export const ChunkKindSchema = z.enum(['material', 'transcript', 'teacher_note']);
export type ChunkKind = z.infer<typeof ChunkKindSchema>;

export const SourceRefSchema = z.strictObject({
  title: z.string(),
  /** Page, slide, heading or timestamp. */
  locator: z.string(),
  kind: ChunkKindSchema,
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ChunkSchema = z.strictObject({
  id: id(),
  teacherId: id(),
  documentId: id(),
  moduleId: id(),
  kind: ChunkKindSchema,
  text: z.string(),
  source: SourceRefSchema,
  score: z.number().exactOptional(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

/** P1: a photo of written work. */
export const AttachmentSchema = z.strictObject({
  kind: z.literal('image'),
  mime: z.string().regex(/^image\/.+/, 'an image/* MIME type'),
  storageKey: z.string(),
  bytes: count(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const MessageSchema = z.strictObject({
  id: id(),
  role: z.enum(['student', 'agent', 'teacher']),
  text: z.string(),
  createdAt: timestamp(),
  sources: z.array(SourceRefSchema).exactOptional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const TurnInputSchema = z
  .strictObject({
    // Pseudonymous ids only.
    agentId: id(),
    sessionId: id(),
    studentId: id(),
    kind: z.enum(['message', 'hint_request', 'check_answer', 'skill_action']),
    text: z
      .string()
      .refine(
        (t) => countChars(t) <= LIMITS.turnTextMaxChars,
        `at most ${LIMITS.turnTextMaxChars} characters`,
      )
      .exactOptional(),
    skill: SkillSchema.exactOptional(),
    skillPayload: z.unknown().exactOptional(),
    attachments: z.array(AttachmentSchema).max(LIMITS.turnAttachmentsMax).exactOptional(),
    lang: LangSchema,
    clientTs: timestamp(),
  })
  .superRefine((t, ctx) => {
    if (t.kind === 'message' && t.text === undefined) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'required when kind is "message"' });
    }
    if (t.kind === 'skill_action' && t.skill === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['skill'],
        message: 'required when kind is "skill_action"',
      });
    }
  });
export type TurnInput = z.infer<typeof TurnInputSchema>;

export const IntentSchema = z.enum([
  'on_task',
  'answer_seeking',
  'off_topic',
  'distress',
  'misuse',
  'meta',
]);
export type Intent = z.infer<typeof IntentSchema>;

/** From `route`; drives the help ladder. */
export const AttemptSchema = z.enum(['none', 'wrong', 'partial', 'correct']);
export type Attempt = z.infer<typeof AttemptSchema>;

export const PersonaSchema = z.strictObject({
  id: id(),
  name: z.string(),
  style: z.string(),
  mustNot: z.array(z.string()),
  endAfterQuestions: count(),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const TurnContextSchema = z.strictObject({
  agent: AgentConfigSchema,
  pkg: PackageConfigSchema,
  entitlement: EntitlementSchema,
  profile: LearnerProfileSchema,
  locale: LocalePackSchema,
  styleCard: StyleCardSchema,
  history: z.array(MessageSchema),
  retrieved: z.array(ChunkSchema),
  /** The question matches a locked module (code-only probe; locked text never enters a prompt). */
  lockedHit: z.boolean(),
  persona: PersonaSchema.exactOptional(),
  helpRung: rung(),
  intent: IntentSchema,
  attempt: AttemptSchema,
});
export type TurnContext = z.infer<typeof TurnContextSchema>;

export const PedagogyDecisionSchema = z.strictObject({
  move: z.enum([
    'ask',
    'hint',
    'worked_example',
    'explain',
    'solution',
    'redirect',
    'check',
    'locked',
    'ask_teacher',
  ]),
  rung: rung(),
  mustNotReveal: z.array(z.string()),
  systemPrompt: z.string(),
  tools: z.array(ToolNameSchema),
  maxOutputTokens: count(),
});
export type PedagogyDecision = z.infer<typeof PedagogyDecisionSchema>;

/** Created by the `ask_teacher` move. The student's identity is hidden from the teacher by default. */
export const TeacherQuestionSchema = z.strictObject({
  id: id(),
  teacherId: id(),
  agentId: id(),
  studentId: id(),
  text: z.string(),
  moduleHint: z.string().exactOptional(),
  similarIds: z.array(id()),
  status: z.enum(['open', 'answered', 'dismissed']),
  createdAt: timestamp(),
  answeredAt: timestamp().exactOptional(),
});
export type TeacherQuestion = z.infer<typeof TeacherQuestionSchema>;

export const TurnEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('token'), text: z.string() }),
  z.strictObject({ type: z.literal('sources'), items: z.array(SourceRefSchema) }),
  // The spec types `rung` as number; at runtime it must be a rung (lead answer Q2).
  z.strictObject({
    type: z.literal('hint_rung'),
    rung: z.int().min(LIMITS.helpRungMin).max(LIMITS.helpRungMax),
  }),
  z.strictObject({ type: z.literal('locked'), packageName: z.string().exactOptional() }),
  z.strictObject({ type: z.literal('teacher_question'), questionId: id() }),
  // Practice items, interview state: structured, not tokens.
  z.strictObject({ type: z.literal('skill'), skill: SkillSchema, payload: z.unknown() }),
  z.strictObject({ type: z.literal('safety'), level: z.enum(['info', 'alert']) }),
  z.strictObject({ type: z.literal('replace'), text: z.string() }),
  z.strictObject({ type: z.literal('done'), messageId: id(), usage: z.array(UsageSchema) }),
  z.strictObject({ type: z.literal('error'), code: ErrorCodeSchema, retryable: z.boolean() }),
]);
export type TurnEvent = z.infer<typeof TurnEventSchema>;
