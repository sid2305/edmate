/** A copy of `value` without `key`, for fixtures that leave out a field. */
export function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  // Safe: the copy has exactly the own enumerable keys of `value` except `key`, with the same
  // values, which is what Omit<T, K> describes for the plain-object fixtures this is used on.
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as Omit<T, K>;
}
