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

The per-IP sign-in rate limit (`apps/web/src/auth/rate-limit.ts`'s `clientIp`) reads only the
**right-most** entry of `X-Forwarded-For`, trusting that Caddy (not the client) set it. `reverse_proxy { trusted_proxies <ranges> }` alone
does not fix that: when Caddy trusts the peer
that connected to it, it *appends* that peer's own address to `X-Forwarded-For` rather than
replacing the header, so the right-most entry `clientIp` reads is still Caddy's direct peer -- the
load balancer, not the real client. In production, every client then shares the load balancer's
single per-IP bucket (not an "unknown" bucket), so once `IP_LIMIT` sign-in emails are sent in the
window, email sign-in fails for every client behind that load balancer, until the window rolls
over.

The fix is to have Caddy itself hand the app the real client IP, globally, with the trusted
load balancer or CDN ranges locked down:

```
{
	servers {
		trusted_proxies static <your load balancer ranges>
		trusted_proxies_strict
	}
}

:80 {
	reverse_proxy web:3000 {
		header_up X-Forwarded-For {client_ip}
	}
}
```

`<your load balancer ranges>` is a placeholder: the private range or CDN IP list your load
balancer actually uses (check its docs). `{client_ip}` is Caddy's own best guess at the real
client, computed from the trusted ranges rather than taken from client-sent headers.
`trusted_proxies_strict` is required: without it, `{client_ip}` falls back to the left-most
`X-Forwarded-For` entry, which an untrusted client can simply put there itself, defeating the
per-IP limit entirely.
