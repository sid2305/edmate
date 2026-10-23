# Sign-in mail and reverse proxy (deploy notes)

Two settings the sandbox gets for free, that production must set itself: where sign-in mail goes,
and which reverse proxy Caddy trusts. Neither needs a code change (task 1.4d); both are config.
Board task 13.6 (the real deploy guide) should fold this page in once it exists.

## Production sign-in mail: Resend, by config only

`EMAIL_SERVER`/`EMAIL_FROM` already route through any `smtp://`/`smtps://` URL
(`apps/web/src/auth/mail.ts` sends through nodemailer's SMTP transport). Human decision B-25:
production sign-in mail is Resend's SMTP relay, switchable to another provider later by changing
these two values only.

```
EMAIL_SERVER=smtps://resend:<RESEND_API_KEY>@smtp.resend.com:465
EMAIL_FROM=Edmate <sign-in@yourdomain.example>
```

The username is the literal string `resend`; `<RESEND_API_KEY>` is a placeholder for the real
Resend API key, set in the environment or secret manager, never committed. `EMAIL_FROM` must be a
verified sending domain in Resend.

**`docker/compose.yaml`'s default (`EMAIL_SERVER:-smtp://mailpit:1025`) is for the sandbox only
and must never reach production.** Mailpit has no outbound relay, and its local web UI shows every
sign-in link in plain text to anyone who can reach it -- fine for a laptop, a credential leak in
production. Production must set `EMAIL_SERVER`/`EMAIL_FROM` itself, in the environment or secret
manager, never by relying on compose's placeholder default.

## Caddy's `trusted_proxies`

The per-IP sign-in rate limit (`apps/web/src/auth/rate-limit.ts`'s `clientIp`) reads the
right-most entry of `X-Forwarded-For`, trusting that Caddy (not the client) set it. That is true
only when Caddy itself sits directly behind a reverse proxy, load balancer or CDN it is configured
to trust. In production, `docker/Caddyfile`'s site block must set `trusted_proxies` to whatever
sits in front of it, for example:

```
:80 {
	reverse_proxy web:3000 {
		trusted_proxies 10.0.0.0/8
	}
}
```

(the real value is whatever private range or CDN IP list the load balancer uses -- check its
docs). Without it, Caddy does not know which hop on the chain to trust, `clientIp` reads no real
client IP, and every client collapses into the shared `unknown` bucket: the per-IP limit still
fails toward limiting (it does not open up), but it no longer tells one client's requests apart
from another's, so a single noisy client can exhaust the shared bucket for everyone.
