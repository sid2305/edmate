// Shared semver precedence helper (task 5.8e; moved verbatim from `personaTemplates.ts`'s
// `comparePersonaVersions`/`compareIdentifier`, 5.8a review follow-up #3): both `promptPacks.ts`
// (set ranking) and `personaTemplates.ts` (persona-version ranking) compare already-validated
// semver strings the same way, so one pure function lives here instead of two copies.

/** Compares one prerelease identifier per semver 2.0.0 §11: numeric < alphanumeric. */
function compareIdentifier(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an !== bn) return an ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semver precedence of two already-valid version strings: numeric major.minor.patch, a release
 * above its prereleases, and build metadata ignored.
 */
export function compareSemver(a: string, b: string): number {
  const split = (v: string) => {
    const core = v.split('+')[0] as string;
    const dash = core.indexOf('-');
    const main = (dash < 0 ? core : core.slice(0, dash)).split('.').map(Number);
    const pre = dash < 0 ? [] : core.slice(dash + 1).split('.');
    return { main, pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (x.main[i] as number) - (y.main[i] as number);
    if (d !== 0) return d;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i += 1) {
    const d = compareIdentifier(x.pre[i] as string, y.pre[i] as string);
    if (d !== 0) return d;
  }
  return x.pre.length - y.pre.length;
}
