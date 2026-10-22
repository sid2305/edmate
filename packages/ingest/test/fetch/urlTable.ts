// The SSRF URL table shared by linkUrl.test.ts and webFetch.test.ts (task 8.2d, ADR-0014).
// Each row is a URL a teacher could paste that must never reach a socket, with the refusal code
// checkWebLinkUrl gives it.
import type { WebLinkRefusal } from '../../src/fetch/linkUrl.js';

// Built, not written out, so the secret scan doesn't read userinfo as an e-mail address.
const AT = '@';

export const REFUSED_URLS: readonly (readonly [
  label: string,
  url: string,
  code: WebLinkRefusal,
])[] = [
  ['plain http', 'http://lessons.example.org/a', 'not_https'],
  ['ftp', 'ftp://lessons.example.org/a', 'not_https'],
  ['userinfo', `https://user:pw${AT}lessons.example.org/a`, 'has_credentials'],
  ['a user name only', `https://user${AT}lessons.example.org/a`, 'has_credentials'],
  ['port 8443', 'https://lessons.example.org:8443/a', 'bad_port'],
  ['port 80 on https', 'https://lessons.example.org:80/a', 'bad_port'],
  ['localhost', 'https://localhost/a', 'internal_name'],
  ['localhost with a trailing dot', 'https://localhost./a', 'internal_name'],
  ['LOCALHOST upper case', 'https://LOCALHOST/a', 'internal_name'],
  ['a *.localhost name', 'https://app.localhost/a', 'internal_name'],
  ['a *.internal name', 'https://foo.internal/a', 'internal_name'],
  ['cloud metadata name', 'https://metadata.google.internal/a', 'internal_name'],
  ['a *.local name', 'https://printer.local/a', 'internal_name'],
  ['a *.local name with a trailing dot', 'https://printer.local./a', 'internal_name'],
  ['localhost with two trailing dots', 'https://localhost../a', 'internal_name'],
  ['a *.internal name with two trailing dots', 'https://x.internal../a', 'internal_name'],
  ['a *.local name with three trailing dots', 'https://printer.local.../a', 'internal_name'],
  ['a *.home.arpa name', 'https://nas.home.arpa/a', 'internal_name'],
  ['a single-label name', 'https://intranet/a', 'internal_name'],
  ['127.0.0.1', 'https://127.0.0.1/a', 'private_address'],
  ['127.0.0.1 with a trailing dot', 'https://127.0.0.1./a', 'private_address'],
  ['127.0.0.1 with two trailing dots', 'https://127.0.0.1../a', 'private_address'],
  ['10.0.0.1 with three trailing dots', 'https://10.0.0.1.../a', 'private_address'],
  ['decimal 2130706433', 'https://2130706433/a', 'private_address'],
  ['hex 0x7f.1', 'https://0x7f.1/a', 'private_address'],
  ['octal 0177.0.0.1', 'https://0177.0.0.1/a', 'private_address'],
  ['hex 0x7f000001', 'https://0x7f000001/a', 'private_address'],
  ['0.0.0.0', 'https://0.0.0.0/a', 'private_address'],
  ['10.0.0.1', 'https://10.0.0.1/a', 'private_address'],
  ['100.64.0.1', 'https://100.64.0.1/a', 'private_address'],
  ['169.254.169.254', 'https://169.254.169.254/latest/meta-data', 'private_address'],
  ['172.16.0.1', 'https://172.16.0.1/a', 'private_address'],
  ['192.168.1.1', 'https://192.168.1.1/a', 'private_address'],
  ['Oracle metadata 192.0.0.192', 'https://192.0.0.192/a', 'private_address'],
  ['[::1]', 'https://[::1]/a', 'private_address'],
  ['[::]', 'https://[::]/a', 'private_address'],
  ['[::ffff:127.0.0.1] (dotted)', 'https://[::ffff:127.0.0.1]/a', 'private_address'],
  ['[::ffff:7f00:1] (hex)', 'https://[::ffff:7f00:1]/a', 'private_address'],
  ['[fe80::1]', 'https://[fe80::1]/a', 'private_address'],
  ['[fc00::1]', 'https://[fc00::1]/a', 'private_address'],
  ['[fd00:ec2::254] (AWS v6 metadata)', 'https://[fd00:ec2::254]/a', 'private_address'],
  ['[64:ff9b::a00:1] (NAT64)', 'https://[64:ff9b::a00:1]/a', 'private_address'],
  ['[2002:7f00:1::] (6to4)', 'https://[2002:7f00:1::]/a', 'private_address'],
  ['[2001:10::1] (ORCHID)', 'https://[2001:10::1]/a', 'private_address'],
  ['[3fff::1] (documentation, RFC 9637)', 'https://[3fff::1]/a', 'private_address'],
];

export const YOUTUBE_URLS: readonly string[] = [
  'https://youtube.com/watch?v=abc',
  'https://www.youtube.com/watch?v=abc',
  'https://m.youtube.com/watch?v=abc',
  'https://music.youtube.com/watch?v=abc',
  'https://youtu.be/abc',
  'https://YOUTU.BE./abc',
  'https://youtube-nocookie.com/embed/abc',
  'https://www.youtube-nocookie.com/embed/abc',
];
