# Web-link network egress firewall (deploy notes)

A second layer behind `EDMATE_WEB_LINK_HOSTS`, for the worker's web-link fetch (task 8.2e,
ADR-0014). Neither needs a code change (task 8.2g); both are config. Board task 13.6 (the real
deploy guide) should fold this page in once it exists.

## The rule, and why

The worker's network egress should be restricted, at the firewall or cloud security-group layer,
to public port 443 (any host) plus the worker's own Postgres, Redis and object-storage endpoints.
Nothing else.

This is a **second** layer behind the app-level host allow-list check already in
`packages/ingest/src/fetch/address.ts` (the 8.2e review's LOW at lines 113-131): that check
resolves a candidate web-link host and refuses it unless every resolved address is public (and,
when `EDMATE_WEB_LINK_HOSTS` is a comma list rather than `*`, unless the bare host name matches
exactly). A firewall rule that also drops everything except 443 and the worker's own three
service endpoints means that even a bug or a future change in that app-level check cannot let the
worker reach an internal host, a metadata endpoint, or any other address on the network --
the packets never leave.

## The resolver ignores `/etc/hosts` and split-horizon DNS

The host-allow-list check resolves candidate hosts with a `dns.promises.Resolver` pointed at
explicitly configured public nameservers (ADR-0014, Decision 1 and its Consequences), not Node's
default resolver. That resolver talks to those nameservers directly over the network and never
consults `/etc/hosts` or any split-horizon/internal DNS view the host or container runtime might
otherwise apply. In practice this means neither `/etc/hosts` nor an internal DNS view can be used
to widen or narrow what the worker reaches by web link: only two things control that --
`EDMATE_WEB_LINK_HOSTS` at the application layer, and this network egress rule at the firewall
layer.

## Compose network segmentation

`docker/compose.production-egress.example.yaml` is a standalone reference compose file (never run
as part of the dev stack, never combined with `docker/compose.yaml` via `-f`) that shows the
network shape this rule assumes:

- `postgres`, `redis` and `minio` sit on a network marked `internal: true`. Compose gives that
  network no route to the outside world at all, regardless of any firewall rule, so those three
  services cannot reach the public internet even if a firewall rule were misconfigured.
- `worker` is the only service on a second, `egress` network, which does have a route out. That
  `egress` network's traffic is the only thing a host or cloud firewall rule needs to restrict,
  because it is the only path out of the stack.

Compose itself has no notion of restricting a network's egress to specific ports or destinations
-- `internal: true` only removes the route out entirely, it does not filter what a connected
network *can* reach. The destination and port restriction (443 plus the three service endpoints)
is necessarily a firewall-layer rule outside Compose, documented below as prose and example
snippets, not as compose configuration.

## Firewall examples

### `iptables` / Docker's `DOCKER-USER` chain

Replace `<WORKER_EGRESS_IP>` with the worker container's address on the `egress` network (a
placeholder; find it with `docker network inspect`), and `<DB_HOST>`, `<REDIS_HOST>`,
`<S3_HOST>` with your actual managed database, cache and object-storage endpoints:

```
# Allow the worker's egress-network address out to public HTTPS and its own three services...
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -p tcp --dport 443 -j ACCEPT
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -d <DB_HOST> -p tcp --dport 5432 -j ACCEPT
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -d <REDIS_HOST> -p tcp --dport 6379 -j ACCEPT
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -d <S3_HOST> -p tcp --dport 443 -j ACCEPT
# ...then drop everything else from that address.
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -j DROP
```

### Cloud security group (equivalent shape)

On the worker's own security group, add egress rules allowing only: 443 to `0.0.0.0/0` (any
public host, for web links); the managed database's port to the database's own security group or
endpoint; the managed cache's port to the cache's own security group or endpoint; and 443 to the
object-storage endpoint (or its security group, if the provider exposes one). Add no other egress
rule on that security group -- anything not covered by one of those four allow rules is implicitly
dropped, exactly like the `iptables` example's trailing `DROP`.

## This is a second layer, not a replacement

This firewall rule sits behind the app-level check, not instead of it. It does not replace
`EDMATE_WEB_LINK_HOSTS` (which decides *which* public host names a web link may name) or the
address-range check in `packages/ingest/src/fetch/address.ts` (which decides that every resolved
address for an allowed host is actually public). All three -- `EDMATE_WEB_LINK_HOSTS`, the
app-level range check and this network rule -- need to be correct together.

Board task 13.6 (the real deploy guide) should fold this page in once it exists.
