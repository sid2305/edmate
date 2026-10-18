import { demoSafetyAlert } from '../valid/safety.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  {
    schema: 'SafetyAlert',
    name: 'unknown level',
    value: { ...demoSafetyAlert, level: 'severe' },
    path: ['level'],
  },
  {
    schema: 'SafetyAlert',
    name: 'unredacted excerpt key',
    value: { ...demoSafetyAlert, excerpt: 'raw text' },
    path: [],
  },
  // The union reports at the root when no variant matches.
  {
    schema: 'GuardResult',
    name: 'ok true with an action',
    value: { ok: true, action: 'block', reason: 'x' },
    path: [],
  },
  {
    schema: 'GuardResult',
    name: 'rewrite without text',
    value: { ok: false, action: 'rewrite', reason: 'x' },
    path: [],
  },
  {
    schema: 'GuardResult',
    name: 'unknown action',
    value: { ok: false, action: 'ignore', reason: 'x' },
    path: [],
  },
  {
    schema: 'SafetyAlert',
    name: 'excerpt over 8,000 characters',
    value: { ...demoSafetyAlert, excerptRedacted: 'x'.repeat(8001) },
    path: ['excerptRedacted'],
  },
  {
    schema: 'GuardResult',
    name: 'block reason over 500 characters',
    value: { ok: false, action: 'block', reason: 'x'.repeat(501) },
    // Only one variant matches ok + action, so Zod reports that variant's own path.
    path: ['reason'],
  },
  {
    schema: 'GuardResult',
    name: 'rewrite text over 8,000 characters',
    value: { ok: false, action: 'rewrite', text: 'x'.repeat(8001), reason: 'x' },
    path: ['text'],
  },
];
