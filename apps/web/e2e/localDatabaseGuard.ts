// Task 9.7c (security-reviewer MEDIUM on 9.7a): global-setup.ts spawns `@edmate/db`'s migrate/seed
// CLIs and writes a staff role + teacher verification straight through `@edmate/db`'s repositories
// against whatever Postgres `TEST_DATABASE_URL` names -- unlike `stack/mail.ts`'s helpers, it had
// no check that the URL is actually the local test stack before doing any of that. This is the
// same local-host allowlist as `stack/mail.ts`'s `localUrl` (localhost / 127.0.0.1 / ::1); the e2e
// Postgres is always reached from the host (`packages/db/test/compose.port.yaml` publishes it on
// 127.0.0.1), never through a compose service name, so no extra hostname is needed here.
// `URL#hostname` keeps a bracketed IPv6 host's brackets (same as `stack/mail.ts`'s `LOCAL_HOSTS`).
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Parses `raw` as a Postgres URL and throws with a clear message unless its host is local.
 * Pure (no I/O): called before any write, same shape as `stack/mail.ts`'s `localUrl`. */
export function assertLocalDatabaseUrl(raw: string): void {
  const url = new URL(raw);
  if (!LOCAL_HOSTS.includes(url.hostname)) {
    throw new Error(
      `e2e global setup refuses a non-local TEST_DATABASE_URL host "${url.hostname}" -- ` +
        'this runs migrate/seed and writes a staff role and teacher verification; ' +
        'point TEST_DATABASE_URL at the local compose stack (localhost/127.0.0.1/::1) instead.',
    );
  }
}
