// Task 9.9a: proves the live overlay (docker/compose.live.yaml, docker/Caddyfile.live) can't
// reopen the two production fail-closed checks it exists to close -- S3_ALLOW_HTTP and
// AGE_NOTICE_ALLOW_UNSIGNED. No docker binary in this worktree (same constraint as 9.9b and
// 1.4d), so this reads the two compose files as plain text/regex (no new js-yaml dependency for
// a single-pass build) rather than running a real `docker compose config` merge -- the lead/
// console runs that for real before merge (docs/tasks/9.9a/plan.md, "How a human verifies this").
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { storageConfigFromEnv } from '../src/storage/presign';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(dirname(HERE)));
const BASE_COMPOSE = readFileSync(join(REPO_ROOT, 'docker', 'compose.yaml'), 'utf8');
const LIVE_COMPOSE = readFileSync(join(REPO_ROOT, 'docker', 'compose.live.yaml'), 'utf8');

/** The named top-level service's block body (its own lines, indented under `  <service>:`), or
 * '' if the file doesn't mention that service at all -- Compose only re-merges services an
 * overlay file actually lists, so "absent" is a valid, meaningful state for an overlay file. */
function serviceBlock(composeText: string, service: string): string {
  const match = composeText.match(new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  \\S|$)`));
  return match?.[1] ?? '';
}

/** The literal text assigned to `key: ...` on its own line within a service block, with any
 * surrounding quotes stripped, or undefined if the key isn't there. */
function literalValue(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`\\n\\s+${key}:\\s*(.+)`));
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  return raw.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}

describe('live overlay: S3_ALLOW_HTTP / AGE_NOTICE_ALLOW_UNSIGNED stay literal, not defaulted', () => {
  const baseWeb = serviceBlock(BASE_COMPOSE, 'web');
  const liveWeb = serviceBlock(LIVE_COMPOSE, 'web');

  it('regression guard: the base dev stack still hardcodes both to the literal string true', () => {
    // If this ever stops being true, the premise of this whole test file changes.
    expect(literalValue(baseWeb, 'S3_ALLOW_HTTP')).toBe('true');
    expect(literalValue(baseWeb, 'AGE_NOTICE_ALLOW_UNSIGNED')).toBe('true');
  });

  it('the live overlay sets both to the literal string false, not a ${VAR:-...} default', () => {
    const allowHttp = literalValue(liveWeb, 'S3_ALLOW_HTTP');
    const allowUnsigned = literalValue(liveWeb, 'AGE_NOTICE_ALLOW_UNSIGNED');
    expect(allowHttp).toBe('false');
    expect(allowUnsigned).toBe('false');
    // Not an interpolation: a bare ${...} here would let a shell-exported S3_ALLOW_HTTP=true (or
    // a docker/.env that forgets to override it) leak straight through Compose's key-by-key,
    // last-file-wins environment merge.
    expect(allowHttp).not.toContain('${');
    expect(allowUnsigned).not.toContain('${');
  });

  it('the overlay never republishes mailpit or minio ports', () => {
    // mailpit is now mentioned (task 9.9d, STARTTLS cert wiring only) but must still never
    // republish its 127.0.0.1-only port binding, same shape as the minio assertion below.
    expect(serviceBlock(LIVE_COMPOSE, 'mailpit')).not.toContain('ports:');
    expect(serviceBlock(LIVE_COMPOSE, 'minio')).not.toContain('ports:');
  });

  it('S3_ALLOW_HTTP=false (from the overlay) is accepted by the real production storage check', () => {
    // The merged container env the live stack actually produces: NODE_ENV=production (base
    // x-app-env) plus the overlay's literal 'false' and non-placeholder S3 settings.
    const liveAllowHttp = literalValue(liveWeb, 'S3_ALLOW_HTTP');
    // Guard against a regex-parsing regression silently turning this into a vacuous pass: if
    // literalValue() ever failed to match, it'd return undefined, and undefined !== 'true' would
    // still land on the fail-closed path below without actually exercising the overlay's value.
    expect(liveAllowHttp).toBeDefined();
    expect(() =>
      storageConfigFromEnv({
        NODE_ENV: 'production',
        S3_ALLOW_HTTP: liveAllowHttp,
        S3_ENDPOINT: 'https://test.example.invalid/s3',
        S3_REGION: 'us-test-1',
        S3_ACCESS_KEY_ID: 'live-test-key',
        S3_SECRET_ACCESS_KEY: 'live-test-secret-value',
        S3_BUCKET: 'live-test-bucket',
      }),
    ).not.toThrow();
  });

  it('documents exactly why the overlay must never default S3_ALLOW_HTTP: true reopens plain http', () => {
    // Simulates what a weakened overlay (${S3_ALLOW_HTTP:-false} instead of a literal) would let
    // through: a shell-exported S3_ALLOW_HTTP=true, paired with a plain-http endpoint, is
    // accepted by the app whenever it's true -- the overlay's literal is the only thing standing
    // between a careless docker/.env and plain http reaching production.
    expect(() =>
      storageConfigFromEnv({
        NODE_ENV: 'production',
        S3_ALLOW_HTTP: 'true',
        S3_ENDPOINT: 'http://test.example.invalid/s3',
        S3_REGION: 'us-test-1',
        S3_ACCESS_KEY_ID: 'live-test-key',
        S3_SECRET_ACCESS_KEY: 'live-test-secret-value',
        S3_BUCKET: 'live-test-bucket',
      }),
    ).not.toThrow();
  });

  it('AGE_NOTICE_ALLOW_UNSIGNED=false (from the overlay) keeps the age gate exact-string check closed', () => {
    // apps/web/src/auth/index.ts: `process.env.AGE_NOTICE_ALLOW_UNSIGNED === 'true'`. Not
    // imported (getAgeContent isn't exported for this); the file's own comment states the
    // exact-string rule this reimplements.
    const allowUnsigned = literalValue(liveWeb, 'AGE_NOTICE_ALLOW_UNSIGNED');
    expect(allowUnsigned === 'true').toBe(false);
  });

  it("documents why the overlay must never default it: a defaulted 'true' reopens an unsigned notice", () => {
    // Same shape as the S3_ALLOW_HTTP case above: a weakened ${AGE_NOTICE_ALLOW_UNSIGNED:-false}
    // would still let a shell-exported 'true' (the base dev stack's own value) through the exact
    // equality check, which is exactly what the local try-it stack intentionally relies on.
    const devDefault = literalValue(baseWeb, 'AGE_NOTICE_ALLOW_UNSIGNED');
    expect(devDefault === 'true').toBe(true);
  });
});

describe('live overlay: S3 credentials never fall back to the dev stack placeholder values (B-69)', () => {
  const liveWeb = serviceBlock(LIVE_COMPOSE, 'web');
  const liveWorker = serviceBlock(LIVE_COMPOSE, 'worker');
  const CREDENTIAL_KEYS = ['S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET'] as const;

  it('compose.live.yaml requires each credential as a bare ${VAR}, no default, for web and worker', () => {
    // Not ${VAR:-edmate-dev} or similar: the overlay must not rely on apps/web's own
    // REQUIRED_IN_PRODUCTION/placeholder guard alone to keep the live stack off the dev
    // credentials -- it must never resolve a value for these four keys on its own either.
    for (const block of [liveWeb, liveWorker]) {
      for (const key of CREDENTIAL_KEYS) {
        expect(literalValue(block, key)).toBe(`\${${key}}`);
      }
    }
  });

  it("storageConfigFromEnv refuses the dev stack's own placeholder S3 credentials even under NODE_ENV=production", () => {
    // What would run if a live docker/.env were left empty and the shell/compose somehow still
    // resolved these four to docker/compose.yaml's own dev defaults (S3_REGION=us-east-1,
    // S3_ACCESS_KEY_ID=edmate-dev, S3_SECRET_ACCESS_KEY=edmate-dev-storage, S3_BUCKET=edmate-dev):
    // the app's own production guard is the second, independent layer behind the overlay's bare
    // ${VAR} requirement above, and it must still fail closed on its own.
    expect(() =>
      storageConfigFromEnv({
        NODE_ENV: 'production',
        S3_ALLOW_HTTP: 'false',
        S3_ENDPOINT: 'https://test.example.invalid/s3',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'edmate-dev',
        S3_SECRET_ACCESS_KEY: 'edmate-dev-storage',
        S3_BUCKET: 'edmate-dev',
      }),
    ).toThrow('S3_REGION_placeholder');
  });
});

describe('live overlay: mailpit STARTTLS cert (task 9.9d)', () => {
  const liveMailpit = serviceBlock(LIVE_COMPOSE, 'mailpit');
  const liveWeb = serviceBlock(LIVE_COMPOSE, 'web');
  const baseMailpit = serviceBlock(BASE_COMPOSE, 'mailpit');

  it("mailpit's overlay block wires in the self-signed cert and mounts it read-only", () => {
    expect(liveMailpit).toContain('MP_SMTP_TLS_CERT: /tls/cert.pem');
    expect(liveMailpit).toContain('MP_SMTP_TLS_KEY: /tls/key.pem');
    expect(liveMailpit).toMatch(/mailpit-tls:\/tls:ro/);
  });

  it("web's overlay block trusts the same cert file and mounts it read-only", () => {
    expect(liveWeb).toContain('NODE_EXTRA_CA_CERTS: /tls/cert.pem');
    expect(liveWeb).toMatch(/mailpit-tls:\/tls:ro/);
  });

  it('web trusts the byte-for-byte same cert path mailpit is given (why the fix works at all)', () => {
    const mailpitCertPath = literalValue(liveMailpit, 'MP_SMTP_TLS_CERT');
    const webTrustPath = literalValue(liveWeb, 'NODE_EXTRA_CA_CERTS');
    expect(mailpitCertPath).toBeDefined();
    expect(webTrustPath).toBe(mailpitCertPath);
  });

  it('a one-shot mailpit-cert service generates the cert into a writable mount of the same volume', () => {
    const certService = serviceBlock(LIVE_COMPOSE, 'mailpit-cert');
    expect(certService).not.toBe('');
    expect(certService).toContain('openssl req -x509');
    // Writable: a mailpit-tls:/tls line with no trailing :ro, distinct from mailpit's/web's
    // read-only mounts of the same volume.
    expect(certService).toMatch(/mailpit-tls:\/tls\n/);
    expect(certService).not.toMatch(/mailpit-tls:\/tls:ro/);
  });

  it('the top-level volumes block declares the named mailpit-tls volume', () => {
    expect(LIVE_COMPOSE).toMatch(/\nvolumes:\n(?:[\s\S]*?\n)? {2}mailpit-tls:/);
  });

  it('regression guard: the base compose file ships mailpit with no TLS cert of its own', () => {
    expect(baseMailpit).not.toContain('MP_SMTP_TLS_CERT');
  });
});
