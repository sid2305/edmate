// Server-side entitlement checks (build plan § Access filter 1 and 7; ADR-0003 point 1; ADR-0004
// Decision 3-5). Pure: each returns a reason code, never text taken from the objects, so a reason
// can be logged without leaking ids or content. Any reason other than `ok` fails closed.
import {
  AgentConfigSchema,
  type Entitlement,
  EntitlementSchema,
  LocalePackSchema,
  PackageConfigSchema,
  StyleCardSchema,
  type AgentConfig,
  type LocalePack,
  type PackageConfig,
  type StyleCard,
} from '@edmate/contracts';

export type EntitlementReason = 'invalid' | 'source' | 'student' | 'agent' | 'paused' | 'ended';

export type Checked<T, R extends string> = { ok: true; value: T } | { ok: false; reason: R };

/** Who asked for the turn, from server state: never from the client's package or module ids. */
export interface EntitlementRequest {
  studentId: string;
  agentId: string;
  source: Entitlement['source'];
}

/**
 * The resolved entitlement must parse, be for exactly this request, and not be paused or ended
 * ("entitle refuses none, paused or ended").
 */
export function checkEntitlement(
  raw: unknown,
  req: EntitlementRequest,
): Checked<Entitlement, EntitlementReason> {
  const parsed = EntitlementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const e = parsed.data;
  if (e.source !== req.source) return { ok: false, reason: 'source' };
  if (e.studentId !== req.studentId) return { ok: false, reason: 'student' };
  if (e.agentId !== req.agentId) return { ok: false, reason: 'agent' };
  if (e.status === 'paused') return { ok: false, reason: 'paused' };
  if (e.status === 'ended') return { ok: false, reason: 'ended' };
  return { ok: true, value: e };
}

export type TurnConfigReason =
  | 'invalid'
  | 'agent_id'
  | 'agent_teacher'
  | 'pkg_id'
  | 'pkg_teacher'
  | 'pkg_agent'
  | 'pkg_version'
  | 'style_card_id'
  | 'style_card_teacher'
  | 'locale_market'
  | 'modules'
  | 'skills';

export interface TurnConfig {
  agent: AgentConfig;
  pkg: PackageConfig;
  styleCard: StyleCard;
  locale: LocalePack;
}

const subset = <T>(xs: readonly T[], of: readonly T[]): boolean => {
  const set = new Set(of);
  return xs.every((x) => set.has(x));
};

/**
 * ADR-0004 Decision 5: every loaded object belongs to the entitlement. Plus defence in depth
 * (3.2 decision): the entitlement's allowed modules and skills are within the package's.
 */
export function checkTurnConfig(
  e: Entitlement,
  raw: unknown,
): Checked<TurnConfig, TurnConfigReason> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'invalid' };
  const r = raw as Record<string, unknown>;
  const agentR = AgentConfigSchema.safeParse(r.agent);
  const pkgR = PackageConfigSchema.safeParse(r.pkg);
  const styleR = StyleCardSchema.safeParse(r.styleCard);
  const localeR = LocalePackSchema.safeParse(r.locale);
  if (!agentR.success || !pkgR.success || !styleR.success || !localeR.success) {
    return { ok: false, reason: 'invalid' };
  }
  const agent = agentR.data;
  const pkg = pkgR.data;
  const styleCard = styleR.data;
  const locale = localeR.data;

  if (agent.id !== e.agentId) return { ok: false, reason: 'agent_id' };
  if (agent.teacherId !== e.teacherId) return { ok: false, reason: 'agent_teacher' };
  if (pkg.id !== e.packageId) return { ok: false, reason: 'pkg_id' };
  if (pkg.teacherId !== e.teacherId) return { ok: false, reason: 'pkg_teacher' };
  if (pkg.agentId !== e.agentId) return { ok: false, reason: 'pkg_agent' };
  if (pkg.version !== e.packageVersion) return { ok: false, reason: 'pkg_version' };
  if (styleCard.id !== agent.styleCardId) return { ok: false, reason: 'style_card_id' };
  if (styleCard.teacherId !== e.teacherId) return { ok: false, reason: 'style_card_teacher' };
  if (locale.market !== e.market) return { ok: false, reason: 'locale_market' };
  if (!subset(e.allowedModuleIds, pkg.moduleIds)) return { ok: false, reason: 'modules' };
  if (!subset(e.skills, pkg.skills)) return { ok: false, reason: 'skills' };
  return { ok: true, value: { agent, pkg, styleCard, locale } };
}
