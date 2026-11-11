# 0132. IPv4 literal policy: loopback and documentation addresses anywhere, private addresses only in an allowlist, public addresses never

- Status: Accepted (orchestrator, 2026-11-10)
- Date: 2026-11-10
- Spec: none; this records the repo rule in `CLAUDE.md` ("No secrets, account names, or public or private-network IPs in the repo (127.0.0.1 is fine)"). Related: `docs/threat-model.md`, decisions 0050 (loopback for Phase 0) and 0082 (loopback ports). Packet FX-IPCHECK.

## Problem

The repo rule was a sentence with no check, and it reads two ways. Its intent is to keep real addresses out of a public repository: the Colo node, the owner's network, anyone's. Read literally, it bans every dotted quad. A scan found about 700 IPv4 literals in tracked files. Most are loopback. Tests of IP and CIDR handling also use RFC 1918 private ranges as CIDR constants and as non-loopback host inputs, and two product defaults are private CIDRs. Those values are synthetic, but a literal ban would fail them and push the tests toward loopback values that do not test the range logic.

## Decision

1. **Four classes of IPv4 literal.**
   - **Allowed anywhere:** `127.0.0.0/8`, `0.0.0.0`, and the three RFC 5737 documentation ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`. Documentation ranges are reserved for examples and route to no host.
   - **Allowed only in an allowlisted file:** the RFC 1918 private ranges (the 10, 172.16 and 192.168 blocks), the link-local block and the carrier-grade NAT block (100.64 to 100.127). A file is allowlisted only when it implements or tests IP, CIDR or host handling.
   - **Everything else fails:** any other IPv4 literal, which is a public routable address, fails in any file, allowlisted or not.
   - A private literal in a file that is not allowlisted fails.

2. **The allowlist.** `tools/repo-checks/src/ip-literal-allowlist.json` is a JSON array of `{ "path", "reason" }` objects. Paths are repo-relative. An entry is added in the same change that needs it, with a short reason, and a reviewer checks that the private literals in it are synthetic. The check does not tell a real private address from a synthetic one; the allowlist and review do.

3. **What is scanned.** Every git-tracked and untracked text file. Binary files (any NUL byte) are skipped, and so are `pnpm-lock.yaml`, `release-dates.json`, Gradle lockfiles, `verification-metadata.xml`, `CHANGELOG*` files, and `contract/src/generated`. A `version` field (JSON, YAML or Maven) is not scanned, so a four-part package version is not a finding.

4. **Matching.** A dotted quad whose four octets are each 0 to 255, not preceded by a digit or a dot and not followed by a digit or a dot-digit pair. An octet of 256 and a five-part dotted number are not addresses and are ignored.

5. **Reports name the place, not the value.** A finding prints `path:line` and the class (public, or private outside the allowlist). It never prints the address. A public literal that is real infrastructure is reported to the owner by `path:line`; it is not copied into the report, the log or a commit.

## Consequences

- A test that needs a non-loopback host uses an RFC 5737 address unless it tests the private ranges, in which case its file goes on the allowlist.
- The check covers IPv4 dotted quads only. It does not cover IPv6, host names, or other notations (integers, hex). Those stay a review matter.
- `CLAUDE.md` should point at this record. Agents do not edit `CLAUDE.md`; the owner makes that edit.

## Unblocks

- Packet FX-IPCHECK, which implements the check in `tools/repo-checks` and runs it in `pnpm check:repo`.
