// Which IP addresses a web link may reach. Only public unicast space passes: loopback, private,
// carrier-grade NAT, link-local (including the 169.254.169.254 cloud metadata service), unique-local,
// documentation, benchmarking, multicast, reserved, NAT64, 6to4 and Teredo ranges are all refused,
// as is IPv4 hidden inside IPv6 (::ffff:a.b.c.d) when the IPv4 part is not public.
import { lookup } from 'node:dns/promises';

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
  const [g0 = 0, g1 = 0, , , , g5 = 0, g6 = 0, g7 = 0] = g;
  const leadingZero = g.slice(0, 5).every((x) => x === 0);
  // ::ffff:a.b.c.d is IPv4 in disguise: judge the IPv4 address.
  if (leadingZero && g5 === 0xffff) return isPublicV4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  // Only global unicast (2000::/3), minus Teredo, documentation and 6to4 inside it.
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return false;
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

/** Every address the system resolver returns for `host` (the production `resolveHost`). */
export async function systemResolveHost(host: string): Promise<string[]> {
  const found = await lookup(host, { all: true, verbatim: true });
  return found.map((a) => a.address);
}
