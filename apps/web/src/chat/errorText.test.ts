// Task 9.4 Phase B: every contracts error code maps to fixed English text (never server text).
import { ErrorCodeSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { errorText } from './errorText';

describe('errorText', () => {
  it.each(ErrorCodeSchema.options)('%s has non-empty fixed text', (code) => {
    const text = errorText(code);
    expect(text.trim()).not.toBe('');
    expect(text).toBe(errorText(code));
    // No raw code or developer wording leaks to the student.
    expect(text).not.toContain(code);
  });

  it('guard_blocked has student-facing wording, not the bare code', () => {
    expect(errorText('guard_blocked')).not.toMatch(/guard|blocked/i);
  });

  it('every code has distinct-enough text: at least the access and retry cases differ', () => {
    expect(errorText('no_access')).not.toBe(errorText('provider_error'));
    expect(errorText('rate_limited')).not.toBe(errorText('limit_reached'));
  });

  it('an unknown code (a bad cast) falls back to the generic text', () => {
    expect(errorText('nope' as never)).toBe(errorText('provider_error'));
  });
});
