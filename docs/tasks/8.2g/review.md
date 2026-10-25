# 8.2g review — APPROVE

Reviewers: code-reviewer, security-reviewer

Deploy notes for a network egress rule behind the web-link host check: a standalone example compose file (data services on an `internal: true` network, the worker alone on an `egress` network) and docs/setup/web-link-egress-firewall.md with iptables and security-group examples. The lead fixed the doc's findings in one pass (see the handoff's lead fix-round decision).

## Findings
- [HIGH] [fixed] docs/setup/web-link-egress-firewall.md — claimed internal hosts were unreachable while the example allowed 443 to any address; the example now drops the non-public ranges on every port before public 443, and the doc names what stays uncovered.
- [MEDIUM] [fixed] docs/setup/web-link-egress-firewall.md — IPv4-only rules; added the IPv6 section (enable_ipv6 off, ip6tables mirror) and the security-group IPv6 note.
- [LOW] [fixed] docs/setup/web-link-egress-firewall.md — the resolver uses the OS nameservers, not explicit public ones; reworded.
- [LOW] [wontfix] docker/compose.production-egress.example.yaml — worker env omits S3_REGION and S3_BUCKET; the file shows the network shape and is never run.
