// An in-memory IdentityStore with the real store's rules (role forced to student, one account per
// provider id, expired sessions read as null, only grantRole changes a role). The real store is
// tested on Postgres in packages/db/test/identity.int.test.ts.
import type { GrantRoleInput, IdentityStore, IdentityUser } from '@edmate/db';

export interface MemoryIdentity extends IdentityStore {
  users: Map<string, IdentityUser>;
  accounts: Map<string, string>;
  sessions: Map<string, { userId: string; expires: Date }>;
  grants: GrantRoleInput[];
  /** Every createStudent input, as received. */
  created: unknown[];
  linked: unknown[];
}

export function memoryIdentity(now: () => Date = () => new Date()): MemoryIdentity {
  const users = new Map<string, IdentityUser>();
  const accounts = new Map<string, string>();
  const sessions = new Map<string, { userId: string; expires: Date }>();
  const grants: GrantRoleInput[] = [];
  const created: unknown[] = [];
  const linked: unknown[] = [];
  let next = 0;
  const live = (token: string) => {
    const s = sessions.get(token);
    return s && s.expires > now() ? s : undefined;
  };
  const byEmail = (email: string) =>
    [...users.values()].find((u) => u.email === email.trim().toLowerCase()) ?? null;

  return {
    users,
    accounts,
    sessions,
    grants,
    created,
    linked,
    async createStudent(input) {
      created.push(input);
      if (byEmail(input.email)) throw new Error('identity.createStudent: invalid');
      next += 1;
      const u: IdentityUser = {
        id: `usr_${next}`,
        role: 'student',
        email: input.email.trim().toLowerCase(),
        emailVerifiedAt: input.emailVerifiedAt,
        name: input.name,
      };
      users.set(u.id, u);
      return { ...u };
    },
    async getUser(id) {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    async getUserByEmail(email) {
      const u = byEmail(email);
      return u ? { ...u } : null;
    },
    async getUserByAccount(provider, providerAccountId) {
      const id = accounts.get(`${provider}:${providerAccountId}`);
      const u = id ? users.get(id) : undefined;
      return u ? { ...u } : null;
    },
    async markEmailVerified(userId, at) {
      const u = users.get(userId);
      if (!u) throw new Error('identity.markEmailVerified: not_found');
      u.emailVerifiedAt = at;
      return { ...u };
    },
    async linkAccount(input) {
      linked.push(input);
      const key = `${input.provider}:${input.providerAccountId}`;
      if (accounts.has(key)) throw new Error('identity.linkAccount: invalid');
      // One account per provider per user, like the unique (user_id, provider) index.
      for (const [k, userId] of accounts) {
        if (userId === input.userId && k.startsWith(`${input.provider}:`)) {
          throw new Error('identity.linkAccount: invalid');
        }
      }
      accounts.set(key, input.userId);
    },
    async createSession(token, userId, expires) {
      sessions.set(token, { userId, expires });
      return { userId, expires };
    },
    async getSessionAndUser(token) {
      const s = live(token);
      const u = s ? users.get(s.userId) : undefined;
      return s && u ? { session: { ...s }, user: { ...u } } : null;
    },
    async updateSession(token, expires) {
      const s = live(token);
      if (!s) return null;
      s.expires = expires;
      return { ...s };
    },
    async deleteSession(token) {
      sessions.delete(token);
    },
    async grantRole(input) {
      const u = users.get(input.userId);
      if (!u) throw new Error('identity.grantRole: not_found');
      grants.push(input);
      u.role = input.role;
      return { ...u };
    },
  };
}
