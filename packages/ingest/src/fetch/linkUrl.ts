// The shape rules for a teacher's web link (ADR-0014), checked without any DNS lookup. Shared by
// the web route that adds a link (task 8.2f) and by the worker's fetcher on every redirect hop:
// https on port 443 only, no user name or password, at most 2048 characters, no internal host name
// (localhost, *.local, *.internal, *.home.arpa, single-label), an IP literal must be public, and
// YouTube is refused with its own code until its transcript question (B-47) is answered.
//
// WHATWG URL parsing has already turned decimal, hex, octal and short IPv4 spellings into dotted
// form (https://2130706433/ becomes 127.0.0.1) by the time these rules look at the host.
import { isIpLiteral, isPublicAddress } from './address.js';

export const WEB_LINK_MAX_URL_LENGTH = 2048;
const DISPLAY_TITLE_MAX = 500;

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const INTERNAL_SUFFIX = /\.(?:localhost|local|internal|home\.arpa)$/;

export type WebLinkRefusal =
  | 'invalid_url'
  | 'not_https'
  | 'has_credentials'
  | 'too_long'
  | 'bad_port'
  | 'internal_name'
  | 'private_address'
  | 'youtube_unsupported';

export type WebLinkCheck =
  | { readonly ok: true; readonly url: string; readonly displayTitle: string }
  | { readonly ok: false; readonly code: WebLinkRefusal };

/** A host name in lower case without any trailing dots (`Example.ORG..` -> `example.org`). */
export function bareHostName(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}

export function isYouTubeHost(hostname: string): boolean {
  return YOUTUBE_HOSTS.has(bareHostName(hostname));
}

/** A name that only ever means something inside a private network. IP literals are not judged here. */
export function isDeniedHostName(hostname: string): boolean {
  const host = bareHostName(hostname);
  if (isIpLiteral(host)) return false;
  return !host.includes('.') || INTERNAL_SUFFIX.test(host);
}

/** Why a parsed URL may not be fetched, or undefined when its shape is fine (DNS not consulted). */
export function webLinkRefusal(u: URL): WebLinkRefusal | undefined {
  if (u.protocol !== 'https:') return 'not_https';
  if (u.username !== '' || u.password !== '') return 'has_credentials';
  if (u.href.length > WEB_LINK_MAX_URL_LENGTH) return 'too_long';
  if (u.port !== '') return 'bad_port';
  // Judged on the bare name: `https://127.0.0.1../` is a domain to WHATWG but loopback once the
  // trailing dots go, and the fetcher connects to the bare name.
  const bareHost = bareHostName(u.hostname);
  if (isIpLiteral(bareHost)) return isPublicAddress(bareHost) ? undefined : 'private_address';
  if (isDeniedHostName(u.hostname)) return 'internal_name';
  return isYouTubeHost(u.hostname) ? 'youtube_unsupported' : undefined;
}

/** Check a link as the teacher typed it; the display title is the host only (paths carry tokens). */
export function checkWebLinkUrl(raw: string): WebLinkCheck {
  const text = raw.trim();
  if (text.length > WEB_LINK_MAX_URL_LENGTH) return { ok: false, code: 'too_long' };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, code: 'invalid_url' };
  }
  const code = webLinkRefusal(u);
  if (code !== undefined) return { ok: false, code };
  return {
    ok: true,
    url: u.href,
    displayTitle: bareHostName(u.hostname).slice(0, DISPLAY_TITLE_MAX),
  };
}
