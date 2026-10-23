// The local stack's wiring (task 9.0, W1-W4, W6): text checks over the web image and compose file,
// so a try-it run can't 503 on a missing content dir or env line. Each check is also run on a
// mutated copy of the text, to prove it catches its fault.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DOCKERFILE = readFileSync(join(ROOT, 'apps/web/Dockerfile'), 'utf8');
const COMPOSE = readFileSync(join(ROOT, 'docker/compose.yaml'), 'utf8');
const TURN_RUNTIME = readFileSync(join(ROOT, 'apps/web/src/turn/runtime.ts'), 'utf8');

/** Every content dir the web reads at run time (age gate, legal, turn runtime). */
const RUNTIME_CONTENT = ['locales', 'legal', 'prompt-packs', 'skills'] as const;

function copiesContent(dockerfile: string, dir: string): boolean {
  const line = new RegExp(`^COPY --from=build [^\\n]*/repo/content/${dir} \\./content/${dir}\\s*$`, 'm');
  return line.test(dockerfile);
}

/** The text of one top-level service block in compose.yaml (up to the next service). */
function service(compose: string, name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  if (start < 0) return '';
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The `${VAR:-default}` default a service passes for `name`, or undefined if not passed. */
function passed(block: string, name: string): string | undefined {
  const m = new RegExp(`^\\s+${name}: \\$\\{${name}:-([^}]*)\\}\\s*$`, 'm').exec(block);
  return m?.[1];
}

describe('apps/web/Dockerfile', () => {
  for (const dir of RUNTIME_CONTENT) {
    it(`copies content/${dir} into the runtime image`, () => {
      expect(copiesContent(DOCKERFILE, dir)).toBe(true);
      const mutated = DOCKERFILE.replace(new RegExp(`^COPY [^\\n]*content/${dir} [^\\n]*$`, 'gm'), '');
      expect(copiesContent(mutated, dir)).toBe(false);
    });
  }
});

describe('docker/compose.yaml web', () => {
  const web = service(COMPOSE, 'web');

  // 9.4a: the studio test chat's preview market only (no student there); see the next test.
  it('passes EDMATE_MARKET (studio preview) with a default that has a locale pack', () => {
    const market = passed(web, 'EDMATE_MARKET');
    expect(market).toBeTruthy();
    expect(existsSync(join(ROOT, 'content/locales', `${market ?? ''}.yaml`))).toBe(true);
    expect(passed(web.replace(/EDMATE_MARKET/g, 'EDMATE_OTHER'), 'EDMATE_MARKET')).toBeUndefined();
    const bad = web.replace(/\$\{EDMATE_MARKET:-[^}]*\}/, '${EDMATE_MARKET:-ZZ}');
    expect(existsSync(join(ROOT, 'content/locales', `${passed(bad, 'EDMATE_MARKET') ?? ''}.yaml`))).toBe(false);
  });

  it("no env var picks a student's market: the student turn runtime never reads EDMATE_MARKET (9.4a)", () => {
    const readsMarket = (src: string) => /\bEDMATE_MARKET\b/.test(src);
    expect(readsMarket(TURN_RUNTIME)).toBe(false);
    expect(readsMarket(`${TURN_RUNTIME}\nconst m = env.EDMATE_MARKET;`)).toBe(true);
  });

  it('passes EDMATE_CHAT_AGENTS defaulting to demo-agent', () => {
    expect(passed(web, 'EDMATE_CHAT_AGENTS')).toBe('demo-agent');
    expect(passed(web.replace('demo-agent', ''), 'EDMATE_CHAT_AGENTS')).not.toBe('demo-agent');
  });

  it('passes the Anthropic key through, with no default', () => {
    expect(passed(web, 'EDMATE_ANTHROPIC_API_KEY')).toBe('');
    expect(passed(web.replace(/^.*EDMATE_ANTHROPIC_API_KEY.*$/m, ''), 'EDMATE_ANTHROPIC_API_KEY')).toBeUndefined();
  });

  it('passes EDMATE_DEV_MODEL off by default', () => {
    expect(passed(web, 'EDMATE_DEV_MODEL')).toBe('');
    expect(passed(web.replace('${EDMATE_DEV_MODEL:-}', '${EDMATE_DEV_MODEL:-scripted}'), 'EDMATE_DEV_MODEL')).not.toBe('');
  });

  it('does not wire the worker-only settings into web', () => {
    expect(passed(web, 'EDMATE_INGEST_EMBEDDINGS')).toBeUndefined();
  });
});

describe('docker/compose.yaml worker', () => {
  const worker = service(COMPOSE, 'worker');

  it('passes the OpenAI key through, with no default', () => {
    expect(passed(worker, 'EDMATE_OPENAI_API_KEY')).toBe('');
    expect(passed(worker.replace(/^.*EDMATE_OPENAI_API_KEY.*$/m, ''), 'EDMATE_OPENAI_API_KEY')).toBeUndefined();
  });

  it('passes EDMATE_INGEST_EMBEDDINGS, off by default for the local stack', () => {
    expect(passed(worker, 'EDMATE_INGEST_EMBEDDINGS')).toBe('off');
    expect(passed(worker.replace(/^.*EDMATE_INGEST_EMBEDDINGS.*$/m, ''), 'EDMATE_INGEST_EMBEDDINGS')).toBeUndefined();
  });

  it('does not get the dev model or the Anthropic key', () => {
    expect(passed(worker, 'EDMATE_DEV_MODEL')).toBeUndefined();
    expect(passed(worker, 'EDMATE_ANTHROPIC_API_KEY')).toBeUndefined();
  });
});

describe('service()', () => {
  it('returns nothing for a missing service', () => {
    expect(service(COMPOSE, 'nope')).toBe('');
  });
});
