import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import { classifyGatewayFailure } from '../src/gatewayFailure.js';

describe('classifyGatewayFailure', () => {
  it('maps a ZodError (ScriptedGateway path) to validation, not retryable', () => {
    const zodError = new ZodError([]);
    expect(classifyGatewayFailure(zodError)).toEqual({ code: 'validation', retryable: false });
  });

  it('maps a real-gateway validation GatewayError to validation, not retryable', () => {
    const err = Object.assign(new Error('bad shape'), {
      name: 'GatewayError',
      code: 'validation',
      retryable: false,
    });
    expect(classifyGatewayFailure(err)).toEqual({ code: 'validation', retryable: false });
  });

  it('maps a real-gateway rate_limited GatewayError to provider_error, keeping retryable true', () => {
    const err = Object.assign(new Error('rate limited'), {
      name: 'GatewayError',
      code: 'rate_limited',
      retryable: true,
    });
    expect(classifyGatewayFailure(err)).toEqual({ code: 'provider_error', retryable: true });
  });

  it('maps a real-gateway provider_error GatewayError to provider_error, keeping retryable false', () => {
    const err = Object.assign(new Error('outage'), {
      name: 'GatewayError',
      code: 'provider_error',
      retryable: false,
    });
    expect(classifyGatewayFailure(err)).toEqual({ code: 'provider_error', retryable: false });
  });

  it('maps an error with an unknown code string to provider_error, retryable (today\'s default)', () => {
    const err = Object.assign(new Error('mystery'), {
      code: 'not-a-real-error-code',
      retryable: false,
    });
    expect(classifyGatewayFailure(err)).toEqual({ code: 'provider_error', retryable: true });
  });

  it('maps a non-Error throw to provider_error, retryable', () => {
    expect(classifyGatewayFailure('a string throw')).toEqual({
      code: 'provider_error',
      retryable: true,
    });
    expect(classifyGatewayFailure(undefined)).toEqual({ code: 'provider_error', retryable: true });
    expect(classifyGatewayFailure({ code: 'validation' })).toEqual({
      code: 'provider_error',
      retryable: true,
    });
  });
});
