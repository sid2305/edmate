import { describe, expect, it } from 'vitest';
import { defaultPreGuardRegistry } from '../pipeline/steps/preGuard.js';
import { defaultScrubRegistry } from '../pipeline/steps/scrub.js';
import { fakeGuard } from '../testing/guardFixtures.js';
import type { Guard } from './guard.js';
import { GUARD_ORDER } from './order.js';
import { postGuards } from './postGuards.js';
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
      'lockedLeak',
      'answerLeak',
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

describe('GuardRegistry: slice weights (task 4.7, lead answer 1)', () => {
  it('keeps each guard’s weight; 1 by default and for a name it does not hold', () => {
    const r = new GuardRegistry<unknown>('post');
    r.register(fakeGuard('grounding', 'post', ok), { weight: 4 });
    r.register(fakeGuard('tone', 'post', ok));
    expect(r.weight('grounding')).toBe(4);
    expect(r.weight('tone')).toBe(1);
    expect(r.weight('answerLeak')).toBe(1);
    expect(r.weight('constructor')).toBe(1);
  });

  it.each([0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY, '2' as unknown as number])(
    'refuses weight %s',
    (weight) => {
      const r = new GuardRegistry<unknown>('post');
      expect(() => r.register(fakeGuard('tone', 'post', ok), { weight })).toThrow(
        GuardRegistryError,
      );
      expect(r.has('tone')).toBe(false);
    },
  );
});

describe('completeness: the real, wired-up registries runTurn uses (4.9, lead answer 12)', () => {
  it('defaultScrubRegistry() declares and registers every scrub guard, in order', () => {
    const r = defaultScrubRegistry();
    expect(r.missing()).toEqual([]);
    expect(names(r.ordered())).toEqual([...GUARD_ORDER.scrub]);
  });

  it('defaultPreGuardRegistry() declares and registers every pre guard, in order', () => {
    const r = defaultPreGuardRegistry();
    expect(r.missing()).toEqual([]);
    expect(names(r.ordered())).toEqual([...GUARD_ORDER.pre]);
  });

  it(
    'postGuards: tone is now registered (4.9 Phase A); personaBoundary is still declared but ' +
      'unregistered until 4.9 Phase B registers it too — the natural case lead answer 12’s ' +
      'mutation is about, not a broken build',
    () => {
      expect(postGuards.has('tone')).toBe(true);
      expect(postGuards.missing()).toEqual(['personaBoundary']);
    },
  );

  it('a post registry missing tone fails the completeness check (mutation)', () => {
    const r = new GuardRegistry<unknown>('post');
    for (const n of GUARD_ORDER.post) {
      if (n !== 'tone') r.register(fakeGuard(n, 'post', ok));
    }
    expect(r.missing()).toEqual(['tone']);
    expect(names(r.ordered())).toEqual(GUARD_ORDER.post.filter((n) => n !== 'tone'));
  });
});
