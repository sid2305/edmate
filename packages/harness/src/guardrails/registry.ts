// One registry per guard phase (task 4.1). It fails closed at wiring time: an undeclared,
// duplicated, wrong-phase or malformed guard throws on `register`, never joins a chain.
import type { Guard } from './guard.js';
import { declaredIndex, GUARD_ORDER, type GuardPhase, isGuardPhase } from './order.js';

export class GuardRegistryError extends Error {
  override readonly name = 'GuardRegistryError';
}

const isGuardLike = (g: unknown): g is Guard<unknown> =>
  typeof g === 'object' &&
  g !== null &&
  typeof (g as { name?: unknown }).name === 'string' &&
  typeof (g as { run?: unknown }).run === 'function';

export class GuardRegistry<Ctx> {
  readonly #byName = new Map<string, Guard<Ctx>>();

  constructor(readonly phase: GuardPhase) {
    if (!isGuardPhase(phase)) {
      throw new GuardRegistryError(`unknown guard phase "${String(phase)}"`);
    }
  }

  register(guard: Guard<Ctx>): void {
    if (!isGuardLike(guard)) {
      throw new GuardRegistryError('a guard needs a string name and a run function');
    }
    if (guard.phase !== this.phase) {
      throw new GuardRegistryError(
        `guard "${guard.name}" has phase "${String(guard.phase)}", not "${this.phase}"`,
      );
    }
    if (declaredIndex(this.phase, guard.name) < 0) {
      throw new GuardRegistryError(
        `guard "${guard.name}" is not declared for phase "${this.phase}" (see GUARD_ORDER)`,
      );
    }
    if (this.#byName.has(guard.name)) {
      throw new GuardRegistryError(`guard "${guard.name}" is already registered`);
    }
    this.#byName.set(guard.name, guard);
  }

  has(name: string): boolean {
    return this.#byName.has(name);
  }

  /**
   * Registered guards in GUARD_ORDER order. Declared guards with no implementation yet are
   * skipped, so the registry works while 4.2-4.9 land one at a time; `missing()` lists them
   * (4.9 adds the completeness test, lead answer Q3).
   */
  ordered(): readonly Guard<Ctx>[] {
    return Object.freeze(
      GUARD_ORDER[this.phase].flatMap((n) => {
        const g = this.#byName.get(n);
        return g === undefined ? [] : [g];
      }),
    );
  }

  /** Declared names with no registered guard, in declared order. */
  missing(): readonly string[] {
    return GUARD_ORDER[this.phase].filter((n) => !this.#byName.has(n));
  }
}
