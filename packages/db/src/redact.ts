/** Removes any connection string from an error message, so a password can't reach the logs. */
export function redact(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
}

/**
 * The connection string's scheme, host, port and database name only -- no userinfo (the
 * `user:password@` part), query or fragment. Mirrors
 * `packages/gateway/src/transcriber/source.ts`'s `redactUrl` (same shape, no shared import:
 * `packages/db` does not depend on `packages/gateway`). For a one-line "target" log before a CLI
 * opens its database handle, never the raw `DATABASE_URL`.
 */
export function redactTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable database url]';
  }
}
