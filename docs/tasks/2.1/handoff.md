# 2.1 handoff: provider keys from the environment / secret manager

Status: DONE
Branch: `m2/2.1-provider-keys`
Worktree: `.claude/worktrees/agent-a5c9e6f44d2583f3c`
Risky: yes, `packages/gateway/src/keys/**` (group "access, money, sign-in, keys"). Required reviewer:
`security-reviewer`. Recommended: `typescript-reviewer`, `silent-failure-hunter`, `code-reviewer`.

## Acceptance evidence

Acceptance: "a log-scan test proves no key appears in logs, traces or API responses."

`corepack pnpm turbo run build typecheck lint test --filter=@edmate/gateway...`
```
@edmate/gateway:test:  ✓ test/keys/single-door.test.ts (4 tests)
@edmate/gateway:test:  ✓ test/keys/secret.test.ts (9 tests)
@edmate/gateway:test:  ✓ test/keys/source.test.ts (4 tests)
@edmate/gateway:test:  ✓ test/keys/exports.test.ts (1 test)
@edmate/gateway:test:  ✓ test/keys/load.test.ts (38 tests)
@edmate/gateway:test:  ✓ test/keys/log-scan.test.ts (9 tests)
@edmate/gateway:test:       Tests  65 passed (65)
 Tasks:    7 successful, 7 total
```

Log-scan test, every case (`vitest run test/keys/log-scan.test.ts --reporter=verbose`):
```
✓ pino: no fragment of the key in the output
✓ console: no fragment of the key in the output
✓ trace: no fragment of the key in the output
✓ response: no fragment of the key in the output
✓ pino: positive control, a revealed key is caught
✓ console: positive control, a revealed key is caught
✓ trace: positive control, a revealed key is caught
✓ response: positive control, a revealed key is caught
✓ the whole corpus is clean, and the same scan flags a deliberate leak in it
```
What goes through each sink: the loaded `ProviderKeys`, the `Secret`, `keys.get('openai-compatible')`, an object
holding all of them, an `Error` built with the secret in a template literal and as `cause`, a `KeyConfigError`
from a source whose own error held the key, and a `KeyConfigError` from a quoted key. Logs: a real Pino 10.4.0
logger into an in-memory `Writable` (object, `%s %o %j`, `err` serializer, nested) and a real `node:console`
`Console` (log, info `%s %o %O %j`, warn, error, debug, dir with `showHidden`). Traces: a recorder that
`JSON.stringify`s a span holding the payload. API responses: `Response.json`, `new Response(JSON.stringify(...))`
and an error body per value. Each sink output must also contain `[redacted]`, so the secret really went through it.
**The scan is not vacuous:** for each sink, the same payload shape with `secret.reveal()` is found by the same
`leaks()` function (any 8-character fragment of the key).

Fail fast without echoing (`load.test.ts`): one case per problem code (`missing`, `empty`, `whitespace`, `quoted`,
`placeholder`, `too_short`, 19 cases), several problems in one error, optional provider unset/blank skipped, optional
set but malformed throws, `get` on an unloaded provider throws naming it, a rejecting and a synchronously throwing
source give "could not read provider keys from <name>" with no `cause`. For every error case with a value of 8+
characters: `message`, `stack`, `JSON.stringify`, `util.inspect` (plain and `showHidden`) and `String` contain no
8-character fragment of the value.

Coverage (`vitest run --coverage`, thresholds: 80% global, 100% for `src/keys/**`):
```
File           | % Stmts | % Branch | % Funcs | % Lines |
All files      |     100 |      100 |     100 |     100 |
 src/keys      |     100 |      100 |     100 |     100 |
  load.ts      |     100 |      100 |     100 |     100 |
  providers.ts |     100 |      100 |     100 |     100 |
  schema.ts    |     100 |      100 |     100 |     100 |
  secret.ts    |     100 |      100 |     100 |     100 |
  source.ts    |     100 |      100 |     100 |     100 |
```
(The two `index.ts` barrels hold only re-exports and show as 0/0.)

Root gates:
- `corepack pnpm install --frozen-lockfile` → "Lockfile is up to date"; `corepack pnpm turbo run build typecheck lint test` → `Tasks: 39 successful, 39 total`.
- `python3 -m unittest discover -s .claude/tests` → `Ran 122 tests ... OK`.
- `python3 .githooks/secret-scan.py --all` → exit 0, no output.
- `corepack pnpm format:check`: every file on this branch is clean; it still flags `.github/workflows/ci.yml`, which is
  unformatted on main already and out of bounds here.

## Pins

- `zod` `4.6.7` (dependency, same as contracts).
- `vitest` `5.0.5`, `@vitest/coverage-v8` `5.0.5`, `@types/node` `22.20.5` (devDependencies, same as contracts).
- `pino` `10.4.0` (devDependency, for the log-scan test only). Current stable from `corepack pnpm view pino version`
  on 18 Oct 2026.

## Changes

- `packages/gateway/src/keys/secret.ts`: `Secret`. Value in a module-private `WeakMap`; instance, prototype and class
  frozen; `toString`/`toJSON`/`valueOf`/`Symbol.toPrimitive` give `[redacted]`, inspect gives `Secret([redacted])`
  (via `Symbol.for`, so no Node types in src). `reveal()` on a non-Secret receiver throws `TypeError`.
- `providers.ts`: `PROVIDER_KEYS` (only `openai-compatible.apiKey` → `EDMATE_OPENAI_COMPATIBLE_API_KEY`),
  `ProviderId`, `KeysFor<P>`.
- `source.ts`: `KeySource` interface and `envKeySource(env)` (own properties only, frozen result).
- `schema.ts` (internal): `keyValueSchema` and `keyProblem()` giving the first problem code in the planned order.
- `load.ts`: `loadProviderKeys`, `KeyConfigError` (frozen `problems`), `ProviderKeys` (frozen, null prototype,
  `has`/`get`/`providers`/`toJSON`, plus `toString` → `ProviderKeys(<ids>)`).
- `keys/index.ts`, `src/index.ts`: barrels; `keyValueSchema` stays internal (tested in `exports.test.ts`).
- Tests: `test/helpers/fake-key.ts` (`fakeKey()`, `leaks()`), `test/keys/{secret,source,load,log-scan,single-door,exports}.test.ts`.
  No committed key-shaped literal; long invalid values are built at runtime; leak assertions use booleans.
- `package.json` (scripts, deps, description), `tsconfig.json` (typecheck src+test), new `tsconfig.build.json`
  (`dist/index.js` unchanged), `vitest.config.ts` (per-glob 100% threshold), `README.md`, `pnpm-lock.yaml`.
- `docker/env.example`: header notes provider keys have no default; new "Model provider keys (task 2.1)" section with
  `EDMATE_OPENAI_COMPATIBLE_API_KEY=` empty and the planned comments.

## Deviations

- **Extra problem code `unknown_provider`.** `required` is typed, but plain JS can pass an unknown id. Rather than
  ignore it silently, it is reported in the same `KeyConfigError` (`variable` holds the provider id, never a value).
- **Blank optional values count as unset.** An optional provider whose variable is `''` or whitespace-only is skipped
  rather than failing. Reason: someone who copies `docker/env.example` gets `EDMATE_OPENAI_COMPATIBLE_API_KEY=` (empty),
  and startup must not fail when that provider is not required. For a required provider, blank is still `empty`.
- **Console sink uses `new Console(stream)` and not spies on `process.stdout.write`.** Vitest intercepts the global
  `console` in workers, so spying on stdout would capture nothing and the test would pass vacuously. A real
  `node:console` `Console` uses the same formatting. The per-sink positive control shows it captures output.
- **`ProviderKeys.toString()` added** (returns `ProviderKeys(<ids>)`). With a null prototype, `${keys}` would
  otherwise throw a `TypeError` in a log line.
- `placeholder` matches `changeme`/`change-me`/`change_me`, `replace-me` (same variants), `todo`, `your-…`/`your_…`,
  `<…>`, and `xxx…` as only x's or `xxx-…`/`xxx_…`, case-insensitive. `quoted` means the same quote character
  (`"`, `'` or backtick) at both ends; quotes inside a key are accepted.

## Decisions

### 18 Oct 2026 · 2.1 Provider key module · decided by planner · risk: high
Decided: Provider keys are read once at startup, only by `packages/gateway/src/keys`, from a `KeySource` (the environment now; a secret manager later through the same interface, no vendor chosen). Each value is wrapped in a `Secret` that prints and serialises as `[redacted]` and is read only with `reveal()`, which only adapters call. A missing or malformed key stops startup with one error that names the variables but never shows a value, a length or a fragment. Rotating a key means a restart.
Why: one door and one wrapper make "never logged, never returned" something a test can check, not just a habit.
Alternatives: Read `process.env` in each adapter; plain strings plus a logger redaction list; hot reload of keys.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Env variable names · decided by planner · risk: medium
Decided: Provider key variables are `EDMATE_<PROVIDER>_<FIELD>`, starting with `EDMATE_OPENAI_COMPATIBLE_API_KEY`, not the SDK defaults such as `OPENAI_API_KEY`.
Why: AI SDK provider packages read their default variable on their own when no key is passed. A different name means a key can't bypass our module.
Alternatives: The SDK default names.
Reversible: Yes, renaming the variables in deploys.

### 18 Oct 2026 · 2.1 process.env left as is · decided by planner · risk: low
Decided: The loader does not delete key variables from `process.env` after reading them.
Why: the spec doesn't ask for it, and `--live` runs and other tools read the environment. The leak tests cover our own outputs.
Alternatives: Scrub the variables after load.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Pino pinned as a devDependency · decided by tdd-guide · risk: low
Decided: `pino` `10.4.0` (current stable on 18 Oct 2026) is pinned exactly as a gateway devDependency, used only by the log-scan test.
Why: Pino is the stack's logger; testing the real logger is stronger than testing `JSON.stringify` alone (lead answer Q3).
Alternatives: Test only `JSON.stringify`; make Pino a runtime dependency now.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Blank optional key means unset · decided by tdd-guide · risk: medium
Decided: For a provider that is not required, a variable that is empty or whitespace-only counts as unset, so the provider is skipped. For a required provider it is still the `empty` problem.
Why: copying `docker/env.example` gives `EDMATE_OPENAI_COMPATIBLE_API_KEY=` (empty); startup must not fail for a provider nobody asked for.
Alternatives: Treat any set variable, even empty, as "configured" and fail.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Unknown provider id is a reported problem · decided by tdd-guide · risk: low
Decided: An id in `required` that is not in `PROVIDER_KEYS` adds an `unknown_provider` problem to the same `KeyConfigError` instead of being ignored.
Why: the type stops it in TypeScript, but plain JS or a config string could pass one; failing loudly beats a silent skip.
Alternatives: Ignore it; throw a separate error type.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Log scan uses a real node Console, not stdout spies · decided by tdd-guide · risk: low
Decided: The console part of the log-scan test writes through `new Console({ stdout, stderr })` into memory instead of spying on `process.stdout.write`.
Why: Vitest intercepts the global console in workers, so stdout spies would see nothing and the check would pass vacuously. The per-sink positive control proves this sink captures output.
Alternatives: Spy on `process.stdout.write` (vacuous under Vitest); set Vitest's `disableConsoleIntercept`.
Reversible: Yes.
