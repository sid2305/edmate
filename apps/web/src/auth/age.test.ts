// Task 1.7: the web age gate's logic, apart from Auth.js (age-flow.test.ts runs it end to end).
// The notice version always comes from the content the server loaded, never from the form.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepositoryError } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import { memoryIdentity } from '../../test/memory-identity';
import {
  AGE_BLOCK_MAX_AGE_S,
  ageBlockCookieName,
  ageGateView,
  loadAgeContent,
  submitAgeAnswer,
  type AgeContent,
  type AgeGateDeps,
  type CookieJar,
  type CookieOptions,
} from './age';
import { resolvePrincipal } from './guard';

const CONTENT = fileURLToPath(new URL('../../../../content', import.meta.url));
const NOW = new Date('2026-10-20T12:00:00Z');
const SESSION = 'authjs.session-token';
/** A fake session id (the fake store keeps it as given). */
const SID = 'sid'.padEnd(32, '0');
const BLOCK = ageBlockCookieName(false);

/** A cookie jar recording every set. */
function jar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const sets: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const cookies: CookieJar = {
    get: (name) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name, value, options) => {
      sets.push({ name, value, options });
      if (options.maxAge === 0) values.delete(name);
      else values.set(name, value);
    },
  };
  return { cookies, values, sets };
}

async function setup(opts: { content?: AgeContent; cookies?: Record<string, string> } = {}) {
  const content = opts.content ?? loadAgeContent(CONTENT);
  const identity = memoryIdentity(
    () => NOW,
    (m) => content.agePolicy(m),
  );
  const u = await identity.createStudent({
    email: 'a@example.test',
    emailVerifiedAt: null,
    name: 'A',
  });
  await identity.createSession(SID, u.id, new Date(NOW.getTime() + 86_400_000));
  const j = jar({ [SESSION]: SID, ...opts.cookies });
  const log: string[] = [];
  const deps: AgeGateDeps = {
    cookies: j.cookies,
    resolve: (c) =>
      resolvePrincipal(
        {
          getPrincipal: async (r) => {
            const t = r.get(SESSION)?.value;
            const found = t ? await identity.getSessionAndUser(t) : null;
            return found ? { userId: found.user.id, role: found.user.role } : null;
          },
          learnerStatus: (id) => identity.learnerStatus(id),
        },
        c,
      ),
    identity,
    content,
    secureCookies: false,
    sessionCookie: SESSION,
    now: () => NOW,
    log: (l) => log.push(l),
  };
  return { identity, user: u, jar: j, deps, log };
}

describe('loadAgeContent (real content/)', () => {
  const content = loadAgeContent(CONTENT);

  it('offers the pack markets and "somewhere else" last', () => {
    expect(content.markets).toEqual(['IN', 'US', 'global']);
  });

  it('takes each market rule from its pack, failing closed while the pack is unsigned', () => {
    for (const m of ['IN', 'US', 'global', 'FR']) {
      expect(content.agePolicy(m), m).toEqual({ minAge: 13, consentRequired: true });
    }
  });

  it('gives the notice the server shows for a market, with its version', () => {
    const n = content.notice('IN');
    expect(n).toMatchObject({ market: 'IN', version: 'draft-0', signed: false });
    expect(n.body).toContain('[PLACEHOLDER]');
    expect(content.notice('FR').market).toBe('global');
  });

  it('fails loudly when the content is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'edmate-age-'));
    expect(() => loadAgeContent(empty)).toThrow();
  });

  it('refuses a notice directory with a bad file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edmate-age-'));
    mkdirSync(join(dir, 'legal', 'privacy-notice'), { recursive: true });
    mkdirSync(join(dir, 'locales'));
    writeFileSync(join(dir, 'legal', 'privacy-notice', 'global.md'), 'no front matter');
    expect(() => loadAgeContent(dir)).toThrow(/privacy notice/);
  });
});

describe('submitAgeAnswer', () => {
  it('an adult: clear, stores the server notice version, keeps the session', async () => {
    const t = await setup();
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, t.deps)).toEqual({
      status: 'clear',
    });
    expect(t.identity.consents).toEqual([
      expect.objectContaining({ userId: t.user.id, kind: 'privacy_notice', version: 'draft-0' }),
    ]);
    expect(t.identity.ages.get(t.user.id)).toEqual({ birthYear: 1990, market: 'IN' });
    expect(t.jar.sets).toEqual([]);
  });

  it('13-17 in a consent market: parent_needed; a number year works too', async () => {
    const t = await setup();
    expect(await submitAgeAnswer({ market: 'global', birthYear: 2010 }, t.deps)).toEqual({
      status: 'parent_needed',
    });
  });

  it('a second answer returns the standing and writes nothing', async () => {
    const t = await setup();
    await submitAgeAnswer({ market: 'IN', birthYear: '2010' }, t.deps);
    const record = vi.spyOn(t.identity, 'recordAgeAnswer');
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, t.deps)).toEqual({
      status: 'parent_needed',
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('under 13: closed, erased, session cookie cleared, a 24 h httpOnly block cookie set', async () => {
    const t = await setup();
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '2015' }, t.deps)).toEqual({
      status: 'closed',
    });
    expect(t.identity.users.size).toBe(0);
    expect(t.identity.sessions.size).toBe(0);
    const base = { httpOnly: true, sameSite: 'lax', secure: false, path: '/' };
    expect(t.jar.sets).toEqual([
      { name: BLOCK, value: '1', options: { ...base, maxAge: AGE_BLOCK_MAX_AGE_S } },
      { name: SESSION, value: '', options: { ...base, maxAge: 0 } },
    ]);
    expect(AGE_BLOCK_MAX_AGE_S).toBe(24 * 60 * 60);
    expect(t.log).toEqual([]);
  });

  it('an erase the store could not finish: closed the same way; the account stays for staff, logged once with no detail', async () => {
    const t = await setup();
    t.identity.blockErase = true;
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '2015' }, t.deps)).toEqual({
      status: 'closed',
    });
    expect(t.identity.users.has(t.user.id)).toBe(true);
    expect(t.identity.ages.size).toBe(0);
    // The session itself is deleted, not just its cookie.
    expect(t.identity.sessions.size).toBe(0);
    expect(t.jar.values.get(BLOCK)).toBe('1');
    expect(t.jar.values.has(SESSION)).toBe(false);
    // One line, an opaque user id only: no email, name or birth year.
    expect(t.log).toEqual([`[auth] age gate: erase blocked, account held for user ${t.user.id}`]);
    expect(t.log.join(' ')).not.toContain(t.user.email ?? '\u0000');
    expect(t.log.join(' ')).not.toContain('2015');
  });

  it('fix round 1: blocked forever, a session created afterwards (any browser) is also shut out', async () => {
    const t = await setup();
    t.identity.blockErase = true;
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '2015' }, t.deps)).toEqual({
      status: 'closed',
    });
    expect(await t.identity.learnerStatus(t.user.id)).toBe('under_age');

    // Any later session for this user (another device, or a sign-in a composition root allowed
    // through some other path) resolves to `under_age`, which fails every clearance.
    const otherSid = 'other-sid'.padEnd(32, '1');
    await t.identity.createSession(otherSid, t.user.id, new Date(NOW.getTime() + 86_400_000));
    const otherJar = jar({ [SESSION]: otherSid });
    const otherDeps: AgeGateDeps = { ...t.deps, cookies: otherJar.cookies };
    expect(await ageGateView(otherDeps)).toEqual({ state: 'closed' });
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, otherDeps)).toEqual({
      status: 'closed',
    });
    expect(t.identity.ages.size).toBe(0);
  });

  it('a session delete that fails still closes the browser and is logged without detail', async () => {
    const t = await setup();
    t.identity.blockErase = true;
    t.identity.deleteSession = async () => {
      throw new Error('db down: postgres://u:p@host/x');
    };
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '2015' }, t.deps)).toEqual({
      status: 'closed',
    });
    expect(t.jar.values.get(BLOCK)).toBe('1');
    expect(t.log).toEqual([
      `[auth] age gate: erase blocked, account held for user ${t.user.id}`,
      '[auth] age gate: session delete failed Error',
    ]);
  });

  it('with no logger, a failed session delete goes to console.error by name only', async () => {
    const t = await setup();
    delete t.deps.log;
    t.identity.deleteSession = async () => {
      throw new Error('db down: postgres://u:p@host/x');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await submitAgeAnswer({ market: 'IN', birthYear: '2015' }, t.deps)).toEqual({
        status: 'closed',
      });
      expect(spy).toHaveBeenCalledWith('[auth] age gate: session delete failed Error');
    } finally {
      spy.mockRestore();
    }
  });

  it('a blocked browser is refused before anything is read or written', async () => {
    const t = await setup({ cookies: { [BLOCK]: '1' } });
    const record = vi.spyOn(t.identity, 'recordAgeAnswer');
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, t.deps)).toEqual({
      status: 'closed',
    });
    expect(record).not.toHaveBeenCalled();
    expect(t.identity.sessions.size).toBe(0);
  });

  it('refuses a bad answer as validation, naming no cut-off, and changes nothing', async () => {
    const t = await setup();
    const bad: unknown[] = [
      {},
      null,
      'IN',
      { market: 'IN' },
      { birthYear: '1990' },
      { market: 'FR', birthYear: '1990' },
      { market: 'in', birthYear: '1990' },
      { market: 'IN', birthYear: '' },
      { market: 'IN', birthYear: '90' },
      { market: 'IN', birthYear: '1990.5' },
      { market: 'IN', birthYear: 1990.5 },
      { market: 'IN', birthYear: '1899' },
      { market: 'IN', birthYear: '2027' },
      { market: 'IN', birthYear: '١٩٩٠' },
      // The notice version is the server's: a form that names one is refused outright.
      { market: 'IN', birthYear: '1990', noticeVersion: 'signed-v9' },
      { market: 'IN', birthYear: '1990', role: 'staff' },
    ];
    for (const input of bad) {
      const r = await submitAgeAnswer(input, t.deps);
      expect(r, JSON.stringify(input)).toEqual({
        error: {
          code: 'validation',
          message: 'Choose where you live and enter the year you were born.',
          retryable: false,
        },
      });
    }
    expect(t.identity.ages.size + t.identity.consents.length).toBe(0);
  });

  it('the account vanished mid-answer (not_found): closed, same as a normal erase', async () => {
    const t = await setup();
    t.identity.recordAgeAnswer = async () => {
      throw new RepositoryError('not_found', 'identity.recordAgeAnswer');
    };
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '2015' }, t.deps)).toEqual({
      status: 'closed',
    });
  });

  it('a store refusal (invalid) is validation, and nothing is erased', async () => {
    const t = await setup();
    t.deps.now = () => new Date('2031-01-01T00:00:00Z');
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '2030' }, t.deps)).toMatchObject({
      error: { code: 'validation', retryable: false },
    });
    expect(t.identity.users.size).toBe(1);
  });

  it('signed out is unauthorized; a teacher is forbidden', async () => {
    const t = await setup();
    t.jar.values.delete(SESSION);
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, t.deps)).toEqual({
      error: { code: 'unauthorized', message: 'Sign in first.', retryable: false },
    });
    const s = await setup();
    await s.identity.grantRole({ userId: s.user.id, role: 'teacher', by: 'operator' });
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, s.deps)).toMatchObject({
      error: { code: 'forbidden', retryable: false },
    });
  });

  it('a store failure is a retryable provider_error with no detail', async () => {
    for (const error of [
      new RepositoryError('failed', 'identity.recordAgeAnswer'),
      new Error('postgres://u:p@host'),
    ]) {
      const t = await setup();
      t.identity.recordAgeAnswer = async () => {
        throw error;
      };
      expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, t.deps)).toEqual({
        error: {
          code: 'provider_error',
          message: 'Could not save your answer. Try again.',
          retryable: true,
        },
      });
    }
    const t = await setup();
    t.deps.resolve = async () => {
      throw new Error('down');
    };
    expect(await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, t.deps)).toMatchObject({
      error: { code: 'provider_error', retryable: true },
    });
  });

  it('uses the __Host- names over https', () => {
    expect(ageBlockCookieName(true)).toBe('__Host-edmate.age-block');
    expect(ageBlockCookieName(false)).toBe('edmate.age-block');
  });

  it('marks the cookies Secure over https', async () => {
    const t = await setup();
    const secure = { ...t.deps, secureCookies: true };
    await submitAgeAnswer({ market: 'IN', birthYear: '2015' }, secure);
    expect(t.jar.sets.map((s) => [s.name, s.options.secure])).toEqual([
      ['__Host-edmate.age-block', true],
      [SESSION, true],
    ]);
  });
});

describe('ageGateView', () => {
  it('follows the learner: ask, then parent_needed or clear', async () => {
    const t = await setup();
    expect(await ageGateView(t.deps)).toEqual({ state: 'ask', markets: ['IN', 'US', 'global'] });
    await submitAgeAnswer({ market: 'IN', birthYear: '2010' }, t.deps);
    expect(await ageGateView(t.deps)).toEqual({ state: 'parent_needed' });
    const adult = await setup();
    await submitAgeAnswer({ market: 'IN', birthYear: '1990' }, adult.deps);
    expect(await ageGateView(adult.deps)).toEqual({ state: 'clear' });
  });

  it('closed for a blocked browser, sign_in when signed out, not_student for others', async () => {
    const blocked = await setup({ cookies: { [BLOCK]: '1' } });
    expect(await ageGateView(blocked.deps)).toEqual({ state: 'closed' });
    const t = await setup();
    t.jar.values.delete(SESSION);
    expect(await ageGateView(t.deps)).toEqual({ state: 'sign_in' });
    const s = await setup();
    await s.identity.grantRole({ userId: s.user.id, role: 'staff', by: 'operator' });
    expect(await ageGateView(s.deps)).toEqual({ state: 'not_student' });
  });
});
