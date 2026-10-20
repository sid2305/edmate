// Locale packs at runtime (task 3.10; lead decision on the 3.10 review, 19 Oct 2026). A
// composition root calls `loadLocalePacks` once at start-up and `pickLocalePack` per turn.
//   - An unverified helpline (a `pending` or blank number, or a `pending` verifier) is never
//     served: the pack is used *without* it. A pack left with no helplines gets the frame prompt
//     pack's country-neutral no-helplines line ("contact local emergency services ... someone you
//     trust"), and the safety alert is raised as for any market. Every other field, the market's
//     PII patterns above all, is still used, so a pending sign-off is never a privacy regression.
//   - A pack that fails the schema, or whose PII patterns fail the gu or safe-regex check, is
//     refused whole; its market gets the default pack.
//   - Pending compliance text (grievance, reviewedBy) does not block runtime use: it feeds the
//     privacy notice (`content/legal/privacy-notice`, task 1.7). A pending `reviewedBy` does
//     change one thing: the pack cannot waive parental consent (`agePolicyFor`, fails closed).
//     `edmate content validate` still fails on every pending value, so the human sign-off stays
//     visible.
//   - Without a usable default pack, loading throws: there is no safe fallback without it.
import type { LocalePack } from '@edmate/contracts';
import { readLocalePacksDir } from './localeLoader.js';
import { DEFAULT_LOCALE_MARKET, type LocalePacks, piiPatternIssues } from './localeRules.js';

export { DEFAULT_LOCALE_MARKET };

export class LocalePackError extends Error {
  override readonly name = 'LocalePackError';
}

/** Why a helpline is not served, as codes only: never the number or the verifier text. */
export type HelplineDropReason = 'number_blank' | 'number_pending' | 'verifier_pending';

export interface DroppedHelpline {
  market: string;
  /** The helpline's name (public, from the pack). */
  helpline: string;
  reasons: HelplineDropReason[];
}

const isPending = (s: string): boolean => s.trim().toLowerCase() === 'pending';

function dropReasons(h: LocalePack['helplines'][number]): HelplineDropReason[] {
  const reasons: HelplineDropReason[] = [];
  if (h.number.trim() === '') reasons.push('number_blank');
  else if (isPending(h.number)) reasons.push('number_pending');
  if (isPending(h.verifiedBy)) reasons.push('verifier_pending');
  return reasons;
}

/**
 * `pack` with every unverified helpline removed, and one entry per removed helpline. A pack with
 * nothing to remove comes back as the same object.
 */
export function withVerifiedHelplines(pack: LocalePack): {
  pack: LocalePack;
  dropped: DroppedHelpline[];
} {
  const dropped: DroppedHelpline[] = [];
  const kept = pack.helplines.filter((h) => {
    const reasons = dropReasons(h);
    if (reasons.length > 0) dropped.push({ market: pack.market, helpline: h.name, reasons });
    return reasons.length === 0;
  });
  return { pack: dropped.length === 0 ? pack : { ...pack, helplines: kept }, dropped };
}

/**
 * The pack for `market` (else the default pack), with any unverified helpline removed. `packs`
 * should come from `loadLocalePacks`, which has already checked the patterns; the helpline
 * check runs again here as defence in depth.
 */
export function pickLocalePack(market: string, packs: LocalePacks): LocalePack {
  const fallback = packs.get(DEFAULT_LOCALE_MARKET);
  if (fallback === undefined) {
    throw new LocalePackError(
      `no usable locale pack for market "${market}": the default pack (${DEFAULT_LOCALE_MARKET}) is missing`,
    );
  }
  return withVerifiedHelplines(packs.get(market) ?? fallback).pack;
}

export interface LoadedLocalePacks {
  /** The packs that may be served, keyed by market, unverified helplines removed; always holds the default pack. */
  packs: LocalePacks;
  /** Files refused whole (schema or PII-pattern failure, or not a pack); their markets get the default pack. */
  refused: { file: string; reasons: string[] }[];
  /** Each helpline removed at load, once, for the caller to report (codes only). */
  droppedHelplines: DroppedHelpline[];
}

/** Loads every pack in `dir` for runtime use (see the header for what is refused or removed). */
export function loadLocalePacks(dir: string): LoadedLocalePacks {
  const { packs, errors } = readLocalePacksDir(dir);
  const refused: LoadedLocalePacks['refused'] = errors.map((e) => ({
    file: e.filePath,
    reasons: [e.message.slice(e.filePath.length + 2)],
  }));
  const served = new Map<string, LocalePack>();
  const droppedHelplines: DroppedHelpline[] = [];
  for (const [market, pack] of packs) {
    const issues = piiPatternIssues(pack);
    if (issues.length > 0) {
      refused.push({ file: `${market}.yaml`, reasons: issues });
      continue;
    }
    const { pack: usable, dropped } = withVerifiedHelplines(pack);
    served.set(market, usable);
    droppedHelplines.push(...dropped);
  }
  refused.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  if (!served.has(DEFAULT_LOCALE_MARKET)) {
    const own = refused.find((r) => r.file === `${DEFAULT_LOCALE_MARKET}.yaml`);
    throw new LocalePackError(
      own === undefined
        ? `locale packs in ${dir}: ${DEFAULT_LOCALE_MARKET}.yaml: missing; the default pack is required`
        : `the default locale pack (${own.file}) is unusable: ${own.reasons.join('; ')}`,
    );
  }
  return { packs: served, refused, droppedHelplines };
}
