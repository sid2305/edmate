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

/** The largest slice weight a guard may have (task 4.7). */
export const MAX_GUARD_WEIGHT = 100;

export interface RegisterOptions {
  /**
   * The guard's share of its phase's time budget, against the other guards' (task 4.7, lead
   * answer 1): a guard that makes a model or port call weighs more than a rules-only one. An
   * integer from 1 to MAX_GUARD_WEIGHT; default 1.
   */
  weight?: number;
}

export class GuardRegistry<Ctx> {
  readonly #byName = new Map<string, Guard<Ctx>>();
  readonly #weights = new Map<string, number>();

  constructor(readonly phase: GuardPhase) {
    if (!isGuardPhase(phase)) {
      throw new GuardRegistryError(`unknown guard phase "${String(phase)}"`);
    }
  }

  register(guard: Guard<Ctx>, opts: RegisterOptions = {}): void {
    if (!isGuardLike(guard)) {
      throw new GuardRegistryError('a guard needs a string name and a run function');
    }
    const weight = opts.weight ?? 1;
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_GUARD_WEIGHT) {
      throw new GuardRegistryError(
        `guard "${guard.name}" weight must be an integer from 1 to ${String(MAX_GUARD_WEIGHT)}`,
      );
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
    this.#weights.set(guard.name, weight);
  }

  has(name: string): boolean {
    return this.#byName.has(name);
  }

  /** The guard's slice weight; 1 for a name this registry does not hold. */
  weight(name: string): number {
    return this.#weights.get(name) ?? 1;
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
