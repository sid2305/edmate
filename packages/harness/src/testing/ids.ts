import type { IdKind, IdSource } from '../pipeline/clock.js';

export interface SequentialIds extends IdSource {
  /** Every id handed out, in order. */
  readonly issued: readonly string[];
}

/** Deterministic ids: `turn_1`, `message_1`, `alert_1`, ... (optionally `<prefix>_turn_1`). */
export function sequentialIds(prefix?: string): SequentialIds {
  const counts = new Map<IdKind, number>();
  const issued: string[] = [];
  return {
    issued,
    next(kind) {
      const n = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, n);
      const id = prefix === undefined ? `${kind}_${n}` : `${prefix}_${kind}_${n}`;
      issued.push(id);
      return id;
    },
  };
}
