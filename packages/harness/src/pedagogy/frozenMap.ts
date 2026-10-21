// A read-only Map for libraries built once at start-up (prompt packs 3.6, personas 5.8).

/** A Map whose mutators throw once built, so a shared library can't be changed after start-up. */
export class FrozenMap<K, V> extends Map<K, V> {
  private sealed = false;
  private readonly label: string;

  /** `label` names the library in the error text, for example `the persona library`. */
  constructor(entries: readonly (readonly [K, V])[], label: string) {
    super(entries);
    this.label = label;
    this.sealed = true;
    Object.freeze(this);
  }

  override set(key: K, value: V): this {
    if (this.sealed) throw new TypeError(`${this.label} is read-only`);
    return super.set(key, value);
  }

  override delete(): boolean {
    throw new TypeError(`${this.label} is read-only`);
  }

  override clear(): void {
    throw new TypeError(`${this.label} is read-only`);
  }
}
