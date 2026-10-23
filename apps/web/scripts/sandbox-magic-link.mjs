#!/usr/bin/env node
// Sandbox check for email magic-link sign-in (task 1.4), against the local compose stack:
//   AUTH_SECRET=$(openssl rand -base64 32) docker compose -f docker/compose.yaml up -d --build
//   node apps/web/scripts/sandbox-magic-link.mjs
// It requests a link for a reserved .test address, reads the mail from Mailpit's API, follows the
// link, prints /api/auth/session, then shows that the same link can't be used twice.
// Localhost only: it refuses any other host, and Mailpit never relays mail out.

const APP = new URL(process.env.SANDBOX_APP_URL ?? 'http://localhost:8080');
const MAIL = new URL(process.env.SANDBOX_MAIL_URL ?? 'http://127.0.0.1:8025');
const EMAIL = 'student1@example.test';

for (const u of [APP, MAIL]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    console.error(`refusing a non-local URL: ${u.origin}`);
    process.exit(2);
  }
}

/** A tiny cookie jar over Set-Cookie headers. */
function jar() {
  const values = new Map();
  return {
    take(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        const value = pair.slice(eq + 1);
        if (value === '' || /max-age=0/i.test(c)) values.delete(pair.slice(0, eq));
        else values.set(pair.slice(0, eq), value);
      }
    },
    header: () => [...values].map(([k, v]) => `${k}=${v}`).join('; '),
    names: () => [...values.keys()],
  };
}

async function call(cookies, url, init = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    ...init,
    headers: { cookie: cookies.header(), ...init.headers },
  });
  cookies.take(res);
  return res;
}

function check(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
}

async function waitForMail() {
  for (let i = 0; i < 40; i += 1) {
    const list = await (await fetch(new URL('/api/v1/messages', MAIL))).json();
    const found = list.messages?.find((m) => m.To?.some((t) => t.Address === EMAIL));
    if (found) return (await fetch(new URL(`/api/v1/message/${found.ID}`, MAIL))).json();
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no sign-in mail reached Mailpit');
}

const health = await fetch(new URL('/api/health', APP));
check(health.status === 200, `GET /api/health → ${health.status}`);

await fetch(new URL('/api/v1/messages', MAIL), { method: 'DELETE' });

const browser = jar();
const csrfRes = await call(browser, new URL('/api/auth/csrf', APP));
const { csrfToken } = await csrfRes.json();
check(typeof csrfToken === 'string' && csrfToken.length > 0, 'GET /api/auth/csrf → token');

const start = await call(browser, new URL('/api/auth/signin/email', APP), {
  method: 'POST',
  // A browser sends its Origin on a form POST; the binding cookie needs a same-origin one (1.4b).
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP.origin },
  body: new URLSearchParams({ csrfToken, email: EMAIL, callbackUrl: `${APP.origin}/` }).toString(),
});
const startLocation = start.headers.get('location') ?? '';
console.log(`POST /api/auth/signin/email (${EMAIL}) → ${start.status} ${startLocation}`);
check(startLocation.includes('/api/auth/verify-request'), 'redirected to verify-request');

const message = await waitForMail();
console.log(`Mailpit: "${message.Subject}" to ${message.To.map((t) => t.Address).join(', ')}`);
const link = /^http\S+$/m.exec(message.Text)?.[0];
check(link !== undefined, 'the mail holds a link');
const linkUrl = new URL(link);
check(linkUrl.origin === APP.origin, `link origin is AUTH_URL's (${linkUrl.origin})`);
console.log(`link: ${linkUrl.origin}${linkUrl.pathname}?token=<redacted>&...`);

// Task 1.4b: the link opens the confirm page. A scanner or another browser is asked to click;
// the browser that asked for it (binding cookie for this address) goes straight to the callback.
check(linkUrl.pathname === '/sign-in/confirm', 'the link opens the confirm page');
const scanner = jar();
const scanned = await call(scanner, linkUrl);
console.log(`GET link (another browser) → ${scanned.status}`);
check(
  scanned.status === 200 && !scanner.names().some((n) => n.endsWith('authjs.session-token')),
  'another browser opening the link is asked to confirm, not signed in',
);
const confirm = await call(browser, linkUrl);
const callbackUrl = new URL(confirm.headers.get('location') ?? '/', APP);
console.log(`GET link (same browser) → ${confirm.status} ${callbackUrl.pathname}`);
check(callbackUrl.pathname === '/api/auth/callback/email', 'the same browser goes straight to the callback');

// The callback itself is gated too: another browser sent straight to it is bounced to confirm.
const bounced = await call(jar(), callbackUrl);
const bouncedTo = new URL(bounced.headers.get('location') ?? '/', APP);
console.log(`GET callback (another browser) → ${bounced.status} ${bouncedTo.pathname}`);
check(bouncedTo.pathname === '/sign-in/confirm', 'another browser at the callback is sent to confirm');

const callback = await call(browser, callbackUrl);
console.log(`GET callback → ${callback.status} ${callback.headers.get('location')}`);
check(browser.names().some((n) => n.endsWith('authjs.session-token')), 'session cookie set');

const session = await (await call(browser, new URL('/api/auth/session', APP))).json();
console.log(`GET /api/auth/session → ${JSON.stringify(session)}`);
check(session?.user?.role === 'student' && typeof session.user.id === 'string', 'signed in as a student');

const replay = await call(browser, callbackUrl);
const replayLocation = replay.headers.get('location') ?? '';
console.log(`GET same callback again (same browser) → ${replay.status} ${replayLocation}`);
check(replayLocation.includes('error=Verification'), 'reusing the link is refused');
