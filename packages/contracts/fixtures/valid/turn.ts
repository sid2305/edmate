import type {
  Attachment,
  Attempt,
  Chunk,
  ChunkKind,
  Intent,
  Message,
  PedagogyDecision,
  Persona,
  SourceRef,
  TeacherQuestion,
  TurnContext,
  TurnEvent,
  TurnInput,
} from '../../src/index.js';
import { demoEntitlementPreview, demoEntitlementSubscription } from './access.js';
import { demoLocalePack } from './locale.js';
import { demoLearnerProfile, learnerProfileNew } from './memory.js';
import { usageMain, usageSmall } from './shared.js';
import { demoAgentConfig, demoPackageFree, demoPackagePaid, demoStyleCard } from './teacher.js';

export const chunkKinds = [
  'material',
  'transcript',
  'teacher_note',
] as const satisfies readonly ChunkKind[];

export const sourceMaterial = {
  title: 'Fractions handout',
  locator: 'p. 3',
  kind: 'material',
} satisfies SourceRef;
export const sourceTranscript = {
  title: 'Live class 2',
  locator: '00:14:05',
  kind: 'transcript',
} satisfies SourceRef;
export const sourceTeacherNote = {
  title: 'Teacher note',
  locator: 'Adding fractions',
  kind: 'teacher_note',
} satisfies SourceRef;

export const demoChunk = {
  id: 'chk_test_01',
  teacherId: 'tch_test_01',
  documentId: 'doc_test_01',
  moduleId: 'mod_test_01',
  kind: 'material',
  text: 'To add fractions, first rewrite them with a common denominator.',
  source: sourceMaterial,
} satisfies Chunk;

export const demoChunkScored = {
  ...demoChunk,
  id: 'chk_test_02',
  kind: 'teacher_note',
  source: sourceTeacherNote,
  score: 0.82,
} satisfies Chunk;

export const demoAttachment = {
  kind: 'image',
  mime: 'image/png',
  storageKey: 'test/uploads/att_test_01.png',
  bytes: 204800,
} satisfies Attachment;

export const messageStudent = {
  id: 'msg_test_01',
  role: 'student',
  text: 'How do I add 1/2 and 1/3?',
  createdAt: '2026-10-17T10:00:00Z',
} satisfies Message;

export const messageAgent = {
  id: 'msg_test_02',
  role: 'agent',
  text: 'What could both denominators divide into?',
  createdAt: '2026-10-17T10:00:02Z',
  sources: [sourceMaterial, sourceTranscript],
} satisfies Message;

export const messageTeacher = {
  id: 'msg_test_03',
  role: 'teacher',
  text: 'Good question. Try listing multiples of 2 and 3.',
  createdAt: '2026-10-17T11:00:00Z',
  sources: [],
} satisfies Message;

export const demoTurnInput = {
  agentId: 'agt_test_01',
  sessionId: 'ses_test_01',
  studentId: 'stu_test_01',
  kind: 'message',
  text: 'How do I add 1/2 and 1/3?',
  lang: 'en',
  clientTs: '2026-10-17T10:00:00Z',
} satisfies TurnInput;

export const turnInputHint = {
  agentId: 'agt_test_01',
  sessionId: 'ses_test_01',
  studentId: 'stu_test_01',
  kind: 'hint_request',
  lang: 'en',
  clientTs: '2026-10-17T10:01:00Z',
} satisfies TurnInput;

export const turnInputSkillAction = {
  agentId: 'agt_test_01',
  sessionId: 'ses_test_01',
  studentId: 'stu_test_01',
  kind: 'skill_action',
  text: '5/6',
  skill: 'practice',
  skillPayload: { itemId: 'itm_test_01', answer: '5/6' },
  attachments: [
    demoAttachment,
    { ...demoAttachment, mime: 'image/jpeg', storageKey: 'test/uploads/att_test_02.jpg' },
  ],
  lang: 'hi',
  clientTs: '2026-10-17T10:02:00+05:30',
} satisfies TurnInput;

/** Exactly at the limit: 4,000 characters, counted as code points (each emoji is one). */
export const turnInputAtLimit = {
  ...demoTurnInput,
  kind: 'check_answer',
  text: '🙂'.repeat(4000),
} satisfies TurnInput;

export const intents = [
  'on_task',
  'answer_seeking',
  'off_topic',
  'distress',
  'misuse',
  'meta',
] as const satisfies readonly Intent[];
export const attempts = [
  'none',
  'wrong',
  'partial',
  'correct',
] as const satisfies readonly Attempt[];

export const demoPersona = {
  id: 'per_test_01',
  name: 'Interviewer',
  style: 'Formal, one question at a time.',
  mustNot: ['give feedback mid-interview'],
  endAfterQuestions: 5,
} satisfies Persona;

export const demoTurnContext = {
  agent: demoAgentConfig,
  pkg: demoPackageFree,
  entitlement: demoEntitlementPreview,
  profile: learnerProfileNew,
  locale: demoLocalePack,
  styleCard: demoStyleCard,
  history: [],
  retrieved: [],
  lockedHit: false,
  helpRung: 0,
  intent: 'on_task',
  attempt: 'none',
} satisfies TurnContext;

export const turnContextFull = {
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  entitlement: demoEntitlementSubscription,
  profile: demoLearnerProfile,
  locale: demoLocalePack,
  styleCard: demoStyleCard,
  history: [messageStudent, messageAgent],
  retrieved: [demoChunk, demoChunkScored],
  lockedHit: true,
  persona: demoPersona,
  helpRung: 4,
  intent: 'answer_seeking',
  attempt: 'partial',
} satisfies TurnContext;

export const demoPedagogyDecision = {
  move: 'hint',
  rung: 1,
  mustNotReveal: ['5/6'],
  systemPrompt: 'Give one hint. Do not state the answer.',
  tools: ['calculator'],
  maxOutputTokens: 300,
} satisfies PedagogyDecision;

export const pedagogyDecisionAskTeacher = {
  move: 'ask_teacher',
  rung: 0,
  mustNotReveal: [],
  systemPrompt: 'Tell the student the question has gone to the teacher.',
  tools: [],
  maxOutputTokens: 120,
} satisfies PedagogyDecision;

export const teacherQuestionOpen = {
  id: 'tq_test_01',
  teacherId: 'tch_test_01',
  agentId: 'agt_test_01',
  studentId: 'stu_test_01',
  text: 'Why does the common denominator have to be the smallest one?',
  similarIds: [],
  status: 'open',
  createdAt: '2026-10-17T10:05:00Z',
} satisfies TeacherQuestion;

export const teacherQuestionAnswered = {
  ...teacherQuestionOpen,
  id: 'tq_test_02',
  moduleHint: 'mod_test_01',
  similarIds: ['tq_test_01'],
  status: 'answered',
  answeredAt: '2026-10-18T09:00:00Z',
} satisfies TeacherQuestion;

export const turnEvents = [
  { type: 'token', text: 'What ' },
  { type: 'sources', items: [sourceMaterial] },
  { type: 'hint_rung', rung: 2 },
  { type: 'locked', packageName: 'Full course' },
  { type: 'locked' },
  { type: 'teacher_question', questionId: 'tq_test_01' },
  {
    type: 'skill',
    skill: 'practice',
    payload: { itemId: 'itm_test_01', prompt: 'Add 1/4 and 1/6.' },
  },
  { type: 'safety', level: 'alert' },
  { type: 'replace', text: 'Let us try that a different way.' },
  { type: 'done', messageId: 'msg_test_02', usage: [usageSmall, usageMain] },
  { type: 'error', code: 'limit_reached', retryable: false },
] satisfies TurnEvent[];

export const valid = {
  ChunkKind: [...chunkKinds],
  SourceRef: [sourceMaterial, sourceTranscript, sourceTeacherNote],
  Chunk: [demoChunk, demoChunkScored],
  Attachment: [demoAttachment],
  Message: [messageStudent, messageAgent, messageTeacher],
  TurnInput: [demoTurnInput, turnInputHint, turnInputSkillAction, turnInputAtLimit],
  Intent: [...intents],
  Attempt: [...attempts],
  Persona: [demoPersona],
  TurnContext: [demoTurnContext, turnContextFull],
  PedagogyDecision: [demoPedagogyDecision, pedagogyDecisionAskTeacher],
  TeacherQuestion: [teacherQuestionOpen, teacherQuestionAnswered],
  TurnEvent: [...turnEvents],
};
