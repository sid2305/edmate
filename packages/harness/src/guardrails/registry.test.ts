import { describe, expect, it } from 'vitest';
import { fakeGuard } from '../testing/guardFixtures.js';
import type { Guard } from './guard.js';
import { GuardRegistry, GuardRegistryError } from './registry.js';

const ok = { ok: true } as const;
const names = (gs: readonly Guard<unknown>[]): string[] => gs.map((g) => g.name);

describe('GuardRegistry', () => {
  it('returns guards registered in declared order', () => {
    const r = new GuardRegistry<unknown>('pre');
    r.register(fakeGuard('distressDetect', 'pre', ok));
    r.register(fakeGuard('moderationIn', 'pre', ok));
    r.register(fakeGuard('jailbreak', 'pre', ok));
    expect(r.phase).toBe('pre');
    expect(names(r.ordered())).toEqual(['distressDetect', 'moderationIn', 'jailbreak']);
  });

  it('returns GUARD_ORDER order whatever the registration order', () => {
    const r = new GuardRegistry<unknown>('post');
    for (const n of [
      'tone',
      'answerLeak',
      'personaBoundary',
      'lockedLeak',
      'adviceGuard',
      'grounding',
    ]) {
      r.register(fakeGuard(n, 'post', ok));
    }
    expect(names(r.ordered())).toEqual([
      'answerLeak',
      'lockedLeak',
      'grounding',
      'adviceGuard',
      'personaBoundary',
      'tone',
    ]);
    expect(r.missing()).toEqual([]);
  });

  it('skips declared guards that are not built yet and keeps the rest in order', () => {
    const r = new GuardRegistry<unknown>('post');
    r.register(fakeGuard('tone', 'post', ok));
    r.register(fakeGuard('lockedLeak', 'post', ok));
    expect(names(r.ordered())).toEqual(['lockedLeak', 'tone']);
    expect(r.missing()).toEqual(['answerLeak', 'grounding', 'adviceGuard', 'personaBoundary']);
    expect(r.has('tone')).toBe(true);
    expect(r.has('grounding')).toBe(false);
  });

  it('is empty until something registers', () => {
    const r = new GuardRegistry<unknown>('scrub');
    expect(r.ordered()).toEqual([]);
    expect(r.missing()).toEqual(['piiScrub']);
  });

  it('returns a fresh frozen array, so a caller cannot edit the registry through it', () => {
    const r = new GuardRegistry<unknown>('scrub');
    r.register(fakeGuard('piiScrub', 'scrub', ok));
    const first = r.ordered();
    expect(Object.isFrozen(first)).toBe(true);
    expect(r.ordered()).not.toBe(first);
    expect(names(r.ordered())).toEqual(['piiScrub']);
  });

  it('throws at wiring time for a name the phase does not declare', () => {
    const r = new GuardRegistry<unknown>('pre');
    expect(() => r.register(fakeGuard('profanity', 'pre', ok))).toThrow(GuardRegistryError);
    expect(() => r.register(fakeGuard('profanity', 'pre', ok))).toThrow(
      /"profanity" is not declared for phase "pre"/,
    );
    // A name declared in another phase is still undeclared here.
    expect(() => r.register(fakeGuard('tone', 'pre', ok))).toThrow(GuardRegistryError);
    expect(r.ordered()).toEqual([]);
  });

  it('throws for a duplicate name and keeps the first registration', () => {
    const r = new GuardRegistry<unknown>('pre');
    const first = fakeGuard('jailbreak', 'pre', ok);
    r.register(first);
    expect(() => r.register(fakeGuard('jailbreak', 'pre', ok))).toThrow(/already registered/);
    expect(r.ordered()).toEqual([first]);
  });

  it('throws for a guard of another phase', () => {
    const r = new GuardRegistry<unknown>('post');
    expect(() => r.register(fakeGuard('jailbreak', 'pre', ok))).toThrow(/phase "pre", not "post"/);
  });

  it('throws for a malformed guard object', () => {
    const r = new GuardRegistry<unknown>('pre');
    const bad = [
      null,
      undefined,
      'jailbreak',
      { name: 'jailbreak', phase: 'pre' },
      { name: 'jailbreak', phase: 'pre', run: 'no' },
      { name: 7, phase: 'pre', run: () => Promise.resolve() },
    ];
    for (const g of bad) {
      expect(() => r.register(g as never)).toThrow(GuardRegistryError);
    }
    expect(r.ordered()).toEqual([]);
  });

  it('refuses to build a registry for an unknown phase', () => {
    expect(() => new GuardRegistry<unknown>('mid' as never)).toThrow(GuardRegistryError);
    expect(() => new GuardRegistry<unknown>('constructor' as never)).toThrow(GuardRegistryError);
  });
});
