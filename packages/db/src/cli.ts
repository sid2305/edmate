import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { computeHealthMetrics } from '@edmate/harness';
import { createDb } from './client.js';
import { createIdentityStore, ROLES, type IdentityStore, type Role } from './identity/index.js';
import { migrateDatabase } from './migrate.js';
import { redact, redactTarget } from './redact.js';
import {
  createRepositories,
  GROUPS_MAX_LIMIT,
  RepositoryError,
  type Repositories,
} from './repositories/index.js';
import { SEED_TABLES, seedDemoTeacher, type SeedOptions, type SeedResult } from './seed.js';
import {
  buildDiscoverySeed,
  DISCOVERY_SEED_TABLES,
  type DiscoverySeedTable,
} from './discovery-seed.js';
import {
  agents,
  agentVersions,
  packages,
  packageVersions,
  teacherProfiles,
  users,
} from './schema/index.js';

/** `pnpm --filter @edmate/db db:migrate`. Returns the process exit code. */
export async function runMigrateCli(
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
): Promise<number> {
  const url = env.DATABASE_URL;
  if (!url) {
    log('db:migrate: DATABASE_URL is not set');
    return 1;
  }
  try {
    await migrateDatabase(url);
    log('db:migrate: migrations applied');
    return 0;
  } catch (err) {
    log(
      `db:migrate: migration failed: ${redact(err instanceof Error ? err.message : String(err))}`,
    );
    return 1;
  }
}

/** Opens the identity store for the grant CLI (injected in tests). */
export type OpenIdentity = (url: string) => { identity: IdentityStore; close: () => Promise<void> };

const openIdentity: OpenIdentity = (url) => {
  const { db, close } = createDb({ DATABASE_URL: url });
  return { identity: createIdentityStore(db), close };
};

const USAGE =
  'usage: db:grant-role -- --email <email>|--user-id <id> --role <student|teacher|staff> ' +
  '--by <staff-user-id|operator> [--reason <text>]\n' +
  '  exactly one of --email or --user-id is required.\n' +
  '  --reason is stored in audit_log; put no personal details in it.';

type UserTarget = { kind: 'email'; email: string } | { kind: 'userId'; userId: string };

type GrantArgs = UserTarget & {
  role: Role;
  by: string;
  reason?: string;
};

/**
 * Exactly one of `email`/`userId` must be set; returns the tagged target, or `undefined` if both
 * or neither are set.
 */
function buildUserTarget(
  email: string | undefined,
  userId: string | undefined,
): UserTarget | undefined {
  if ((email === undefined) === (userId === undefined)) return undefined;
  if (email !== undefined && userId === undefined) return { kind: 'email', email };
  if (userId !== undefined && email === undefined) return { kind: 'userId', userId };
  return undefined;
}

/** The parsed arguments, or a one-line reason they are wrong. */
function parseGrantArgs(argv: string[]): GrantArgs | string {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      // pnpm forwards the `--` separator itself.
      args: argv[0] === '--' ? argv.slice(1) : argv,
      options: {
        email: { type: 'string' },
        'user-id': { type: 'string' },
        role: { type: 'string' },
        by: { type: 'string' },
        reason: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return USAGE;
  }
  const { email, role, by, reason } = values;
  const userId = values['user-id'];
  if (typeof role !== 'string' || typeof by !== 'string') {
    return USAGE;
  }
  const target = buildUserTarget(
    typeof email === 'string' ? email : undefined,
    typeof userId === 'string' ? userId : undefined,
  );
  if (target === undefined) {
    return USAGE;
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    return `--role must be one of ${ROLES.join(', ')}`;
  }
  return {
    ...target,
    role: role as Role,
    by,
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}

/**
 * `pnpm --filter @edmate/db db:grant-role -- --email <e>|--user-id <id> --role <r> --by
 * <id|operator>`: the operator's way to set a user's role (the first staff account is
 * bootstrapped with it). Writes a `role.grant` audit row. Never prints the email, a user id's
 * personal context or a connection string's credentials. Returns the exit code.
 */
export async function runGrantRoleCli(
  argv: string[],
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
  open: OpenIdentity = openIdentity,
): Promise<number> {
  const args = parseGrantArgs(argv);
  if (typeof args === 'string') {
    log(`db:grant-role: ${args}`);
    return 1;
  }
  const url = env.DATABASE_URL;
  if (!url) {
    log('db:grant-role: DATABASE_URL is not set');
    return 1;
  }
  log(`db:grant-role: target ${redactTarget(url)}`);
  let handle: ReturnType<OpenIdentity> | undefined;
  try {
    handle = open(url);
    const user =
      args.kind === 'userId'
        ? await handle.identity.getUser(args.userId)
        : await handle.identity.getUserByEmail(args.email);
    if (!user) {
      log(
        args.kind === 'userId'
          ? 'db:grant-role: no user has that id (they must sign in once first)'
          : 'db:grant-role: no user has that email (they must sign in once first)',
      );
      return 1;
    }
    const updated = await handle.identity.grantRole({
      userId: user.id,
      role: args.role,
      by: args.by,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    });
    log(`db:grant-role: user ${updated.id} is now ${updated.role}`);
    return 0;
  } catch (err) {
    log(`db:grant-role: failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Opens the identity store and the profile repository for the verify CLI (injected in tests). */
export type OpenVerify = (url: string) => {
  identity: Pick<IdentityStore, 'getUserByEmail' | 'getUser'>;
  teacherProfiles: Pick<Repositories['teacherProfiles'], 'setVerification'>;
  close: () => Promise<void>;
};

const openVerify: OpenVerify = (url) => {
  const { db, close } = createDb({ DATABASE_URL: url });
  return {
    identity: createIdentityStore(db),
    teacherProfiles: createRepositories(db).teacherProfiles,
    close,
  };
};

const VERIFY_STATUSES = ['verified', 'rejected'] as const;
type VerifyStatus = (typeof VERIFY_STATUSES)[number];

const VERIFY_USAGE =
  'usage: db:verify-teacher -- --email <email>|--user-id <id> --status <verified|rejected> ' +
  '--by <staff-user-id> [--reason <text>]\n' +
  '  exactly one of --email or --user-id is required.\n' +
  '  --reason is stored in audit_log; put no personal details in it.';

type VerifyArgs = UserTarget & {
  status: VerifyStatus;
  by: string;
  reason?: string;
};

/** The parsed arguments, or a one-line reason they are wrong. */
function parseVerifyArgs(argv: string[]): VerifyArgs | string {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : argv,
      options: {
        email: { type: 'string' },
        'user-id': { type: 'string' },
        status: { type: 'string' },
        by: { type: 'string' },
        reason: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return VERIFY_USAGE;
  }
  const { email, status, by, reason } = values;
  const userId = values['user-id'];
  if (typeof status !== 'string' || typeof by !== 'string') {
    return VERIFY_USAGE;
  }
  const target = buildUserTarget(
    typeof email === 'string' ? email : undefined,
    typeof userId === 'string' ? userId : undefined,
  );
  if (target === undefined) {
    return VERIFY_USAGE;
  }
  if (!(VERIFY_STATUSES as readonly string[]).includes(status)) {
    return `--status must be one of ${VERIFY_STATUSES.join(', ')}`;
  }
  return {
    ...target,
    status: status as VerifyStatus,
    by,
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}

/**
 * `pnpm --filter @edmate/db db:verify-teacher -- --email <e>|--user-id <id> --status
 * <verified|rejected> --by <staff-user-id>` (task 8.1): staff's identity-check tool until the
 * trust console (12.1). Only a user who is staff now can verify; the repository checks that and
 * writes a `teacher.verify` audit row. Never prints the email, a user id's personal context or a
 * connection string's credentials. Returns the exit code.
 */
export async function runVerifyTeacherCli(
  argv: string[],
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
  open: OpenVerify = openVerify,
): Promise<number> {
  const args = parseVerifyArgs(argv);
  if (typeof args === 'string') {
    log(`db:verify-teacher: ${args}`);
    return 1;
  }
  const url = env.DATABASE_URL;
  if (!url) {
    log('db:verify-teacher: DATABASE_URL is not set');
    return 1;
  }
  log(`db:verify-teacher: target ${redactTarget(url)}`);
  let handle: ReturnType<OpenVerify> | undefined;
  try {
    handle = open(url);
    const user =
      args.kind === 'userId'
        ? await handle.identity.getUser(args.userId)
        : await handle.identity.getUserByEmail(args.email);
    if (!user) {
      log(
        args.kind === 'userId'
          ? 'db:verify-teacher: no user has that id'
          : 'db:verify-teacher: no user has that email',
      );
      return 1;
    }
    const row = await handle.teacherProfiles.setVerification(
      { teacherId: user.id },
      {
        status: args.status,
        by: args.by,
        ...(args.reason === undefined ? {} : { reason: args.reason }),
      },
    );
    log(`db:verify-teacher: teacher ${row.teacherId} is now ${row.verificationStatus}`);
    return 0;
  } catch (err) {
    log(`db:verify-teacher: failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Runs the demo seed against a database URL (injected in tests). */
export type RunSeed = (url: string, options: SeedOptions) => Promise<SeedResult>;

const runSeed: RunSeed = async (url, options) => {
  const { db, close } = createDb({ DATABASE_URL: url });
  try {
    return await seedDemoTeacher(db, options);
  } finally {
    await close().catch(() => undefined);
  }
};

/**
 * `corepack pnpm seed`: the demo teacher, its packages and 20 fictional students (task 1.5).
 * Idempotent; prints how many rows each table got (0 on a re-run) and warns about seeded rows that
 * no longer match the content. EDMATE_SEED_CONTENT_DIR overrides the content tree. Returns the
 * exit code.
 */
export async function runSeedCli(
  env: { DATABASE_URL?: string | undefined; EDMATE_SEED_CONTENT_DIR?: string | undefined },
  log: (line: string) => void,
  seed: RunSeed = runSeed,
): Promise<number> {
  const url = env.DATABASE_URL;
  if (!url) {
    log('seed: DATABASE_URL is not set');
    return 1;
  }
  try {
    const dir = env.EDMATE_SEED_CONTENT_DIR;
    const { inserted, drift } = await seed(url, dir ? { contentDir: dir } : {});
    const total = SEED_TABLES.reduce((n, t) => n + inserted[t], 0);
    const counts = SEED_TABLES.map((t) => `${t}=${inserted[t]}`).join(' ');
    log(total === 0 ? 'seed: already seeded (inserted 0 rows)' : `seed: inserted ${total} rows`);
    log(`seed: ${counts}`);
    for (const d of drift) {
      log(`seed: warning: existing row differs from content, left as is: ${d}`);
    }
    return 0;
  } catch (err) {
    log(`seed: failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  }
}

/** Opens the teacherQuestions repository for the teacher-questions CLI (injected in tests). */
export type OpenTeacherQuestions = (url: string) => {
  teacherQuestions: Pick<Repositories['teacherQuestions'], 'listGroupsForTeacher' | 'answer'>;
  close: () => Promise<void>;
};

const openTeacherQuestions: OpenTeacherQuestions = (url) => {
  const { db, close } = createDb({ DATABASE_URL: url });
  return { teacherQuestions: createRepositories(db).teacherQuestions, close };
};

const TQ_USAGE =
  'usage: db:questions -- list --teacher <id>\n' +
  '       db:questions -- answer --teacher <id> --question <id> --module <id> ' +
  '--answer-file <path> [--note-question <text>]';

interface TqListArgs {
  cmd: 'list';
  teacherId: string;
}
interface TqAnswerArgs {
  cmd: 'answer';
  teacherId: string;
  questionId: string;
  moduleId: string;
  answerFile: string;
  noteQuestion?: string;
}
type TqArgs = TqListArgs | TqAnswerArgs;

/** The parsed teacher-questions arguments, or a one-line usage string. */
function parseTqArgs(argv0: string[]): TqArgs | string {
  const argv = argv0[0] === '--' ? argv0.slice(1) : argv0;
  const [cmd, ...rest] = argv;
  if (cmd !== 'list' && cmd !== 'answer') return TQ_USAGE;
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        teacher: { type: 'string' },
        question: { type: 'string' },
        module: { type: 'string' },
        'answer-file': { type: 'string' },
        'note-question': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return TQ_USAGE;
  }
  const { teacher, question, module: moduleId, 'answer-file': answerFile } = values;
  const noteQuestion = values['note-question'];
  if (typeof teacher !== 'string') return TQ_USAGE;
  if (cmd === 'list') return { cmd, teacherId: teacher };
  if (
    typeof question !== 'string' ||
    typeof moduleId !== 'string' ||
    typeof answerFile !== 'string'
  ) {
    return TQ_USAGE;
  }
  return {
    cmd,
    teacherId: teacher,
    questionId: question,
    moduleId,
    answerFile,
    ...(typeof noteQuestion === 'string' ? { noteQuestion } : {}),
  };
}

/**
 * `pnpm --filter @edmate/db db:questions -- list --teacher <id>` and
 * `db:questions -- answer --teacher <id> --question <id> --module <id> --answer-file <path>
 * [--note-question <text>]` (task 5.10 Q5): the operator's way to read and answer a teacher's
 * open-question inbox until the authenticated teacher console (8.9). `list` never prints a
 * student id (`listGroupsForTeacher` never selects one); `answer` reads the answer text from a
 * file so a long answer never goes on the command line, and prints counts only. Errors are fixed
 * messages, never driver text. Returns the exit code.
 */
export async function runTeacherQuestionsCli(
  argv: string[],
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
  open: OpenTeacherQuestions = openTeacherQuestions,
): Promise<number> {
  const args = parseTqArgs(argv);
  if (typeof args === 'string') {
    log(`db:questions: ${args}`);
    return 1;
  }
  const url = env.DATABASE_URL;
  if (!url) {
    log('db:questions: DATABASE_URL is not set');
    return 1;
  }
  let handle: ReturnType<OpenTeacherQuestions> | undefined;
  try {
    if (args.cmd === 'answer') {
      let answer: string;
      try {
        answer = await readFile(args.answerFile, 'utf8');
      } catch {
        log('db:questions: could not read --answer-file');
        return 1;
      }
      handle = open(url);
      const result = await handle.teacherQuestions.answer(
        { teacherId: args.teacherId },
        {
          questionId: args.questionId,
          moduleId: args.moduleId,
          answer,
          ...(args.noteQuestion === undefined ? {} : { noteQuestion: args.noteQuestion }),
        },
      );
      log(
        `db:questions: answered ${result.answered} question(s), ${result.students} student(s), ` +
          `${result.threadMessages} message(s) sent`,
      );
      return 0;
    }
    handle = open(url);
    const groups = await handle.teacherQuestions.listGroupsForTeacher(
      { teacherId: args.teacherId },
      { limit: GROUPS_MAX_LIMIT },
    );
    if (groups.length === 0) {
      log('db:questions: no open questions');
      return 0;
    }
    for (const g of groups) {
      log(`db:questions: group ${g.groupId} (${g.count}) oldest ${g.oldestAt}`);
      for (const q of g.questions) log(`db:questions:   ${q.id} ${q.text}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof RepositoryError && err.kind === 'not_found') {
      log('db:questions: not found or already answered');
      return 1;
    }
    log(`db:questions: failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Opens the turnTraces repository for the health-report CLI (injected in tests). */
export type OpenHealthReport = (url: string) => {
  turnTraces: Pick<Repositories['turnTraces'], 'listForTeacherSince'>;
  close: () => Promise<void>;
};

const openHealthReport: OpenHealthReport = (url) => {
  const { db, close } = createDb({ DATABASE_URL: url });
  return { turnTraces: createRepositories(db).turnTraces, close };
};

const HR_USAGE = 'usage: db:health-report -- --teacher <id> --since <iso> [--limit <n>]';

interface HrArgs {
  teacherId: string;
  since: string;
  limit?: number;
}

/** The parsed health-report arguments, or a one-line usage string. */
function parseHrArgs(argv0: string[]): HrArgs | string {
  const argv = argv0[0] === '--' ? argv0.slice(1) : argv0;
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        teacher: { type: 'string' },
        since: { type: 'string' },
        limit: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return HR_USAGE;
  }
  const { teacher, since, limit } = values;
  if (typeof teacher !== 'string' || typeof since !== 'string') return HR_USAGE;
  if (limit === undefined) return { teacherId: teacher, since };
  const n = Number(limit);
  if (!Number.isInteger(n)) return HR_USAGE;
  return { teacherId: teacher, since, limit: n };
}

/**
 * `pnpm --filter @edmate/db db:health-report -- --teacher <id> --since <iso> [--limit <n>]`
 * (task 7.7a): an operator's p50/p95 latency (including the derived `firstToken` step), error
 * rate (by step) and guard rate (by guard) for one teacher over a window, computed by piping
 * `listForTeacherSince`'s rows through `@edmate/harness`'s `computeHealthMetrics`. Prints only
 * the redacted database target, ids and numbers -- never a student's or teacher's personal
 * details (the repository selects none). An invalid `--limit`/`--since` surfaces as the
 * repository's own fail-closed `RepositoryError('invalid', ...)`, caught below like any other
 * repository error. Returns the exit code.
 */
export async function runHealthReportCli(
  argv: string[],
  env: { DATABASE_URL?: string | undefined },
  log: (line: string) => void,
  open: OpenHealthReport = openHealthReport,
): Promise<number> {
  const args = parseHrArgs(argv);
  if (typeof args === 'string') {
    log(`db:health-report: ${args}`);
    return 1;
  }
  const url = env.DATABASE_URL;
  if (!url) {
    log('db:health-report: DATABASE_URL is not set');
    return 1;
  }
  log(`db:health-report: target ${redactTarget(url)}`);
  let handle: ReturnType<OpenHealthReport> | undefined;
  try {
    handle = open(url);
    const rows = await handle.turnTraces.listForTeacherSince(
      { teacherId: args.teacherId },
      args.since,
      args.limit,
    );
    if (rows.length === 0) {
      log('db:health-report: turns=0 (no turns in this window)');
      return 0;
    }
    const metrics = computeHealthMetrics(rows);
    log(`db:health-report: turns=${metrics.turns}`);
    for (const [name, stats] of Object.entries(metrics.stepLatencyMs)) {
      if (!stats) continue;
      log(`db:health-report: ${name} p50=${stats.p50} p95=${stats.p95} n=${stats.n}`);
    }
    log(
      `db:health-report: errorRate=${metrics.errorRate} errorsByStep=${JSON.stringify(
        metrics.errorsByStep,
      )}`,
    );
    log(
      `db:health-report: guardRate=${metrics.guardRate} guardsByName=${JSON.stringify(
        metrics.guardsByName,
      )}`,
    );
    return 0;
  } catch (err) {
    log(`db:health-report: failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * `pnpm --filter @edmate/db db:seed-discovery -- --fake-teachers <n>`: `n` synthetic, verified
 * teachers for exercising `discovery.search` at scale (task 9.2). Dev/test only: refuses with
 * exit code 1 and writes nothing when `NODE_ENV` is `production` or the flag is missing or not a
 * positive whole number -- checked before any database connection is opened. Idempotent: an
 * existing row (by id) is left as is (`onConflictDoNothing`).
 */
export async function runSeedDiscoveryCli(
  argv: string[],
  env: { DATABASE_URL?: string | undefined; NODE_ENV?: string | undefined },
  log: (line: string) => void,
): Promise<number> {
  if (env.NODE_ENV === 'production') {
    log('seed-discovery: refused: NODE_ENV is production (dev/test only)');
    return 1;
  }
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { 'fake-teachers': { type: 'string' } },
      strict: false,
    }));
  } catch {
    values = {};
  }
  const raw = values['fake-teachers'];
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) {
    log('seed-discovery: usage: db:seed-discovery -- --fake-teachers <n>');
    return 1;
  }
  const url = env.DATABASE_URL;
  if (!url) {
    log('seed-discovery: DATABASE_URL is not set');
    return 1;
  }
  const seed = buildDiscoverySeed(n);
  const { db, close } = createDb({ DATABASE_URL: url });
  try {
    const inserted = {} as Record<DiscoverySeedTable, number>;
    await db.transaction(async (tx) => {
      inserted.users = (
        await tx
          .insert(users)
          .values(seed.users)
          .onConflictDoNothing({ target: users.id })
          .returning({ id: users.id })
      ).length;
      inserted.teacherProfiles = (
        await tx
          .insert(teacherProfiles)
          .values(seed.teacherProfiles)
          .onConflictDoNothing({ target: teacherProfiles.id })
          .returning({ id: teacherProfiles.id })
      ).length;
      inserted.agents = (
        await tx
          .insert(agents)
          .values(seed.agents)
          .onConflictDoNothing({ target: agents.id })
          .returning({ id: agents.id })
      ).length;
      inserted.agentVersions = (
        await tx
          .insert(agentVersions)
          .values(seed.agentVersions)
          .onConflictDoNothing({ target: agentVersions.id })
          .returning({ id: agentVersions.id })
      ).length;
      inserted.packages = (
        await tx
          .insert(packages)
          .values(seed.packages)
          .onConflictDoNothing({ target: packages.id })
          .returning({ id: packages.id })
      ).length;
      inserted.packageVersions = (
        await tx
          .insert(packageVersions)
          .values(seed.packageVersions)
          .onConflictDoNothing({ target: packageVersions.id })
          .returning({ id: packageVersions.id })
      ).length;
    });
    const total = DISCOVERY_SEED_TABLES.reduce((sum, t) => sum + inserted[t], 0);
    log(
      total === 0
        ? 'seed-discovery: already seeded (inserted 0 rows)'
        : `seed-discovery: inserted ${total} rows`,
    );
    log(
      "seed-discovery: these teachers have no course or module; they appear in search but can't " +
        'start a chat',
    );
    return 0;
  } catch (err) {
    log(`seed-discovery: failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  } finally {
    await close();
  }
}
