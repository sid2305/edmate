# @edmate/gateway

The model gateway: provider keys (task 2.1), and later adapters, routing, metering and caps (M2).

## Provider keys

Build plan § Model gateway, Keys: Edmate-held provider keys come from the environment or a secret
manager and are never logged, stored in the DB or returned by any API.

- **One door.** Keys enter the process only through `src/keys`. The app calls
  `loadProviderKeys({ source: envKeySource(process.env), required: [...] })` once at startup.
  No file in `src` reads `process.env` itself. A secret manager later implements the same
  `KeySource` interface.
- **Fail fast, quietly.** A missing or malformed key (empty, whitespace, wrapped in quotes, a
  placeholder such as `changeme`, under 16 characters) stops startup with one `KeyConfigError`
  that names every bad variable but never shows a value, a length or a fragment. A provider that
  is not required is skipped if none of its variables is set, and must be valid if any is.
- **`Secret`.** Each key is wrapped in a `Secret` that prints, serialises and inspects as
  `[redacted]`. `reveal()` is the only way to read it, and only provider adapters
  (`src/adapters`, task 2.2) call it, when they build a client. A test enforces this.
- **Restart to rotate.** Keys are read once.

| Variable                           | Provider                                           |
| ---------------------------------- | -------------------------------------------------- |
| `EDMATE_OPENAI_COMPATIBLE_API_KEY` | Any OpenAI-compatible endpoint (covers OpenRouter) |

The main provider's variable is added by task 2.2. Variables use the `EDMATE_` prefix, not SDK
defaults such as `OPENAI_API_KEY`, so a key can reach an SDK only through this module. See
`docker/env.example`. Tests use runtime-generated fake keys and the scripted gateway, never real
keys.
