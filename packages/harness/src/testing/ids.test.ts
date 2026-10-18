import { SafetyAlertSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from './ids.js';

const IdSchema = SafetyAlertSchema.shape.id;

describe('sequentialIds', () => {
  it('counts per kind', () => {
    const ids = sequentialIds();
    expect([ids.next('turn'), ids.next('message'), ids.next('turn'), ids.next('alert')]).toEqual([
      'turn_1',
      'message_1',
      'turn_2',
      'alert_1',
    ]);
  });

  it('is deterministic across instances', () => {
    const a = sequentialIds();
    const b = sequentialIds();
    expect([a.next('turn'), a.next('turn')]).toEqual([b.next('turn'), b.next('turn')]);
  });

  it('applies a prefix and returns contracts-valid ids', () => {
    const ids = sequentialIds('run-2');
    const id = ids.next('message');
    expect(id).toBe('run-2_message_1');
    expect(IdSchema.safeParse(id).success).toBe(true);
  });
});
