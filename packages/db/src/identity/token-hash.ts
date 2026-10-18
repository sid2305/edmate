import { createHash } from 'node:crypto';

/**
 * The stored form of a session token: hex SHA-256. The token is a random value from Auth.js (a
 * UUID), so a plain hash is enough; a copy of the database then holds no usable session.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
