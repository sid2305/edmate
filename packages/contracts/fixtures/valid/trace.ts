import type { TurnTrace } from '../../src/index.js';
import { usageMain, usageSmall } from './shared.js';

export const demoTurnTrace = {
  turnId: 'trn_test_01',
  sessionId: 'ses_test_01',
  agentVersion: 3,
  packageVersion: 2,
  steps: [
    { name: 'admit', ms: 1, outcome: 'ok' },
    { name: 'route', ms: 42.5, outcome: 'fallback' },
    { name: 'retrieve', ms: 0, outcome: 'failed' },
  ],
  intent: 'on_task',
  move: 'hint',
  guards: [
    { name: 'injection', ok: true },
    { name: 'leak', ok: false, action: 'rewrite' },
  ],
  usage: [usageSmall, usageMain],
} satisfies TurnTrace;

export const turnTraceEmpty = {
  turnId: 'trn_test_02',
  sessionId: 'ses_test_01',
  agentVersion: 0,
  packageVersion: 0,
  steps: [],
  intent: 'distress',
  move: 'redirect',
  guards: [],
  usage: [],
} satisfies TurnTrace;

export const valid = {
  TurnTrace: [demoTurnTrace, turnTraceEmpty],
};
