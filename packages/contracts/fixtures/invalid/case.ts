/** A value the named schema must reject, with the path of the issue it must report. */
export interface InvalidCase {
  /** The type name, for example `TurnInput` (the schema is `TurnInputSchema`). */
  schema: string;
  name: string;
  value: unknown;
  path: readonly (string | number)[];
}
