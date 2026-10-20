// Auth.js adapter over the identity store (tasks 1.3, 1.4): only what Google and email magic-link
// sign-in with database sessions need. Roles, photos, OAuth tokens and any extra profile field
// never reach the store.
import type { IdentityStore, IdentityUser, Role } from '@edmate/db';
import type { Adapter, AdapterSession, AdapterUser } from 'next-auth/adapters';

/** An Auth.js user that also carries the role (read by the session callback). */
export type EdmateAdapterUser = AdapterUser & { role: Role };

export function toAdapterUser(u: IdentityUser): EdmateAdapterUser {
  return {
    id: u.id,
    email: u.email ?? '',
    emailVerified: u.emailVerifiedAt,
    name: u.name,
    role: u.role,
  };
}

const orNull = (u: IdentityUser | null) => (u ? toAdapterUser(u) : null);

function unsupported(method: string): never {
  throw new Error(`auth adapter: ${method} is not supported`);
}

export function toAuthAdapter(identity: IdentityStore): Adapter {
  return {
    async createUser(user) {
      // Copied field by field: `role`, `image` and anything else in the profile are dropped.
      const created = await identity.createStudent({
        email: user.email,
        emailVerifiedAt: user.emailVerified ?? null,
        name: user.name ?? '',
      });
      return toAdapterUser(created);
    },

    async getUser(id) {
      return orNull(await identity.getUser(id));
    },

    async getUserByEmail(email) {
      return orNull(await identity.getUserByEmail(email));
    },

    async getUserByAccount({ provider, providerAccountId }) {
      return orNull(await identity.getUserByAccount(provider, providerAccountId));
    },

    async updateUser(user) {
      // Sign-in may only record that the email was verified; every other field is ignored.
      if (user.emailVerified instanceof Date) {
        return toAdapterUser(await identity.markEmailVerified(user.id, user.emailVerified));
      }
      const current = await identity.getUser(user.id);
      if (!current) return unsupported('updateUser of an unknown user');
      return toAdapterUser(current);
    },

    async linkAccount(account) {
      // Access, refresh and id tokens are dropped: Edmate never calls the provider's APIs.
      await identity.linkAccount({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      });
    },

    async createSession({ sessionToken, userId, expires }): Promise<AdapterSession> {
      await identity.createSession(sessionToken, userId, expires);
      return { sessionToken, userId, expires };
    },

    async getSessionAndUser(sessionToken) {
      const found = await identity.getSessionAndUser(sessionToken);
      if (!found) return null;
      return {
        session: { sessionToken, userId: found.session.userId, expires: found.session.expires },
        user: toAdapterUser(found.user),
      };
    },

    async updateSession({ sessionToken, expires }) {
      if (!expires) return null;
      const updated = await identity.updateSession(sessionToken, expires);
      return updated ? { sessionToken, userId: updated.userId, expires: updated.expires } : null;
    },

    async deleteSession(sessionToken) {
      await identity.deleteSession(sessionToken);
    },

    // Email magic link (task 1.4). Auth.js passes `sha256(raw + AUTH_SECRET)`; the store keeps only
    // a hash of that and never returns it, so the token Auth.js handed in is echoed back.
    async createVerificationToken({ identifier, token, expires }) {
      const created = await identity.createVerificationToken({ identifier, token, expires });
      return { identifier: created.identifier, expires: created.expires, token };
    },

    async useVerificationToken({ identifier, token }) {
      const used = await identity.useVerificationToken({ identifier, token });
      return used ? { identifier: used.identifier, expires: used.expires, token } : null;
    },

    // Never called by Google or email sign-in; account deletion is 13.x and goes through its own path.
    deleteUser: () => unsupported('deleteUser'),
    unlinkAccount: () => unsupported('unlinkAccount'),
  };
}
