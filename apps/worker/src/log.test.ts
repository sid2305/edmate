import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, ERROR_MESSAGE_MAX, jsonLog } from './log.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('jsonLog', () => {
  it('writes one JSON line per call with its level', () => {
    const out: [string, string][] = [];
    jsonLog((level, text) => out.push([level, text]))({ level: 'warn', event: 'x', n: 1 });
    expect(out).toEqual([['warn', '{"level":"warn","event":"x","n":1}']]);
  });

  it('defaults to stdout for info and stderr for warnings and errors', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const l = jsonLog();
    l({ level: 'info', event: 'a' });
    l({ level: 'warn', event: 'b' });
    l({ level: 'error', event: 'c' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('describeError', () => {
  it('keeps the name and a capped message; a non-Error gives its type', () => {
    expect(describeError(new TypeError('bad'))).toEqual({ name: 'TypeError', message: 'bad' });
    expect(describeError(new Error('x'.repeat(500))).message).toHaveLength(ERROR_MESSAGE_MAX);
    expect(describeError('oops')).toEqual({ name: 'string', message: '' });
  });
});
