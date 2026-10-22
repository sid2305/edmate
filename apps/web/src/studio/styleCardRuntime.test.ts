// Task 8.4a: the style card runtime builds its drafter gateway lazily, once: the dev model on a
// local stack (no key, no real call; rule 4), else the Anthropic router. A failure is logged once by
// reason code and never quotes a key.
import type { ModelRequest } from '@edmate/contracts';
import { draftStyleCard } from '@edmate/ingest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { devFactories } from '../turn/devModel';
import { createStyleCardRuntime, devStyleCardGateway } from './styleCardRuntime';

const LOCAL = { EDMATE_DEV_MODEL: 'scripted', AUTH_URL: 'http://localhost:8080' };
const repos = () => ({}) as never;

function hooks(factories = vi.fn(async () => devFactories())) {
  return { repos, log: { error: vi.fn() }, factories };
}

describe('createStyleCardRuntime', () => {
  it('passes the repos through untouched', () => {
    const h = hooks();
    expect(createStyleCardRuntime(() => ({}), h).repos).toBe(repos);
  });

  it('on a local dev stack drafts with the dev model and reads no key', async () => {
    const h = hooks();
    const runtime = createStyleCardRuntime(() => LOCAL, h);
    const gateway = await runtime.gateway();
    const draft = await draftStyleCard(gateway, {
      answers: [{ question: 'tone', answer: 'warm' }],
      sampleExplanations: [],
      mistakeCandidates: ['units'],
    });
    expect(draft.text).toMatch(/^\[dev model\]/);
    expect(draft.mistakeTags).toEqual([]);
    expect(h.factories).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledWith('studio.style_card_dev_model_on', {});
  });

  it('otherwise builds the router over the provider factories, once', async () => {
    const h = hooks();
    const env = { EDMATE_ANTHROPIC_API_KEY: 'test-only-not-a-key' };
    const runtime = createStyleCardRuntime(() => env, h);
    const first = await runtime.gateway();
    expect(typeof first.generateObject).toBe('function');
    expect(await runtime.gateway()).toBe(first);
    expect(h.factories).toHaveBeenCalledTimes(1);
    expect(h.factories).toHaveBeenCalledWith(env);
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it('a missing provider key rejects as provider_key, logged once, without the error text', async () => {
    const h = hooks(vi.fn(async () => Promise.reject(new Error('secret-ish detail'))));
    const runtime = createStyleCardRuntime(() => ({}), h);
    await expect(runtime.gateway()).rejects.toThrow('provider_key');
    await expect(runtime.gateway()).rejects.toThrow('provider_key');
    expect(h.factories).toHaveBeenCalledTimes(1);
    expect(h.log.error.mock.calls).toEqual([
      ['studio.style_card_runtime_unavailable', { reason: 'provider_key' }],
    ]);
  });

  it('a dev model flag off a local stack fails closed', async () => {
    const h = hooks();
    const env = { EDMATE_DEV_MODEL: 'scripted', AUTH_URL: 'https://edmate.example' };
    await expect(createStyleCardRuntime(() => env, h).gateway()).rejects.toThrow(
      'EDMATE_DEV_MODEL',
    );
    expect(h.factories).not.toHaveBeenCalled();
  });

  it('uses the real Anthropic factories when none are injected (and needs a key)', async () => {
    const runtime = createStyleCardRuntime(() => ({}), { repos, log: { error: vi.fn() } });
    await expect(runtime.gateway()).rejects.toThrow('provider_key');
  });
});

describe('devStyleCardGateway', () => {
  it('answers only a schema its fixed draft fits', async () => {
    const g = devStyleCardGateway();
    const req: ModelRequest = { tier: 'small', system: '', messages: [], maxOutputTokens: 10 };
    await expect(g.generateObject(req, z.strictObject({ other: z.string() }))).rejects.toThrow();
  });
});
