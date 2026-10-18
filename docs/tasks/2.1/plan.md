# Task 2.1: Provider keys from the environment / secret manager

Board: `python3 .claude/skills/board/board.py show 2.1` · Milestone M2 · deps: M0 · branch `m2/2.1-provider-keys` · **risky** (`packages/gateway/src/keys/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Provider keys from the environment / secret manager"
Accept: "a log-scan test proves no key appears in logs, traces or API responses."

Spec it must honour:
- Build plan § Tech stack, Secrets: "Provider keys and payment secrets from the environment / secret manager; never in the DB, logs or repo".
- Build plan § Tech stack, Model access: "Edmate-held keys; MVP: one main provider + OpenAI-compatible (covers OpenRouter)".
- Build plan § Model gateway, Keys: "Edmate-held provider keys from the environment / secret manager, only on provider tiers that do not train on inputs. Never logged, stored in the DB, or returned by any API."
- Rules 4 and 5: no real model calls in tests; never log or persist secrets; the repo is public.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Log-scan test | Output of `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...`, listing every case in `test/keys/log-scan.test.ts` (logs, traces, API responses, errors), all green. |
| The scan is not vacuous | The positive-control case passes: a raw string logged on purpose is found by the same scanner. |
| Fail fast without echoing | The `load.test.ts` cases: the error names the variable, and its message, stack, `JSON.stringify` and `util.inspect` contain no part of the value. |
| Coverage | The coverage table: `src/keys/**` at 100%, the package at 80% or more. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` exits 0. |

## Design

Keys enter the process through one door (`src/keys`), are wrapped right away in a `Secret` that cannot be printed or serialised, and leave only through `Secret.reveal()`. Only the adapters (task 2.2) call `reveal()`, at the moment they build a provider client. Keys never reach the harness: the `ModelGateway` port in contracts carries no keys. Contracts are unchanged.

### `src/keys/secret.ts`: `Secret`
- `Secret.of(value: string): Secret`. The value is held in a module-private `WeakMap<Secret, string>`, not on the instance. A `#private` field is fine too, but only if the `customInspect: false` and `showHidden: true` test passes. The instance is frozen.
- `reveal(): string` is the only way to read the value.
- `toString()`, `toJSON()`, `valueOf()`, `[Symbol.toPrimitive]` and `[Symbol.for('nodejs.util.inspect.custom')]` all return the string `[redacted]`; inspect may return `Secret([redacted])`. Use `Symbol.for(...)`, not an import of `node:util`, so `src` needs no Node types.
- No prefix, suffix, length or hash of the value is ever shown.

### `src/keys/providers.ts`: what each provider needs
- `PROVIDER_KEYS`, a `const` table: provider id → field → `{ variable: '<ENV NAME>' }`. MVP content: provider `openai-compatible`, field `apiKey`, variable `EDMATE_OPENAI_COMPATIBLE_API_KEY`.
- **Secret-scan note:** keep the `{ variable: ... }` wrapper. Writing a field named like `apiKey` straight next to a quoted string of 16 or more characters trips the scanner's "Hard-coded secret" rule at edit time.
- `type ProviderId = keyof typeof PROVIDER_KEYS`.
- `type KeysFor<P extends ProviderId>`: a readonly object with one `Secret` per field of `P`.
- A provider can need several secrets (for example a key plus a credentials JSON), so each entry maps fields to variables.
- The main provider's entry is added by 2.2: one entry here and one line in env.example (see Q1).
- Variables use the `EDMATE_` prefix. AI SDK provider packages read `OPENAI_API_KEY` and similar names on their own if no key is passed. Our own names mean a key reaches an SDK only through this module (Q2).

### `src/keys/source.ts`: the secret-manager seam (interface only)
- `interface KeySource { readonly name: string; read(variables: readonly string[]): Promise<Readonly<Record<string, string | undefined>>> }`.
- `envKeySource(env: Readonly<Record<string, string | undefined>>): KeySource` returns `name: 'environment'` and copies only the variables it is asked for. The caller passes `process.env`, so `src` reads no global.
- No vendor adapter. The spec names none.
- If `read` rejects (for example, a secret manager is down later), the loader throws `KeyConfigError` "could not read provider keys from <source.name>" and drops the original error. Not even as `cause`: it might hold a value.

### `src/keys/load.ts`: `loadProviderKeys`
- Signature: `loadProviderKeys(opts: { source: KeySource; required: readonly ProviderId[] }): Promise<ProviderKeys>`. It is async, so a secret manager can be added later without changing callers. It is called once at startup.
- Each value is checked with one Zod schema (`keyValueSchema`, in `schema.ts`). Problems, in order:
  - missing (`undefined`);
  - empty after trim;
  - surrounding whitespace, or whitespace or newlines inside;
  - wrapped in quotes (a common env-file mistake);
  - looks like a placeholder: `changeme`, `replace-me`, `your-...`, `<...>`, `xxx...`, `todo`, case-insensitive;
  - too short: under 16 characters.
- Each failure maps to a fixed problem code. **The loader builds its own messages and never passes on Zod issues or the input.**
- **Required** providers: every variable must be present and valid.
- **Optional** providers (configured but not required): if any of their variables is set, all must be valid. A malformed optional key fails fast; it is never skipped silently.
- Every problem is collected first, then one error is thrown:
  - `KeyConfigError extends Error`, `name: 'KeyConfigError'`;
  - `problems: readonly { variable: string; problem: 'missing' | 'empty' | 'whitespace' | 'quoted' | 'placeholder' | 'too_short' }[]`;
  - message, for example: `Provider keys are not configured correctly: EDMATE_OPENAI_COMPATIBLE_API_KEY is missing. Set it in the environment or the secret manager (see docker/env.example).`
  - It never contains a value, a length or a fragment.
- What it returns, `ProviderKeys`, is frozen and has no prototype:
  - `has(p)`;
  - `get<P>(p): KeysFor<P>`, which throws `KeyConfigError` "no keys loaded for <p>" if that provider wasn't loaded;
  - `providers(): readonly ProviderId[]`;
  - `toJSON()` returns `{ providers: [...] }` only.
- Keys are read once. Rotating a key means a restart (decision below).

### `src/keys/index.ts` and `src/index.ts`
- The barrel exports `Secret`, `PROVIDER_KEYS`, `ProviderId`, `KeysFor`, `KeySource`, `envKeySource`, `loadProviderKeys`, `ProviderKeys` and `KeyConfigError`.
- `src/index.ts` re-exports them. `keyValueSchema` stays internal.

### env.example
A new section, "Model provider keys (task 2.1)":
- `EDMATE_OPENAI_COMPATIBLE_API_KEY=` with an **empty** value.
- Comments:
  - there is no default; local dev and tests need no key (scripted gateway, rule 4);
  - set it only in your shell, a gitignored env file or the production secret manager, never in the repo;
  - use only provider tiers that do not train on inputs;
  - a leaked key is rotated, not just deleted.
- The file's header line "every value below is already the built-in default" gets "except the provider keys, which have none".
- No compose wiring yet: the apps don't build a gateway until a later task.

## Files

### Create
- `packages/gateway/src/keys/secret.ts`, `providers.ts`, `source.ts`, `schema.ts`, `load.ts`, `index.ts`
- `packages/gateway/test/keys/secret.test.ts`, `source.test.ts`, `load.test.ts`, `log-scan.test.ts`, `single-door.test.ts`
- `packages/gateway/test/helpers/fake-key.ts`
- `packages/gateway/vitest.config.ts`: include `test/**/*.test.ts`. Coverage thresholds: 80% globally, **100% for `src/keys/**`** (per-glob thresholds).
- `packages/gateway/tsconfig.build.json`: `rootDir: src`, `outDir: dist`, include `src`, `types: []`. This keeps `dist/index.js` and the exports unchanged.
- `packages/gateway/README.md`: a short section on keys: the one door, `reveal()` only in adapters, and the env variables.
- `docs/tasks/2.1/handoff.md` (builder), `docs/tasks/2.1/review.md` (reviewers)

### Modify
- `packages/gateway/package.json`:
  - `"test": "vitest run --coverage"`, and `build` uses `tsconfig.build.json`;
  - dependency `zod` `4.6.7`, pinned exactly like contracts;
  - devDependencies `vitest` `5.0.5`, `@vitest/coverage-v8` `5.0.5`, `@types/node` `22.20.5`, and `pino`, pinned exactly to the current stable version (the builder looks it up with `docs-lookup`; Pino is in the stack, Observability row);
  - the description drops "(empty until M2)".
- `packages/gateway/tsconfig.json`: like contracts (`rootDir: .`, `noEmit`, `types: ["node"]`, include `src`, `test`, `*.config.ts`).
- `packages/gateway/src/index.ts`: re-export keys.
- `docker/env.example`: the section above.
- `pnpm-lock.yaml`: from `corepack pnpm install`.

### Out of bounds
- Provider adapters, AI SDK packages and capability declarations (2.2).
- Routing and fallback (2.3), metering (2.4), limits (2.5), scripted gateway (2.6), transcriber and embeddings (2.7).
- `packages/contracts/**` (no contract change, so no ADR).
- `apps/**`: wiring the loader into web and worker startup comes when they build the gateway.
- `docker/compose.yaml`.
- `packages/payments/**`: payment secrets come later, in M10. Its keys can reuse `Secret` and `KeySource` then.
- `.claude/**`, `.githooks/**`, `.github/**`, `docs/adr/**`.

## Tests first (Vitest, no network, no real keys)

**Fake keys.** `test/helpers/fake-key.ts` exports `fakeKey()`, which returns `'fake-' + randomBytes(24).toString('hex')` (node:crypto). It is generated at runtime and has no `sk-`, `AIza` or other scanner prefix. **No test file contains a literal key-shaped string, or a key-named field or variable assigned a quoted string of 16 or more characters** (the scanner's "Hard-coded secret" rule). Placeholder tests use short literals such as `changeme` and `<your-key>`. Build long invalid values at runtime, for example `'x'.repeat(20)`.

**Assertions.** Assert leaks with `expect(corpus.includes(key)).toBe(false)`, not `not.toContain`, so a failure never prints the value in CI logs. No snapshots of anything that holds a key.

1. **secret.test.ts**
   - `reveal()` returns the value.
   - `String()`, a template literal, `+ ''`, `JSON.stringify` (alone and nested), `util.inspect` (default, `depth: Infinity`, `showHidden: true`, `customInspect: false`), `console.log` formatting (`util.format('%s %o %j')`), `Object.keys`, `Object.entries`, spread, `structuredClone` and `Object.getOwnPropertyNames`: none contain the value.
   - The instance is frozen.
2. **source.test.ts**: `envKeySource` returns only the requested variables, ignores the others, and is named `environment`.
3. **load.test.ts**
   - Happy path: typed access `keys.get('openai-compatible').apiKey.reveal()`.
   - One case per problem code.
   - Several problems give one error listing every variable.
   - A required provider is missing.
   - An optional provider that is unset is skipped; an optional provider that is set but malformed throws.
   - `get` on a provider that wasn't loaded throws `KeyConfigError` naming it.
   - A `KeySource` whose `read` rejects (its error message contains the fake key) gives `KeyConfigError` naming the source, with no `cause`, and the key is absent.
   - For every error case: `message`, `stack`, `JSON.stringify(err)`, `util.inspect(err)` and `String(err)` contain no part of the value. Checked as "no 8-character substring of the value", so a fragment can't leak either.
   - `ProviderKeys` `toJSON` returns the provider names only.
4. **log-scan.test.ts (the acceptance test)**
   - Setup: load real `ProviderKeys` from `envKeySource` with `EDMATE_OPENAI_COMPATIBLE_API_KEY` set to `fakeKey()`, then send the keys object, the `Secret` and an object holding them through every sink below. All output is collected into one corpus.
   - **Logs:**
     - a real Pino logger writing to an in-memory `Writable`: `log.info({ keys })`, `log.info({ secret })`, `log.error({ err })`, where `err` was built with the secret in a template literal and attached to `cause`;
     - `console.log/info/warn/error/debug`, with `process.stdout.write` and `process.stderr.write` spied.
   - **Traces:** an in-memory `TraceSink`-style recorder that `JSON.stringify`s what it's given, fed an object holding `keys` and `secret`. The real `TurnTrace` schema has no field for them, and the strict contracts schema would reject one.
   - **API responses:** `Response.json({ keys, secret })` and `new Response(JSON.stringify(...))`, read back with `.text()`; an error body built from a `KeyConfigError`.
   - **Assert:** the corpus contains no 8-character substring of the key. **Positive control:** logging `secret.reveal()` on purpose is caught by the same scan function.
5. **single-door.test.ts**
   - Reads `packages/gateway/src/**/*.ts` with fs.
   - `process.env` appears only in no file (the caller passes the env in).
   - `.reveal(` appears only under `src/keys/` and `src/adapters/` (2.2 will add the second folder).
   - A regex finds no `console.` calls in `src/keys/`.

Commands: `source ~/.nvm/nvm.sh && corepack pnpm install`, then `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...`, then `python3 .githooks/secret-scan.py --all`.

## Implementation order
1. Package scaffolding: package.json, both tsconfigs, vitest config, install. The test script runs with no tests yet.
2. `fake-key.ts`, then `secret.test.ts` (red), then `secret.ts` (green).
3. `source.test.ts`, then `source.ts`.
4. `load.test.ts`, then `schema.ts`, `providers.ts`, `load.ts`.
5. `log-scan.test.ts` and `single-door.test.ts`: green with no new src code, or fix `Secret`.
6. Barrels, env.example, README.
7. Secret scan, coverage, handoff.

The estimate is about 450 changed lines, excluding the lockfile.

## Risky paths touched
Every planned path was checked against `.claude/skills/merge-gate/risk-paths.txt`.
- `packages/gateway/src/keys/**` (`secret.ts`, `providers.ts`, `source.ts`, `schema.ts`, `load.ts`, `index.ts`): group "access, money, sign-in, keys". **Required reviewer: `security-reviewer`.** The handoff needs a `risk: high` decision entry.
- No match:
  - `packages/gateway/test/**`, `packages/gateway/src/index.ts`, `packages/gateway/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,README.md}`;
  - `docker/env.example`, `pnpm-lock.yaml`, `docs/tasks/2.1/**`.
- No safety prefix is touched, so no `safety-review.md` is needed. No contracts or ADR change.
- Recommended in addition: `typescript-reviewer` (the mapped types), `silent-failure-hunter` (the fail-fast paths and the dropped errors), `code-reviewer`.

## Decisions (to copy into the handoff `## Decisions`)

### 2.1 Provider key module · decided by planner · risk: high
Decided: Provider keys are read once at startup, only by `packages/gateway/src/keys`, from a `KeySource` (the environment now; a secret manager later through the same interface, no vendor chosen). Each value is wrapped in a `Secret` that prints and serialises as `[redacted]` and is read only with `reveal()`, which only adapters call. A missing or malformed key stops startup with one error that names the variables but never shows a value, a length or a fragment. Rotating a key means a restart.
Why: one door and one wrapper make "never logged, never returned" something a test can check, not just a habit.
Alternatives: Read `process.env` in each adapter; plain strings plus a logger redaction list; hot reload of keys.
Reversible: Yes.

### 2.1 Env variable names · decided by planner · risk: medium
Decided: Provider key variables are `EDMATE_<PROVIDER>_<FIELD>`, starting with `EDMATE_OPENAI_COMPATIBLE_API_KEY`, not the SDK defaults such as `OPENAI_API_KEY`.
Why: AI SDK provider packages read their default variable on their own when no key is passed. A different name means a key can't bypass our module.
Alternatives: The SDK default names.
Reversible: Yes, renaming the variables in deploys.

### 2.1 process.env left as is · decided by planner · risk: low
Decided: The loader does not delete key variables from `process.env` after reading them.
Why: the spec doesn't ask for it, and `--live` runs and other tools read the environment. The leak tests cover our own outputs.
Alternatives: Scrub the variables after load.
Reversible: Yes.

(The builder adds the Pino version pin as a `risk: low` entry.)

## Open questions (lead can decide; none blocks the build)
- **Q1. Which is the "main provider"?** The spec says "one main provider + OpenAI-compatible" and names neither, and it is not in Open decisions. **Recommendation:** 2.1 ships the descriptor table with the `openai-compatible` entry only. 2.2 adds the main provider's entry, one entry plus one env.example line, once the human or lead names it. Ask the human before 2.2 starts.
- **Q2. `EDMATE_` prefix rather than SDK default names?** **Recommendation:** yes (reason above).
- **Q3. Pino as a devDependency for the log test?** **Recommendation:** yes. It is in the stack, and testing the real logger is stronger than testing `JSON.stringify` alone.
- **Q4. A self-hosted OpenAI-compatible server with no key?** **Recommendation:** for the MVP the key is required whenever the provider is used. A local server can be given any 16+ character dummy value. Revisit in 2.2 if needed.

## Lead answers (18 Oct 2026)

- Q1: ship only the `openai-compatible` entry now; the main provider is an open human decision (asked 18 Oct 2026, blocker B-3) and is added in 2.2.
- Q2–Q4: accepted as recommended (`EDMATE_`-prefixed variables; Pino pinned as a devDependency for the log test; a key is required even for a self-hosted OpenAI-compatible server).
- Build after task 0.9 merges (M0 must be done); start the branch from that main.
