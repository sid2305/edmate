// jest-axe's own types augment Jest's `expect`, not Vitest's; this augments Vitest's instead so
// `expect(results).toHaveNoViolations()` (AppShell.test.tsx and friends) typechecks.
import type { AxeResults } from 'jest-axe';

declare module 'vitest' {
  // `T` must stay to match vitest's own `Matchers<R, T>` arity for declaration merging, even
  // though this augmentation doesn't use it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void, T = unknown> {
    toHaveNoViolations(): R;
  }
}

export type { AxeResults };
