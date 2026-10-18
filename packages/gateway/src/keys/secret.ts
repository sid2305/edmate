// A provider key (or any secret) that cannot be printed, logged or serialised by accident.
// The value lives in a module-private WeakMap, not on the instance, so reflection, spreading,
// structuredClone and util.inspect({ showHidden, customInspect: false }) find nothing.
// reveal() is the only way out; only provider adapters call it, when they build a client.

const REDACTED = '[redacted]';
// Symbol.for, not an import of node:util, so src needs no Node types.
const inspectCustom: unique symbol = Symbol.for('nodejs.util.inspect.custom');

const values = new WeakMap<Secret, string>();

export class Secret {
  private constructor(value: string) {
    values.set(this, value);
    Object.freeze(this);
  }

  /** Wraps a value. Nothing about it (prefix, suffix, length, hash) is ever shown. */
  static of(value: string): Secret {
    return new Secret(value);
  }

  /** The raw value. Call it only where a provider client is built (src/adapters). */
  reveal(): string {
    const value = values.get(this);
    if (value === undefined)
      throw new TypeError('reveal() called on something that is not a Secret');
    return value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  valueOf(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](_hint?: string): string {
    return REDACTED;
  }

  [inspectCustom](): string {
    return `Secret(${REDACTED})`;
  }
}

// Nobody can swap a method (say toString) for one that reveals the value.
Object.freeze(Secret.prototype);
Object.freeze(Secret);
