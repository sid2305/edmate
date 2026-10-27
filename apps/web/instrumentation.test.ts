// Task 0.20j: thin dispatch tests only -- `register()` now just `require`s
// `./instrumentation.node` behind the Edge/Node runtime branch (see instrumentation.ts for why:
// Next's documented shape for keeping Node-only code out of the Edge bundle needs a literal,
// static `require(...)` call, not a dynamic `import()`).
//
// `vi.mock` cannot intercept that literal `require(...)` call: Vitest's module graph (and
// therefore `vi.mock`) only governs `import`/dynamic `import()`, and the `require` identifier
// `register()` sees is a real `module.createRequire`-backed function working against Node's own
// CJS resolver, not Vitest's -- confirmed empirically (a `vi.mock('./instrumentation.node', ...)`
// here throws `Cannot find module` before the mock is ever consulted, and even a real,
// npm-resolvable target like `@edmate/harness` loaded this way ignores an active `vi.mock`).
// These tests instead patch `Module.prototype.require` directly for the one call this file makes
// (the same technique `mock-require`/`proxyquire` use), which does reach it, since
// `createRequire`'s returned function still resolves through that same prototype method.
import Module from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

type PatchedRequire = (this: unknown, id: string) => unknown;

const originalRequire = Module.prototype.require;

function patchInstrumentationNodeRequire(stub: PatchedRequire): void {
  // Matching Node's own untyped `Module.prototype.require` signature for this test-only
  // monkeypatch.
  (Module.prototype as unknown as { require: unknown }).require = function (
    this: unknown,
    id: string,
    ...rest: unknown[]
  ) {
    if (id === './instrumentation.node') {
      return stub.call(this, id);
    }
    return (originalRequire as unknown as (...args: unknown[]) => unknown).call(this, id, ...rest);
  };
}

afterEach(() => {
  Module.prototype.require = originalRequire;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('register (web container start, task 9.0c / 0.20j)', () => {
  it('dispatches to instrumentation.node on the Node.js runtime', async () => {
    const runNodeStartup = vi.fn();
    patchInstrumentationNodeRequire(() => ({ runNodeStartup }));
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { register } = await import('./instrumentation');
    // `undefined`, not a Promise: pins `register()` as non-async, so Next never awaits the warm-up.
    expect(register()).toBeUndefined();
    expect(runNodeStartup).toHaveBeenCalledTimes(1);
  });

  it('dispatches to instrumentation.node when NEXT_RUNTIME is unset (treated as Node.js)', async () => {
    const runNodeStartup = vi.fn();
    patchInstrumentationNodeRequire(() => ({ runNodeStartup }));
    vi.stubEnv('NEXT_RUNTIME', undefined);
    const { register } = await import('./instrumentation');
    register();
    expect(runNodeStartup).toHaveBeenCalledTimes(1);
  });

  it('does nothing observable on the Edge runtime (Edge must never pull in Node-only code)', async () => {
    const requireSpy = vi.fn();
    patchInstrumentationNodeRequire(requireSpy);
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    const { register } = await import('./instrumentation');
    expect(register()).toBeUndefined();
    expect(requireSpy).not.toHaveBeenCalled();
  });
});
