# Web-link network egress firewall (deploy notes)

A second layer behind `EDMATE_WEB_LINK_HOSTS`, for the worker's web-link fetch (task 8.2e,
ADR-0014). Neither needs a code change (task 8.2g); both are config. Board task 13.6 (the real
deploy guide) should fold this page in once it exists.

## The rule, and why

The worker's network egress should be restricted, at the firewall or cloud security-group layer,
to port 443 on public addresses plus the worker's own Postgres, Redis and object-storage endpoints.
Private, loopback, shared (CGNAT) and link-local addresses, including the cloud metadata endpoint,
are dropped on every port, 443 included. Nothing else.

This is a **second** layer behind the app-level host allow-list check already in
`packages/ingest/src/fetch/address.ts` (the 8.2e review's LOW at lines 113-131): that check
resolves a candidate web-link host and refuses it unless every resolved address is public (and,
when `EDMATE_WEB_LINK_HOSTS` is a comma list rather than `*`, unless the bare host name matches
exactly). A firewall rule that drops the non-public ranges on every port, and everything
else except public 443 and the worker's own three service endpoints, means that a bug or a future
change in that app-level check cannot let the worker reach an internal host or a metadata endpoint
by its private address: those packets never leave.

What the firewall does **not** cover: any host on a public address that answers on 443. That
includes your own services if they have public addresses. For those, the app-level check and
`EDMATE_WEB_LINK_HOSTS` remain the only control, so keep internal services off public addresses
or behind their own authentication.

## How the check resolves names

The host-allow-list check resolves candidate hosts with its own `dns.promises.Resolver`
(c-ares; ADR-0014, Decision 1), not `dns.lookup`. It sets no nameservers of its own
(`setServers()` is never called), so it queries the nameservers the OS is configured with
(`/etc/resolv.conf` in the container) and skips `/etc/hosts` and the system's NSS lookup. If those
nameservers serve an internal (split-horizon) view, the worker sees that view.

That does not widen what the worker can reach: the check refuses a host unless **every** resolved
address is public, whatever nameserver answered. Only two things control what the worker reaches by
web link -- `EDMATE_WEB_LINK_HOSTS` and the address-range check at the application layer, and this
network egress rule at the firewall layer.

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

Rules are matched in order, so the worker's own services come first, then the non-public ranges
are dropped, and only then is public 443 allowed:

```
# 1. The worker's own three services (these may sit on private addresses).
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -d <DB_HOST> -p tcp --dport 5432 -j ACCEPT
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -d <REDIS_HOST> -p tcp --dport 6379 -j ACCEPT
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -d <S3_HOST> -p tcp --dport 443 -j ACCEPT
# 2. Every other non-public destination, on every port (443 included).
for net in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 \
           172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
  iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -d "$net" -j DROP
done
# 3. Public HTTPS for web links, then drop everything else from that address.
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -p tcp --dport 443 -j ACCEPT
iptables -A DOCKER-USER -s <WORKER_EGRESS_IP> -j DROP
```

If the worker resolves names through a nameserver on a private address, allow that one address on
port 53 (UDP and TCP) in step 1.

### IPv6

`iptables` rules never match IPv6 traffic. The example compose file leaves `enable_ipv6` off on
the `egress` network (the Compose default), so the worker has no IPv6 route out; keep it that way.
If you do enable IPv6 on that network, or the cloud network gives the worker an IPv6 address, mirror
the rules with `ip6tables` on the worker's IPv6 address: allow its three services, then allow only
`2000::/3` on port 443, then drop everything else:

```
ip6tables -A DOCKER-USER -s <WORKER_EGRESS_IP6> -d 2000::/3 -p tcp --dport 443 -j ACCEPT
ip6tables -A DOCKER-USER -s <WORKER_EGRESS_IP6> -j DROP
```

### Cloud security group (equivalent shape)

On the worker's own security group, add egress rules allowing only: 443 to `0.0.0.0/0` (for
web links); the managed database's port to the database's own security group or endpoint; the
managed cache's port to the cache's own security group or endpoint; and 443 to the object-storage
endpoint (or its security group, if the provider exposes one). Add no other egress rule on that
security group -- anything not covered by one of those four allow rules is implicitly dropped,
exactly like the `iptables` example's trailing `DROP`. Add no IPv6 egress rule (no `::/0`) unless
you need it, and then only 443 to `2000::/3`.

Security groups usually only allow, so "443 to `0.0.0.0/0`" also allows 443 to private addresses
inside your own network. Close that gap at another layer: a subnet network ACL (or the provider's
equivalent) that denies outbound traffic to the private and shared ranges from the worker's
subnet, except the three service endpoints, and the provider's own control for its metadata
service (turn it off for the worker, or require session tokens with a response hop limit of 1).

## This is a second layer, not a replacement

This firewall rule sits behind the app-level check, not instead of it. It does not replace
`EDMATE_WEB_LINK_HOSTS` (which decides *which* public host names a web link may name) or the
address-range check in `packages/ingest/src/fetch/address.ts` (which decides that every resolved
address for an allowed host is actually public). All three -- `EDMATE_WEB_LINK_HOSTS`, the
app-level range check and this network rule -- need to be correct together.

Board task 13.6 (the real deploy guide) should fold this page in once it exists.
