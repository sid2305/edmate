// An in-memory IdentityStore with the real store's rules (role forced to student, one account per
// provider id, expired sessions read as null, only grantRole changes a role, one single-use sign-in
// link per address; since 1.7 one age answer per student, an under-age answer erasing the user and
// its sign-in rows, and the learner status). The real store is
// tested on Postgres in packages/db/test/identity.int.test.ts.
// Types only at the top: some tests mock '@edmate/db' with this fake, so the age rule is loaded
// lazily, when a method runs, to avoid a cycle through the mock.
import type { AgePolicy, GrantRoleInput, IdentityStore, IdentityUser } from '@edmate/db';

async function ageRule() {
  const db = await import('@edmate/db');
  return { ageStatus: db.ageStatus, defaultPolicy: db.DEFAULT_AGE_POLICY };
}

/** The real store's error for the age methods (loaded lazily, as above). */
async function repoError(kind: 'not_found' | 'scope' | 'invalid', method: string) {
  const { RepositoryError } = await import('@edmate/db');
  return new RepositoryError(kind, `identity.${method}`);
}

/** A consents row as the fake keeps it (1.7). */
export interface MemoryConsent {
  userId: string;
  kind: string;
  version: string;
  grantedBy: 'self' | 'parent';
  withdrawnAt: Date | null;
}

export interface MemoryIdentity extends IdentityStore {
  users: Map<string, IdentityUser>;
  accounts: Map<string, string>;
  sessions: Map<string, { userId: string; expires: Date }>;
  /** Sign-in links by lower-cased address (the real store keeps only a hash). */
  links: Map<string, { token: string; expires: Date }>;
  grants: GrantRoleInput[];
  /** Age answers by user id (1.7): the stored birth year and market. */
  ages: Map<string, { birthYear: number; market: string }>;
  consents: MemoryConsent[];
  /** Every createStudent input, as received. */
  created: unknown[];
  linked: unknown[];
  /**
   * When true, an under-age erase is blocked (as a row the store doesn't own would block it):
   * `recordAgeAnswer` deletes the sign-in rows and consents but keeps the user, marked blocked
   * (`ageBlocked`), and returns `erase_blocked` (1.7 fix round 1).
   */
  blockErase: boolean;
  /** User ids an under-age erase couldn't finish (fix round 1): blocked forever. */
  ageBlocked: Set<string>;
}

export function memoryIdentity(
  now: () => Date = () => new Date(),
  agePolicy?: (market: string) => AgePolicy,
): MemoryIdentity {
  const users = new Map<string, IdentityUser>();
  const accounts = new Map<string, string>();
  const sessions = new Map<string, { userId: string; expires: Date }>();
  const links = new Map<string, { token: string; expires: Date }>();
  const grants: GrantRoleInput[] = [];
  const ages = new Map<string, { birthYear: number; market: string }>();
  const consents: MemoryConsent[] = [];
  const created: unknown[] = [];
  const linked: unknown[] = [];
  const ageBlocked = new Set<string>();
  let next = 0;
  const live = (token: string) => {
    const s = sessions.get(token);
    return s && s.expires > now() ? s : undefined;
  };
  const byEmail = (email: string) =>
    [...users.values()].find((u) => u.email === email.trim().toLowerCase()) ?? null;
  const parentConsent = (userId: string) =>
    consents.some(
      (c) =>
        c.userId === userId &&
        c.kind === 'parental' &&
        c.grantedBy === 'parent' &&
        c.withdrawnAt === null,
    );

  const self: MemoryIdentity = {
    blockErase: false,
    ageBlocked,
    users,
    accounts,
    sessions,
    links,
    grants,
    ages,
    consents,
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
    // 9.4a: `global` from signup, the age-gate answer's market after; null for an unknown id.
    async getMarket(id) {
      if (!users.has(id)) return null;
      return ages.get(id)?.market ?? 'global';
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
    async createVerificationToken({ identifier, token, expires }) {
      const id = identifier.trim().toLowerCase();
      // One row per address: a new link replaces the old one.
      links.set(id, { token, expires });
      return { identifier: id, expires };
    },
    async useVerificationToken({ identifier, token }) {
      const id = identifier.trim().toLowerCase();
      const l = links.get(id);
      if (!l || l.token !== token) return null;
      links.delete(id);
      return l.expires > now() ? { identifier: id, expires: l.expires } : null;
    },
    async grantRole(input) {
      const u = users.get(input.userId);
      if (!u) throw new Error('identity.grantRole: not_found');
      grants.push(input);
      u.role = input.role;
      return { ...u };
    },
    async recordAgeAnswer({ userId, market, birthYear, noticeVersion }) {
      const u = users.get(userId);
      if (!u) throw await repoError('not_found', 'recordAgeAnswer');
      if (u.role !== 'student') throw await repoError('scope', 'recordAgeAnswer');
      if (ages.has(userId) || ageBlocked.has(userId)) {
        throw await repoError('invalid', 'recordAgeAnswer');
      }
      if (birthYear > now().getUTCFullYear()) throw await repoError('invalid', 'recordAgeAnswer');
      const { ageStatus, defaultPolicy } = await ageRule();
      const status = ageStatus({
        birthYear,
        policy: agePolicy ? agePolicy(market) : defaultPolicy,
        parentConsent: parentConsent(userId),
        now: now(),
      });
      if (status === 'under_age') {
        // Sign-in rows and consents belong to this store: deleted whether or not the user row
        // itself can be erased (fix round 1).
        for (const [k, id] of accounts) if (id === userId) accounts.delete(k);
        for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t);
        if (u.email) links.delete(u.email);
        for (let i = consents.length - 1; i >= 0; i -= 1) {
          if (consents[i]?.userId === userId) consents.splice(i, 1);
        }
        if (self.blockErase) {
          // A row the store doesn't own blocks only the user delete: it stays, blocked forever.
          ageBlocked.add(userId);
          return { status: 'erase_blocked' };
        }
        users.delete(userId);
        return { status };
      }
      ages.set(userId, { birthYear, market });
      consents.push({
        userId,
        kind: 'privacy_notice',
        version: noticeVersion,
        grantedBy: 'self',
        withdrawnAt: null,
      });
      return { status };
    },
    async learnerStatus(userId) {
      const u = users.get(userId);
      if (!u) throw await repoError('not_found', 'learnerStatus');
      if (u.role !== 'student') throw await repoError('scope', 'learnerStatus');
      if (ageBlocked.has(userId)) return 'under_age';
      const a = ages.get(userId);
      if (!a) return 'age_needed';
      const { ageStatus, defaultPolicy } = await ageRule();
      const status = ageStatus({
        birthYear: a.birthYear,
        policy: agePolicy ? agePolicy(a.market) : defaultPolicy,
        parentConsent: parentConsent(userId),
        now: now(),
      });
      return status === 'under_age' ? 'parent_needed' : status;
    },
  };
  return self;
}
