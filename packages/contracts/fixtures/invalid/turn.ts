import {
  demoAttachment,
  demoChunk,
  demoPedagogyDecision,
  demoPersona,
  demoTurnContext,
  demoTurnInput,
  messageStudent,
  sourceMaterial,
  teacherQuestionOpen,
  turnInputSkillAction,
} from '../valid/turn.js';
import { omit } from '../omit.js';
import type { InvalidCase } from './case.js';

const messageWithoutText = omit(demoTurnInput, 'text');
const skillActionWithoutSkill = omit(turnInputSkillAction, 'skill');

export const invalid: InvalidCase[] = [
  { schema: 'ChunkKind', name: 'unknown kind', value: 'web_page', path: [] },
  {
    schema: 'SourceRef',
    name: 'unknown kind',
    value: { ...sourceMaterial, kind: 'web_page' },
    path: ['kind'],
  },
  {
    schema: 'Chunk',
    name: 'missing moduleId',
    value: { ...demoChunk, moduleId: undefined },
    path: ['moduleId'],
  },
  {
    schema: 'Chunk',
    name: 'score is not a number',
    value: { ...demoChunk, score: 'high' },
    path: ['score'],
  },
  {
    schema: 'Attachment',
    name: 'not an image',
    value: { ...demoAttachment, mime: 'application/pdf' },
    path: ['mime'],
  },
  {
    schema: 'Attachment',
    name: 'kind is not image',
    value: { ...demoAttachment, kind: 'pdf' },
    path: ['kind'],
  },
  {
    schema: 'Message',
    name: 'unknown role',
    value: { ...messageStudent, role: 'system' },
    path: ['role'],
  },
  {
    schema: 'Message',
    name: 'createdAt is not a timestamp',
    value: { ...messageStudent, createdAt: 'yesterday' },
    path: ['createdAt'],
  },
  {
    schema: 'TurnInput',
    name: '4,001 characters',
    value: { ...demoTurnInput, text: 'a'.repeat(4001) },
    path: ['text'],
  },
  {
    schema: 'TurnInput',
    name: '3 attachments',
    value: { ...demoTurnInput, attachments: [demoAttachment, demoAttachment, demoAttachment] },
    path: ['attachments'],
  },
  {
    schema: 'TurnInput',
    name: 'client-sent packageId (access filter rule 1)',
    value: { ...demoTurnInput, packageId: 'pkg_test_paid' },
    path: [],
  },
  { schema: 'TurnInput', name: 'message without text', value: messageWithoutText, path: ['text'] },
  {
    schema: 'TurnInput',
    name: 'skill_action without skill',
    value: skillActionWithoutSkill,
    path: ['skill'],
  },
  {
    schema: 'TurnInput',
    name: 'clientTs is not a timestamp',
    value: { ...demoTurnInput, clientTs: '17/10/2026' },
    path: ['clientTs'],
  },
  {
    schema: 'TurnInput',
    name: 'empty studentId',
    value: { ...demoTurnInput, studentId: '' },
    path: ['studentId'],
  },
  { schema: 'Intent', name: 'unknown intent', value: 'chit_chat', path: [] },
  { schema: 'Attempt', name: 'unknown attempt', value: 'almost', path: [] },
  {
    schema: 'Persona',
    name: 'negative endAfterQuestions',
    value: { ...demoPersona, endAfterQuestions: -1 },
    path: ['endAfterQuestions'],
  },
  {
    schema: 'TurnContext',
    name: 'helpRung 5',
    value: { ...demoTurnContext, helpRung: 5 },
    path: ['helpRung'],
  },
  {
    schema: 'TurnContext',
    name: 'nested invalid package',
    value: { ...demoTurnContext, pkg: { ...demoTurnContext.pkg, helpCeiling: 7 } },
    path: ['pkg', 'helpCeiling'],
  },
  {
    schema: 'PedagogyDecision',
    name: 'unknown move',
    value: { ...demoPedagogyDecision, move: 'lecture' },
    path: ['move'],
  },
  {
    schema: 'PedagogyDecision',
    name: 'rung -1',
    value: { ...demoPedagogyDecision, rung: -1 },
    path: ['rung'],
  },
  {
    schema: 'TeacherQuestion',
    name: 'unknown status',
    value: { ...teacherQuestionOpen, status: 'closed' },
    path: ['status'],
  },
  {
    schema: 'TeacherQuestion',
    name: 'answeredAt is not a timestamp',
    value: { ...teacherQuestionOpen, answeredAt: 'soon' },
    path: ['answeredAt'],
  },
  {
    schema: 'TurnEvent',
    name: 'hint_rung 5',
    value: { type: 'hint_rung', rung: 5 },
    path: ['rung'],
  },
  {
    schema: 'TurnEvent',
    name: 'hint_rung 1.5',
    value: { type: 'hint_rung', rung: 1.5 },
    path: ['rung'],
  },
  {
    schema: 'TurnEvent',
    name: 'unknown event type',
    value: { type: 'thinking', text: '' },
    path: ['type'],
  },
  {
    schema: 'TurnEvent',
    name: 'unknown error code',
    value: { type: 'error', code: 'oops', retryable: true },
    path: ['code'],
  },
  {
    schema: 'TurnEvent',
    name: 'critical is not a client safety level',
    value: { type: 'safety', level: 'critical' },
    path: ['level'],
  },
];
