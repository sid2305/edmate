import { createHash } from 'node:crypto';

/**
 * The stored form of a session token: hex SHA-256. The token is a random value from Auth.js (a
 * UUID), so a plain hash is enough; a copy of the database then holds no usable session.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The stored form of an email sign-in token (1.4): the same hex SHA-256. Auth.js already hands
 * the store `sha256(rawToken + AUTH_SECRET)`, so the database holds a hash of a hash, and the
 * rule "never a raw token" does not depend on Auth.js.
 */
export const hashToken = hashSessionToken;
