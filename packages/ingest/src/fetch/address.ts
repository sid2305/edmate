// Which IP addresses a web link may reach. Only public unicast space passes: loopback, private,
// carrier-grade NAT, link-local (including the 169.254.169.254 cloud metadata service), unique-local,
// documentation, benchmarking, multicast, reserved, NAT64, 6to4 and Teredo ranges are all refused,
// as is IPv4 hidden inside IPv6 (::ffff:a.b.c.d) when the IPv4 part is not public.
import { Resolver } from 'node:dns/promises';

/** Dotted-decimal IPv4 as four bytes; anything else is undefined. */
function parseV4(s: string): number[] | undefined {
  const parts = s.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return bytes.every((b) => b <= 255) ? bytes : undefined;
}

/** IPv6 as eight 16-bit groups (an embedded dotted IPv4 tail is folded in); else undefined. */
function parseV6(s: string): number[] | undefined {
  if (!s.includes(':')) return undefined;
  let text = s;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseV4(tail);
    if (v4 === undefined) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const groupsOf = (h: string | undefined): string[] =>
    h === undefined || h === '' ? [] : h.split(':');
  const head = groupsOf(halves[0]);
  const rest = groupsOf(halves[1]);
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return undefined;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return undefined;
  return groups.map((g) => parseInt(g, 16));
}

function isPublicV4([a = 0, b = 0, c = 0]: readonly number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicV6(g: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, , , g5 = 0, g6 = 0, g7 = 0] = g;
  const leadingZero = g.slice(0, 5).every((x) => x === 0);
  // ::ffff:a.b.c.d is IPv4 in disguise: judge the IPv4 address.
  if (leadingZero && g5 === 0xffff) return isPublicV4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  // Only global unicast (2000::/3), minus the special-purpose blocks inside it: Teredo
  // (2001::/32), benchmarking (2001:2::/48), ORCHID (2001:10::/28, 2001:20::/28), documentation
  // (2001:db8::/32 and 3fff::/20, RFC 9637) and 6to4 (2002::/16).
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x3fff && (g1 & 0xf000) === 0) return false;
  if (g0 === 0x2001) {
    if (g1 === 0 || g1 === 0xdb8 || (g1 === 2 && g2 === 0)) return false;
    if ((g1 & 0xfff0) === 0x10 || (g1 & 0xfff0) === 0x20) return false;
  }
  return g0 !== 0x2002;
}

function bare(ip: string): string {
  const unbracketed = ip.replace(/^\[(.*)\]$/, '$1');
  const zone = unbracketed.indexOf('%');
  return zone === -1 ? unbracketed : unbracketed.slice(0, zone);
}

/** True when the host is an IP address literal rather than a name (brackets allowed). */
export function isIpLiteral(host: string): boolean {
  const ip = bare(host);
  return parseV4(ip) !== undefined || parseV6(ip) !== undefined;
}

/** True only for a public unicast address; a name or malformed text is never public. */
export function isPublicAddress(ip: string): boolean {
  const addr = bare(ip);
  const v4 = parseV4(addr);
  if (v4 !== undefined) return isPublicV4(v4);
  const v6 = parseV6(addr);
  return v6 !== undefined && isPublicV6(v6);
}

/**
 * Resolver answers that mean the name has no address: refused, not retried. Shared with the
 * fetcher (webFetch.ts) so the port contract has one list.
 */
export const NO_SUCH_NAME: ReadonlySet<string> = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME']);

/**
 * Per-query time limit and attempts for the web-link resolver. c-ares doubles the limit on each
 * retry, so one family waits at most 2 s + 4 s = 6 s, well inside the 15 s fetch deadline.
 */
const RESOLVER_OPTIONS = { timeout: 2_000, tries: 2 } as const;

/**
 * Once one family has answered with addresses, how long the other one gets before it is
 * cancelled: a resolver that drops AAAA queries must not hold the lookup for its full limit.
 */
export const FAMILY_GRACE_MS = 500;

/** A DNS failure with a code and fixed words: never the host name. */
function dnsFailure(code: string): Error {
  const words = code === 'ENOTFOUND' ? 'no such name' : 'lookup failed';
  return Object.assign(new Error(`dns: ${words}`), { code });
}

/** The string `code` of a thrown value, or `EUNKNOWN` when it has none. */
export function errorCode(reason: unknown): string {
  const code = (reason as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'EUNKNOWN';
}

/**
 * Every A then AAAA address for `host` (the production `resolveHost`). It queries DNS through its
 * own c-ares resolver, not getaddrinfo, so `signal` can cancel a slow lookup and no libuv thread is
 * held past the fetch deadline; /etc/hosts and search domains are not consulted. Once one family
 * answers with addresses, the other gets FAMILY_GRACE_MS before it is cancelled (its answers are
 * then simply missing, as for a transient failure). A name with no address throws code
 * ENOTFOUND; any other failure keeps its code (SERVFAIL, timeout, cancelled) so the caller can
 * retry it.
 */
export async function systemResolveHost(host: string, signal?: AbortSignal): Promise<string[]> {
  const resolver = new Resolver(RESOLVER_OPTIONS);
  const cancel = (): void => {
    resolver.cancel();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  let grace: ReturnType<typeof setTimeout> | undefined;
  try {
    const queries = [resolver.resolve4(host), resolver.resolve6(host)];
    const answers = Promise.allSettled(queries);
    const graceOver = new Promise<void>((resolve) => {
      const onAnswer = (found: readonly string[]): void => {
        if (found.length > 0) grace ??= setTimeout(resolve, FAMILY_GRACE_MS);
      };
      for (const q of queries) q.then(onAnswer, () => undefined);
    });
    if (signal?.aborted === true) cancel();
    const first = await Promise.race([answers.then(() => 'all' as const), graceOver]);
    if (first !== 'all') cancel();
    const settled = await answers;
    const found = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (found.length > 0) return found;
    const codes = settled.map((r) => (r.status === 'rejected' ? errorCode(r.reason) : 'ENODATA'));
    const transient = codes.find((c) => !NO_SUCH_NAME.has(c));
    throw dnsFailure(transient ?? 'ENOTFOUND');
  } finally {
    clearTimeout(grace);
    signal?.removeEventListener('abort', cancel);
  }
}
