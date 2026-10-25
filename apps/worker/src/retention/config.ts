// Retention config (task 13.4, Phase B). A plain, non-legal TS config: how many days each table
// keeps rows, and whether the scheduled job may actually delete anything. `DRY_RUN` defaults to
// `true` -- the same fail-closed pattern 3.10 used for unverified helplines -- so nothing is
// purged in production until a human (after counsel signs off) flips it per table. None of the
// numbers below are legal advice; see 13.4's open question 1.
export interface RetentionDays {
  sessions: number;
  turnTraces: number;
  transcriptChunks: number;
}

/** Placeholder day counts pending counsel sign-off (13.4 open question 1). Not legal advice. */
export const RETENTION_DAYS: RetentionDays = {
  sessions: 730, // placeholder pending counsel sign-off (13.4 open question 1)
  turnTraces: 90, // placeholder pending counsel sign-off (13.4 open question 1)
  transcriptChunks: 730, // placeholder pending counsel sign-off (13.4 open question 1)
};

export interface RetentionConfig {
  days: RetentionDays;
  /** `true`: report counts only, delete nothing. Defaults to `true` everywhere (fail closed). */
  dryRun: boolean;
}

/** The job's default config: placeholder day counts, dry run. A human flips `dryRun` per table. */
export const defaultRetentionConfig: RetentionConfig = {
  days: RETENTION_DAYS,
  dryRun: true,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The cutoff date for a table kept `days` days: everything older than this may be purged. */
export function cutoffFor(now: Date, days: number): Date {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`retention days must be a positive integer, got ${days}`);
  }
  return new Date(now.getTime() - days * DAY_MS);
}
