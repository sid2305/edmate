import type { Entitlement, TurnInput } from '@edmate/contracts';
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { TurnRejection } from '../pipeline/errors.js';
import { entitle } from '../pipeline/steps/entitle.js';
import type { PipelineDeps } from '../pipeline/types.js';
import {
  type AccessOptions,
  type AccessWorld,
  memoryEntitlementStore,
  memoryTurnConfigStore,
  packMarket,
  S,
  T,
  twoTeacherWorld,
} from './memoryAccess.js';
import { testDeps } from './testSteps.js';

const AT = '2026-10-17T10:00:00.000Z';
/** A smaller package of agt_a (only module a1): the downgrade target. */
const pkgSmall = { ...twoTeacherWorld().packages[0]!, id: 'pkg_a_small', name: 'pkg_a_small v1' };
/** Moves stu_1's subscription with teacher A to another package version. */
function moveSub(w: AccessWorld, packageId: string, packageVersion: number): void {
  const sub = w.subscriptions.find((x) => x.id === 'sub_1a')!;
  sub.packageId = packageId;
  sub.packageVersion = packageVersion;
}
const OPTS: AccessOptions = { market: 'IN' };

function resolve(
  x: { studentId: string; agentId: string; source: Entitlement['source'] },
  opts: AccessOptions = OPTS,
  world: AccessWorld = twoTeacherWorld(),
) {
  return memoryEntitlementStore(world, opts).resolve(x, AT);
}

async function mustResolve(
  x: { studentId: string; agentId: string; source: Entitlement['source'] },
  opts: AccessOptions = OPTS,
  world: AccessWorld = twoTeacherWorld(),
): Promise<Entitlement> {
  const e = await resolve(x, opts, world);
  if (e === null) throw new Error('expected an entitlement');
  return e;
}

/** Runs the real entitle step against the in-memory stores; returns the rejection code or 'ok'. */
async function entitleWith(
  input: Partial<TurnInput>,
  over: Partial<PipelineDeps> & { world?: AccessWorld; opts?: AccessOptions } = {},
): Promise<string> {
  const world = over.world ?? twoTeacherWorld();
  const t = testDeps({
    overrides: {
      entitlements: memoryEntitlementStore(world, over.opts ?? OPTS),
      turnConfig: memoryTurnConfigStore(world),
      ...over,
    },
  });
  try {
    await entitle({
      input: { ...demoTurnInput, ...input },
      deps: t.deps,
      cancel: cancelSource().token,
      turnId: 'turn_1',
    });
    return 'ok';
  } catch (e) {
    if (e instanceof TurnRejection) return e.code;
    throw e;
  }
}

describe('memoryEntitlementStore: subscription', () => {
  it('resolves the live subscription server-side with modules, locks and skills', async () => {
    const store = memoryEntitlementStore(twoTeacherWorld(), OPTS);
    const e = await store.resolve(
      { studentId: S.one, agentId: 'agt_a', source: 'subscription' },
      AT,
    );
    expect(e).toEqual({
      source: 'subscription',
      subscriptionId: 'sub_1a',
      studentId: S.one,
      teacherId: T.A,
      agentId: 'agt_a',
      market: 'IN',
      packageId: 'pkg_a',
      packageVersion: 2,
      status: 'active',
      periodEnd: '2026-12-01T00:00:00.000Z',
      allowedModuleIds: ['mod_a1', 'mod_a2'],
      lockedModuleIds: ['mod_a3'],
      skills: ['explain', 'coach', 'practice'],
    });
    expect(store.calls).toEqual([
      { x: { studentId: S.one, agentId: 'agt_a', source: 'subscription' }, at: AT },
    ]);
  });

  it('an unknown market maps to the global locale pack', async () => {
    const e = await mustResolve(
      { studentId: S.one, agentId: 'agt_a', source: 'subscription' },
      { market: 'ZZ' },
    );
    expect(e.market).toBe('global');
    expect(packMarket(twoTeacherWorld(), 'IN')).toBe('IN');
  });

  it('returns paused and trial as stored (entitle decides), and nothing for ended', async () => {
    expect(
      (await mustResolve({ studentId: S.two, agentId: 'agt_a', source: 'subscription' })).status,
    ).toBe('paused');
    expect(
      (await mustResolve({ studentId: S.two, agentId: 'agt_b', source: 'subscription' })).status,
    ).toBe('trial');
    expect(
      await resolve({ studentId: S.one, agentId: 'agt_b', source: 'subscription' }),
    ).toBeNull();
  });

  it('refuses draft, suspended and unknown agents, and a package of another agent', async () => {
    for (const agentId of ['agt_a_draft', 'agt_b_susp', 'agt_nowhere']) {
      expect(await resolve({ studentId: S.one, agentId, source: 'subscription' })).toBeNull();
    }
    const w = twoTeacherWorld();
    w.agents.find((a) => a.id === 'agt_a_draft')!.status = 'live';
    // stu_1's subscription with teacher A is for agt_a's package, not agt_a_draft's.
    expect(
      await resolve({ studentId: S.one, agentId: 'agt_a_draft', source: 'subscription' }, OPTS, w),
    ).toBeNull();
    // A subscription whose package version is gone gives nothing.
    w.packages = w.packages.filter((p) => !(p.id === 'pkg_a' && p.version === 2));
    expect(
      await resolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' }, OPTS, w),
    ).toBeNull();
  });

  it('a stored package with a malformed module id throws (integrity), never resolves', async () => {
    const w = twoTeacherWorld();
    w.packages.push({ ...w.packages[1]!, version: 3, moduleIds: ['mod_a1', 'mod_a1', 'bad id!'] });
    w.subscriptions[0]!.packageVersion = 3;
    await expect(
      resolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' }, OPTS, w),
    ).rejects.toThrow();
  });
});

describe('memoryEntitlementStore: teacher preview and eval need no subscription', () => {
  const noSubs = (): AccessWorld => ({ ...twoTeacherWorld(), subscriptions: [] });

  it('preview: the teacher previews their own agent at the newest package version', async () => {
    const e = await mustResolve(
      { studentId: T.A, agentId: 'agt_a', source: 'teacher_preview' },
      { market: 'IN', preview: { packageId: 'pkg_a' } },
      noSubs(),
    );
    expect(e).toMatchObject({
      source: 'teacher_preview',
      studentId: T.A,
      teacherId: T.A,
      packageId: 'pkg_a',
      packageVersion: 2,
      status: 'active',
      periodEnd: AT,
    });
    expect('subscriptionId' in e).toBe(false);
    const draft = await mustResolve(
      { studentId: T.A, agentId: 'agt_a_draft', source: 'teacher_preview' },
      { market: 'IN', preview: { packageId: 'pkg_a_draft' } },
      noSubs(),
    );
    expect(draft.lockedModuleIds).toEqual(['mod_a1', 'mod_a2']);
  });

  it("preview: a student, another teacher, another teacher's or agent's package give nothing", async () => {
    const preview = { market: 'IN', preview: { packageId: 'pkg_a' } };
    expect(
      await resolve({ studentId: S.one, agentId: 'agt_a', source: 'teacher_preview' }, preview),
    ).toBeNull();
    expect(
      await resolve({ studentId: T.B, agentId: 'agt_a', source: 'teacher_preview' }, preview),
    ).toBeNull();
    for (const packageId of ['pkg_b', 'pkg_a_draft']) {
      expect(
        await resolve(
          { studentId: T.A, agentId: 'agt_a', source: 'teacher_preview' },
          { market: 'IN', preview: { packageId } },
        ),
      ).toBeNull();
    }
    expect(
      await resolve({ studentId: T.A, agentId: 'agt_a', source: 'teacher_preview' }, OPTS),
    ).toBeNull();
  });

  it('eval: the pinned package version, the eval market, no subscription', async () => {
    const opts = {
      market: 'IN',
      eval: { teacherId: T.A, packageId: 'pkg_a', version: 1, market: 'US' },
    };
    const e = await mustResolve(
      { studentId: S.evalStudent, agentId: 'agt_a', source: 'eval' },
      opts,
      noSubs(),
    );
    expect(e).toMatchObject({
      source: 'eval',
      packageVersion: 1,
      market: 'global',
      status: 'active',
    });
    expect('subscriptionId' in e).toBe(false);
  });

  it("eval: no eval config, another teacher's agent or a missing version give nothing", async () => {
    const ev = { teacherId: T.A, packageId: 'pkg_a', version: 1, market: 'IN' };
    expect(
      await resolve({ studentId: S.evalStudent, agentId: 'agt_a', source: 'eval' }),
    ).toBeNull();
    expect(
      await resolve(
        { studentId: S.evalStudent, agentId: 'agt_b', source: 'eval' },
        { market: 'IN', eval: ev },
      ),
    ).toBeNull();
    expect(
      await resolve(
        { studentId: S.evalStudent, agentId: 'agt_a', source: 'eval' },
        { market: 'IN', eval: { ...ev, version: 9 } },
      ),
    ).toBeNull();
  });
});

describe('memoryTurnConfigStore (ADR-0004)', () => {
  it('(b) loads the agent at the session row version, not the live one', async () => {
    const world = twoTeacherWorld();
    const e = await mustResolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' });
    const store = memoryTurnConfigStore(world);
    const cfg = await store.load(e, 'ses_1a');
    expect(cfg?.agent.version).toBe(1);
    expect(cfg?.pkg).toMatchObject({ id: 'pkg_a', version: 2 });
    expect(cfg?.styleCard.id).toBe('sty_a');
    expect(cfg?.locale.market).toBe('IN');
    expect(store.calls).toEqual([{ e, sessionId: 'ses_1a' }]);
    // The version comes from the row: change the row, the loaded version follows.
    world.sessions.find((s) => s.id === 'ses_1a')!.agentVersion = 2;
    expect((await store.load(e, 'ses_1a'))?.agent.version).toBe(2);
  });

  it('returns the session help state as stored, unvalidated (ADR-0005)', async () => {
    const world = twoTeacherWorld();
    const e = await mustResolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' });
    const store = memoryTurnConfigStore(world);
    const cfg = await store.load(e, 'ses_1a');
    expect(cfg).not.toBeNull();
    expect(cfg?.helpState).toBeUndefined();
    const stored = { v: 1, rung: 2, anything: 'kept as is' };
    world.sessions.find((s) => s.id === 'ses_1a')!.helpState = stored;
    expect((await store.load(e, 'ses_1a'))?.helpState).toBe(stored);
  });

  it.each([
    ['another student', 'ses_2a'],
    ['another teacher', 'ses_1b'],
    ['another agent', 'ses_1a_draft'],
    ['an ended session', 'ses_1a_ended'],
    ['an unknown session', 'ses_nowhere'],
  ])('(a) %s: load gives null and entitle gives no_access', async (_label, sessionId) => {
    const e = await mustResolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' });
    expect(await memoryTurnConfigStore(twoTeacherWorld()).load(e, sessionId)).toBeNull();
    expect(await entitleWith({ studentId: S.one, agentId: 'agt_a', sessionId })).toBe('no_access');
  });

  // Task 3.16: sessions follow the package, as the db adapter.
  it.each([
    ['a downgrade to another package', (w: AccessWorld) => moveSub(w, 'pkg_a_small', 1)],
    ['a new version of the same package', (w: AccessWorld) => moveSub(w, 'pkg_a', 1)],
  ])(
    '%s: load gives null, ends the session, and entitle gives no_access',
    async (_label, change) => {
      const world = twoTeacherWorld();
      world.packages.push(pkgSmall);
      change(world);
      const e = await mustResolve(
        { studentId: S.one, agentId: 'agt_a', source: 'subscription' },
        OPTS,
        world,
      );
      const store = memoryTurnConfigStore(world);
      expect(await store.load(e, 'ses_1a')).toBeNull();
      expect(world.sessions.find((s) => s.id === 'ses_1a')?.endedAt).not.toBeNull();
      // Already ended: still null, and the end time is not rewritten.
      const ended = world.sessions.find((s) => s.id === 'ses_1a')?.endedAt;
      expect(await store.load(e, 'ses_1a')).toBeNull();
      expect(world.sessions.find((s) => s.id === 'ses_1a')?.endedAt).toBe(ended);
      const fresh = twoTeacherWorld();
      fresh.packages.push(pkgSmall);
      change(fresh);
      expect(
        await entitleWith(
          { studentId: S.one, agentId: 'agt_a', sessionId: 'ses_1a' },
          { world: fresh },
        ),
      ).toBe('no_access');
    },
  );

  it('a session with no package pin (ended before the pin existed) is never loaded', async () => {
    const world = twoTeacherWorld();
    const e = await mustResolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' });
    const s = world.sessions.find((x) => x.id === 'ses_1a')!;
    s.packageId = null;
    s.packageVersion = null;
    s.endedAt = '2026-10-10T00:00:00.000Z';
    expect(await memoryTurnConfigStore(world).load(e, 'ses_1a')).toBeNull();
  });

  it('an open session with no package pin is a bad fixture: load throws', async () => {
    const world = twoTeacherWorld();
    const e = await mustResolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' });
    const s = world.sessions.find((x) => x.id === 'ses_1a')!;
    s.packageId = null;
    s.packageVersion = null;
    await expect(memoryTurnConfigStore(world).load(e, 'ses_1a')).rejects.toThrow(
      /open session/,
    );
  });

  it('a session with only one of packageId/packageVersion is a bad fixture: load throws', async () => {
    const world = twoTeacherWorld();
    const e = await mustResolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' });
    const s = world.sessions.find((x) => x.id === 'ses_1a')!;
    s.packageVersion = null;
    await expect(memoryTurnConfigStore(world).load(e, 'ses_1a')).rejects.toThrow(
      /only one of/,
    );
  });

  it('a pinned version that is gone, a missing style card, package or locale give null', async () => {
    const e = await mustResolve({ studentId: S.one, agentId: 'agt_a', source: 'subscription' });
    const cases: ((w: AccessWorld) => void)[] = [
      (w) => (w.sessions.find((s) => s.id === 'ses_1a')!.agentVersion = 7),
      (w) => (w.styleCards = w.styleCards.filter((c) => c.id !== 'sty_a')),
      (w) => (w.packages = w.packages.filter((p) => p.id !== 'pkg_a')),
      (w) => (w.locales = w.locales.filter((l) => l.market !== 'IN')),
    ];
    for (const change of cases) {
      const w = twoTeacherWorld();
      change(w);
      expect(await memoryTurnConfigStore(w).load(e, 'ses_1a')).toBeNull();
    }
  });

  it('entitle passes for the own open session and loads the pinned version', async () => {
    expect(await entitleWith({ studentId: S.one, agentId: 'agt_a', sessionId: 'ses_1a' })).toBe(
      'ok',
    );
  });

  it('(b) an agent whose id or teacherId differs from the entitlement gives no_access', async () => {
    const world = twoTeacherWorld();
    const real = memoryTurnConfigStore(world);
    for (const patch of [{ id: 'agt_b' }, { teacherId: T.B }]) {
      const code = await entitleWith(
        { studentId: S.one, agentId: 'agt_a', sessionId: 'ses_1a' },
        {
          world,
          turnConfig: {
            async load(e, sid) {
              const cfg = await real.load(e, sid);
              return cfg && { ...cfg, agent: { ...cfg.agent, ...patch } };
            },
          },
        },
      );
      expect(code, JSON.stringify(patch)).toBe('no_access');
    }
  });
});
