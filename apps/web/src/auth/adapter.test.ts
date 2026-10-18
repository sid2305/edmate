// Task 1.3: the Auth.js adapter never lets a role, photo, OAuth token or extra field reach the
// identity store.
import { randomUUID } from 'node:crypto';
import type { AdapterAccount, AdapterUser } from 'next-auth/adapters';
import { describe, expect, it } from 'vitest';
import { memoryIdentity } from '../../test/memory-identity';
import { toAdapterUser, toAuthAdapter } from './adapter';

const SOON = () => new Date(Date.now() + 60_000);
const TOKEN = randomUUID();

function setup() {
  const identity = memoryIdentity();
  return { identity, adapter: toAuthAdapter(identity) };
}

describe('toAuthAdapter', () => {
  it('createUser copies only email, emailVerified and name; role, image and extras are dropped', async () => {
    const { identity, adapter } = setup();
    const user = await adapter.createUser!({
      id: 'attacker-chosen-id',
      email: 'a@example.test',
      emailVerified: null,
      name: 'Asha',
      image: 'https://photo.example/a.jpg',
      role: 'staff',
      market: 'in',
    } as AdapterUser);
    expect(identity.created).toEqual([
      { email: 'a@example.test', emailVerifiedAt: null, name: 'Asha' },
    ]);
    expect(user).toEqual({
      id: 'usr_1',
      email: 'a@example.test',
      emailVerified: null,
      name: 'Asha',
      role: 'student',
    });
  });

  it('createUser with no name stores an empty name', async () => {
    const { identity, adapter } = setup();
    const at = new Date('2026-10-18T00:00:00Z');
    await adapter.createUser!({
      id: 'x',
      email: 'b@example.test',
      emailVerified: at,
    } as AdapterUser);
    expect(identity.created).toEqual([{ email: 'b@example.test', emailVerifiedAt: at, name: '' }]);
  });

  it('getUser, getUserByEmail and getUserByAccount map users or null', async () => {
    const { identity, adapter } = setup();
    const u = await identity.createStudent({
      email: 'c@example.test',
      emailVerifiedAt: null,
      name: 'C',
    });
    await identity.linkAccount({
      userId: u.id,
      type: 'oidc',
      provider: 'google',
      providerAccountId: 'g1',
    });
    const mapped = toAdapterUser(u);
    expect(await adapter.getUser!(u.id)).toEqual(mapped);
    expect(await adapter.getUserByEmail!('c@example.test')).toEqual(mapped);
    expect(
      await adapter.getUserByAccount!({ provider: 'google', providerAccountId: 'g1' }),
    ).toEqual(mapped);
    expect(await adapter.getUser!('usr_none')).toBeNull();
    expect(await adapter.getUserByEmail!('none@example.test')).toBeNull();
    expect(
      await adapter.getUserByAccount!({ provider: 'google', providerAccountId: 'none' }),
    ).toBeNull();
  });

  it('toAdapterUser maps a user with no email (phone sign-in later) to an empty email', () => {
    expect(
      toAdapterUser({ id: 'u', role: 'teacher', email: null, emailVerifiedAt: null, name: 'N' }),
    ).toEqual({ id: 'u', email: '', emailVerified: null, name: 'N', role: 'teacher' });
  });

  it('updateUser only records emailVerified; every other field, including role, is ignored', async () => {
    const { identity, adapter } = setup();
    const u = await identity.createStudent({
      email: 'd@example.test',
      emailVerifiedAt: null,
      name: 'D',
    });
    const at = new Date('2026-10-18T09:00:00Z');
    const out = await adapter.updateUser!({
      id: u.id,
      emailVerified: at,
      name: 'Changed',
      role: 'staff',
    } as Partial<AdapterUser> & { id: string });
    expect(out).toMatchObject({ id: u.id, name: 'D', role: 'student', emailVerified: at });
    const same = await adapter.updateUser!({ id: u.id, name: 'Changed again', image: 'x' });
    expect(same).toMatchObject({ name: 'D', role: 'student' });
    expect(identity.users.get(u.id)).toMatchObject({ name: 'D', role: 'student' });
    await expect(adapter.updateUser!({ id: 'usr_none', name: 'x' })).rejects.toThrow(
      'not supported',
    );
  });

  it('linkAccount drops access, refresh and id tokens', async () => {
    const { identity, adapter } = setup();
    const u = await identity.createStudent({
      email: 'e@example.test',
      emailVerifiedAt: null,
      name: 'E',
    });
    await adapter.linkAccount!({
      userId: u.id,
      type: 'oidc',
      provider: 'google',
      providerAccountId: 'g-e',
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      id_token: 'test-id-token',
      expires_at: 123,
      scope: 'openid',
      token_type: 'bearer',
    } as AdapterAccount);
    expect(identity.linked).toEqual([
      { userId: u.id, type: 'oidc', provider: 'google', providerAccountId: 'g-e' },
    ]);
  });

  it('sessions: create, read with the role, update, delete', async () => {
    const { identity, adapter } = setup();
    const u = await identity.createStudent({
      email: 'f@example.test',
      emailVerifiedAt: null,
      name: 'F',
    });
    const exp = SOON();
    expect(
      await adapter.createSession!({ sessionToken: TOKEN, userId: u.id, expires: exp }),
    ).toEqual({
      sessionToken: TOKEN,
      userId: u.id,
      expires: exp,
    });
    expect(await adapter.getSessionAndUser!(TOKEN)).toEqual({
      session: { sessionToken: TOKEN, userId: u.id, expires: exp },
      user: toAdapterUser(u),
    });
    const later = new Date(Date.now() + 120_000);
    expect(await adapter.updateSession!({ sessionToken: TOKEN, expires: later })).toEqual({
      sessionToken: TOKEN,
      userId: u.id,
      expires: later,
    });
    expect(await adapter.updateSession!({ sessionToken: TOKEN })).toBeNull();
    expect(
      await adapter.updateSession!({ sessionToken: 'missing-token-0000', expires: later }),
    ).toBeNull();
    await adapter.deleteSession!(TOKEN);
    expect(await adapter.getSessionAndUser!(TOKEN)).toBeNull();
  });

  it('refuses deleteUser and unlinkAccount', async () => {
    const { adapter } = setup();
    expect(() => adapter.deleteUser!('usr_1')).toThrow('deleteUser is not supported');
    expect(() => adapter.unlinkAccount!({ provider: 'google', providerAccountId: 'g' })).toThrow(
      'unlinkAccount is not supported',
    );
    expect(adapter.createVerificationToken).toBeUndefined();
    expect(adapter.useVerificationToken).toBeUndefined();
  });
});
