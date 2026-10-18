import { demoTurnTrace } from '../valid/trace.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  {
    schema: 'TurnTrace',
    name: 'unknown move',
    value: { ...demoTurnTrace, move: 'lecture' },
    path: ['move'],
  },
  {
    schema: 'TurnTrace',
    name: 'negative step time',
    value: { ...demoTurnTrace, steps: [{ name: 'admit', ms: -1, outcome: 'ok' }] },
    path: ['steps', 0, 'ms'],
  },
  {
    schema: 'TurnTrace',
    name: 'unknown step outcome',
    value: { ...demoTurnTrace, steps: [{ name: 'admit', ms: 1, outcome: 'skipped' }] },
    path: ['steps', 0, 'outcome'],
  },
];
