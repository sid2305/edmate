// Task 8.6 Phase C: the studio packages API (list, create, save a new version), each package with
// its monthly AI-cost estimate. Standalone on the `profile.ts` pattern. The teacher is always the
// session's own principal; the agent id always comes from the repos (the teacher's existing agent
// in `listForTeacher`, or `agents.ensureDraft`), never from the body; the currency is set here.
//
//   GET  /api/studio/packages   { packages, modules, setup, perTurnMicroUsd }
//   POST /api/studio/packages   a package's settings            -> 201 { package }
//   PUT  /api/studio/packages   { packageId, ...settings }        -> 200 { package }
//
// Error codes are the contract's `ErrorCode`s (no contracts change); a top-level `reason`
// (`style_card_required`, `package_limit`, `conflict`, `unavailable`, `internal`) tells the client
// which case it is. Logs carry fixed codes and error names only, never a message, id or body text.
import type { ErrorCode, ModelPolicy, PackageConfig } from '@edmate/contracts';
import { SkillSchema } from '@edmate/contracts';
import {
  OUTLINE_MODULES_MAX,
  PACKAGES_MAX,
  RepositoryError,
  type PackageDraft,
  type Repositories,
  type TeacherPackageRow,
  type TeacherScope,
} from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorBody } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { monthlyEstimate, PACKAGE_LIMITS, type MonthlyEstimate } from './costEstimate';
import { readJson, TOO_LARGE, type ServerLog } from './routes';

/** Where the studio sends a teacher who has no style card yet (lead answer Q7). */
export const STYLE_CARD_LINK = '/teacher/style-card';

/** Everything the packages API needs, built once per process (packagesRuntime.ts) or per test. */
export interface PackagesBackend {
  repos: {
    courses: Pick<Repositories['courses'], 'ensureDefault'>;
    outline: Pick<Repositories['outline'], 'getOutline'>;
    styleCards: Pick<Repositories['styleCards'], 'latest'>;
    agents: Pick<Repositories['agents'], 'ensureDraft'>;
    packages: Pick<Repositories['packages'], 'create' | 'saveVersion' | 'listForTeacher'>;
  };
  /** The newest signed prompt-pack set's version, pinned by a new agent's v1. */
  promptPackVersion: string;
  /** `MODEL_MIX.paid` (B-42; scope decision 2: one policy per agent). */
  modelPolicy: ModelPolicy;
  /** One turn's cost under that mix, from the bundled prices (computed once). */
  perTurnMicroUsd: number;
  log: ServerLog;
}

/** A package as the studio sees it: the editable settings, versions and the estimate. */
export interface PackageView {
  packageId: string;
  version: number;
  liveVersion: number | null;
  draft: PackageDraft;
  estimate: MonthlyEstimate;
}

const MSG = {
  validation: 'Check the package settings and try again.',
  tooLarge: 'The request is too large.',
  notFound: 'That package was not found.',
  styleCard: 'Set up your style card before you make a package.',
  limit: `You can have at most ${PACKAGES_MAX} packages.`,
  conflict: 'This package changed while you were saving. Reload and try again.',
  unavailable: 'Packages are not available right now. Try again soon.',
  failed: 'Something went wrong. Try again.',
} as const;

const noStore = { 'cache-control': 'no-store' };
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
function fail(
  code: ErrorCode,
  message: string,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return Response.json({ error: errorBody(code, message), ...extra }, { status, headers: noStore });
}
const validation = () => fail('validation', MSG.validation, 400);
const notFound = () => fail('not_found', MSG.notFound, 404);
const packageLimit = () => fail('limit_reached', MSG.limit, 409, { reason: 'package_limit' });

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Ids: the same shape as the other studio routes' `Id` (the repository's id format).
const Id = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(122);
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;
/** Every skill except `study_plan` (MVP-out in the PRD; Q5). */
const OfferedSkill = SkillSchema.exclude(['study_plan']);
const L = PACKAGE_LIMITS;

// Strict: `teacherId`, `agentId`, `id`, `version` or a price `currency` in the body is a 400,
// never read. The currency is always USD, set below.
const settingsShape = {
  name: z.string().trim().min(1).max(L.nameMaxLength),
  moduleIds: z.array(Id).min(1).max(OUTLINE_MODULES_MAX).refine(unique),
  skills: z.array(OfferedSkill).min(1).refine(unique),
  helpCeiling: z.literal([1, 2, 3, 4]),
  finalAnswers: z.enum(['never', 'after_attempt', 'allowed']),
  dailyMessageLimit: z.int().min(L.dailyMessagesMin).max(L.dailyMessagesMax),
  liveClassesPerMonth: z.int().min(0).max(L.liveClassesMax),
  pricePerMonth: z.strictObject({
    amountMinor: z
      .int()
      .refine((v) => v === 0 || (v >= L.priceMinMinor && v <= L.priceMaxMinor)),
  }),
  trialDays: z.int().min(0).max(L.trialDaysMax).optional(),
  lockedReply: z.enum(['name_package', 'generic']),
};
type Settings = z.infer<z.ZodObject<typeof settingsShape>>;
/** A trial only on a paid package (Q4). */
const trialFits = (s: Settings) => s.pricePerMonth.amountMinor > 0 || !s.trialDays;
const CreateBody = z.strictObject(settingsShape).refine(trialFits);
const UpdateBody = z.strictObject({ packageId: Id, ...settingsShape }).refine(trialFits);

function toDraft(s: Settings): PackageDraft {
  const { trialDays, pricePerMonth, ...rest } = s;
  const draft: PackageDraft = {
    ...rest,
    pricePerMonth: { amountMinor: pricePerMonth.amountMinor, currency: 'USD' },
  };
  if (pricePerMonth.amountMinor > 0 && trialDays !== undefined) draft.trialDays = trialDays;
  return draft;
}

function draftOf(config: PackageConfig): PackageDraft {
  const draft: Partial<PackageConfig> = { ...config };
  delete draft.id;
  delete draft.version;
  delete draft.teacherId;
  delete draft.agentId;
  return draft as PackageDraft;
}

function view(b: PackagesBackend, row: TeacherPackageRow): PackageView {
  return {
    packageId: row.packageId,
    version: row.config.version,
    liveVersion: row.liveVersion,
    draft: draftOf(row.config),
    estimate: estimateFor(b, row.config),
  };
}

function estimateFor(b: PackagesBackend, d: PackageDraft): MonthlyEstimate {
  return monthlyEstimate(b.perTurnMicroUsd, d.dailyMessageLimit, d.pricePerMonth.amountMinor);
}

async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.infer<S> | Response> {
  const raw = await readJson(req);
  if (raw === TOO_LARGE) return fail('input_too_large', MSG.tooLarge, 413);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : validation();
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;
type Work = (b: PackagesBackend, scope: TeacherScope, req: NextRequest) => Promise<Response>;

const list: Work = async (b, scope) => {
  // Same bootstrap as the outline page (8.3 lead answer Q1): a teacher always has a course and a
  // module to pick, so the form is never empty.
  await b.repos.courses.ensureDefault(scope);
  const outline = await b.repos.outline.getOutline(scope);
  const card = await b.repos.styleCards.latest(scope);
  const rows = await b.repos.packages.listForTeacher(scope);
  return ok({
    packages: rows.map((r) => view(b, r)),
    modules: (outline?.modules ?? []).map((m) => ({ id: m.id, title: m.title })),
    setup: { styleCard: card !== null, styleCardLink: STYLE_CARD_LINK },
    perTurnMicroUsd: b.perTurnMicroUsd,
  });
};

const create: Work = async (b, scope, req) => {
  const body = await parseBody(req, CreateBody);
  if (body instanceof Response) return body;
  const draft = toDraft(body);
  const rows = await b.repos.packages.listForTeacher(scope);
  if (rows.length >= PACKAGES_MAX) return packageLimit();
  const card = await b.repos.styleCards.latest(scope);
  if (card === null) {
    return fail('validation', MSG.styleCard, 409, {
      reason: 'style_card_required',
      link: STYLE_CARD_LINK,
    });
  }
  let agentId = rows[0]?.agentId;
  if (agentId === undefined) {
    const course = await b.repos.courses.ensureDefault(scope);
    ({ agentId } = await b.repos.agents.ensureDraft(scope, {
      courseId: course.id,
      styleCardId: card.id,
      promptPackVersion: b.promptPackVersion,
      modelPolicy: b.modelPolicy,
    }));
  }
  let created: { packageId: string; version: number };
  try {
    created = await b.repos.packages.create(scope, { agentId, draft });
  } catch (error) {
    // The body already passed a stricter schema than the repo's, so `invalid` here is the
    // per-teacher cap refused inside the repo's lock (a concurrent create won the race).
    if (error instanceof RepositoryError && error.kind === 'invalid') return packageLimit();
    throw error;
  }
  const pkg: PackageView = { ...created, liveVersion: null, draft, estimate: estimateFor(b, draft) };
  return ok({ package: pkg }, 201);
};

const update: Work = async (b, scope, req) => {
  const body = await parseBody(req, UpdateBody);
  if (body instanceof Response) return body;
  const { packageId, ...settings } = body;
  const draft = toDraft(settings);
  const row = (await b.repos.packages.listForTeacher(scope)).find((r) => r.packageId === packageId);
  if (row === undefined) return notFound();
  const saved = await b.repos.packages.saveVersion(scope, {
    packageId,
    agentId: row.agentId,
    draft,
  });
  const pkg: PackageView = {
    ...saved,
    liveVersion: row.liveVersion,
    draft,
    estimate: estimateFor(b, draft),
  };
  return ok({ package: pkg });
};

/** A thrown error mapped to a fixed response; only a code (and an error name) is logged. */
function fromError(b: PackagesBackend, error: unknown): Response {
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'scope':
      case 'not_found':
        return notFound();
      case 'invalid':
        return validation();
      case 'integrity':
        return fail('validation', MSG.conflict, 409, { reason: 'conflict' });
      case 'failed':
        b.log.error('studio.packages_failed', { reason: 'failed' });
        return fail('provider_error', MSG.unavailable, 503, { reason: 'unavailable' });
    }
  }
  b.log.error('studio.packages_failed', { reason: 'internal', error: errorName(error) });
  return fail('provider_error', MSG.failed, 500, { reason: 'internal' });
}

/**
 * The three handlers over a lazily built backend (packagesRuntime.ts). A backend that can't be
 * built (no signed prompt-pack set, no database) is 503, logged once per request by reason code.
 */
export function createPackageHandlers(
  backend: () => Promise<PackagesBackend>,
  fallbackLog: ServerLog,
): { list: Handler; create: Handler; update: Handler } {
  const run =
    (work: Work): Handler =>
    async (req, ctx) => {
      let b: PackagesBackend;
      try {
        b = await backend();
      } catch (error) {
        // StudioUnavailableError / TurnUnavailableError carry a safe, fixed `reason` code.
        const coded: unknown = error instanceof Error ? Reflect.get(error, 'reason') : undefined;
        const reason = typeof coded === 'string' ? coded : errorName(error);
        fallbackLog.error('studio.packages_unavailable', { reason });
        return fail('provider_error', MSG.unavailable, 503, { reason: 'unavailable' });
      }
      const scope: TeacherScope = { teacherId: ctx.principal.userId };
      try {
        return await work(b, scope, req);
      } catch (error) {
        return fromError(b, error);
      }
    };
  return { list: run(list), create: run(create), update: run(update) };
}
