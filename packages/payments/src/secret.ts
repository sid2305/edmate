// A provider key (or any secret) that cannot be printed, logged or serialised by accident.
// The value lives in a module-private WeakMap, not on the instance, so reflection, spreading,
// structuredClone and util.inspect({ showHidden, customInspect: false }) find nothing.
// reveal() is the only way out; only the webhook signature check and adapters call it.
// A local copy of @edmate/gateway's Secret, so payments does not depend on the model gateway.
// Unlike that copy it refuses an empty or blank value: an HMAC under an empty key is something
// anyone can compute, so an unset webhook-secret setting must fail at startup, not accept forgeries.
import { PaymentsError } from './errors.js';

const REDACTED = '[redacted]';
// Symbol.for, not an import of node:util, so src needs no Node types.
const inspectCustom: unique symbol = Symbol.for('nodejs.util.inspect.custom');

const values = new WeakMap<Secret, string>();

/** True for a value no secret may have: not a string, empty, or only whitespace. */
export function isBlankSecretValue(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

export class Secret {
  private constructor(value: string) {
    values.set(this, value);
    Object.freeze(this);
  }

  /**
   * Wraps a value. Nothing about it (prefix, suffix, length, hash) is ever shown. An empty or
   * whitespace-only value is a configuration bug: `validation`.
   */
  static of(value: string): Secret {
    if (isBlankSecretValue(value)) throw new PaymentsError('validation');
    return new Secret(value);
  }

  /** The raw value. Call it only to sign or verify, or where a provider client is built. */
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
