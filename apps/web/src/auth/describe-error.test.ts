// Task 1.4d: describeError prefers Auth.js's own `.type` (stable) over `.name` (can be minified
// once the app is built), but still falls back to `.name` when there is no `.type`.
import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error';

describe('describeError', () => {
  it('logs the Auth.js `.type`, not a minified `.name`, when `.type` is set', () => {
    const error = Object.assign(new Error('asha@example.test token abc123'), {
      name: 'a',
      type: 'Verification',
    });
    expect(describeError(error)).toBe('Verification');
  });

  it('falls back to `.name` when there is no `.type`', () => {
    const error = Object.assign(new Error('x'), { name: 'CallbackRouteError' });
    expect(describeError(error)).toBe('CallbackRouteError');
  });

  it('a non-Error value describes as non-error', () => {
    expect(describeError('raw string asha@example.test')).toBe('non-error');
    expect(describeError(null)).toBe('non-error');
    expect(describeError(undefined)).toBe('non-error');
  });
});
