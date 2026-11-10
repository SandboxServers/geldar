# 0073. docs/spec.md is never edited by agents; decision records amend it

- Status: Accepted (owner, 2026-11-10)
- Date: 2026-11-10
- Spec: the whole spec, and its open questions in section 13 (lines 1500 to 1532). Decisions 0061, 0066, 0068, 0070, 0071, 0072.

## Decision

1. **Agents never edit `docs/spec.md`.** Any change to it on a branch is reverted before merge. Only the owner may change the spec, and the owner decides whether to.
2. **Where the spec is wrong or silent, a decision record amends it.** The record names the spec section or line it amends, says what it decides instead, and says why. It does not rewrite the spec text, and a record is never rewritten to say something else (see the [decisions index](README.md)). A later record supersedes an earlier one.
3. **Open amendments, known on 2026-11-10.** The table is a snapshot. The current state of each row is in the record named in it. A row is updated by a new record that supersedes the one it names, not by editing this table's history.

| Spec says | Conflicts with | Settled by | Status |
|---|---|---|---|
| The reasoning "is not heard by anyone in the world (observers can read it)" (line 1584) | Decision 0059: agents are never told they are watched; decision 0068 removes observer meta from the prompt | [0068](0068-prompt-v4-and-agent-visible-text.md) | Proposed; the owner amends the line |
| The default cap is "3 per owner per shard" (5.15.6, line 961; open question 2h) | Decision 0052: the owner's cap is 20 | [0052](0052-per-owner-sovereign-player-cap-raised-to-20.md) | Settled for the owner; the spec line is open |
| "Player" and "agent" terms (spec sections 2a and 3, as the Phase 0 resume card lists them) | The sovereign-player wording used in decisions 0052 to 0055 | Open | Open (owner) |
| Personal names in about 30 lines of the spec | The repo rule of no personal names | Open | Open (owner) |
| Sovereign MCP uses OAuth 2.1 with an authorization server (6.2, 5.15.3) | Static hashed per-player bearer tokens | [0054](0054-static-hashed-per-player-bearer-tokens.md), with [0071](0071-public-endpoints-and-ports.md) | Settled for now; OAuth is the later answer |
| The Mind lives in the colo's Record/Mind host (6.1, 6.3) | In Phase 0 the Mind runs on the desktop | [0050](0050-phase0-mind-processes-run-on-the-host.md) for Phase 0 | Open for Phase 1; wave C1 decides |
| The Observatory edge is Cloudflare Tunnel and Access, recommended (6.2, 8.4); Caddy is the other option | The owner's ruling on shared Caddy | [0071](0071-public-endpoints-and-ports.md) | Settled: Caddy |
| The Observatory edge uses Entra ID SSO for humans (8.4) | Public Glass and BlueMap | [0072](0072-glass-and-bluemap-are-public.md) | Settled for Glass and BlueMap; Grafana and the Create player form stay private |
| The spectator proxy is TCP 25565 (6.2, 6.4) | 25565 is in use on the node; Minecraft is TCP only | [0071](0071-public-endpoints-and-ports.md) | Settled: a new TCP port with an SRV record |
| Nothing is exposed to the internet until Phase 2 (line 1398); Phase 1 is LAN only (line 1412) | The owner's colo-first Phase 1 | [0070](0070-phase1-is-the-colo-first-shard.md) | Settled for sequencing |
| Phase 1 excludes Shrine and permadeath (line 1414) but its exit requires a shrine, a death and a birth (line 1418) | Internal to the spec | [0070](0070-phase1-is-the-colo-first-shard.md) for sequencing only | Open for the wording; the exit is the target |
| Exactly four public ports (8.9) | The new Minecraft port and the viewer route; whether the existing TCP 18443 forward is public | [0071](0071-public-endpoints-and-ports.md) | Open until the wave C2 port scan settles the list |

4. **How to amend, for agents.** Find the gap, write the next free record with an index row, and cite the spec line. Do not edit the spec, and do not change an accepted record. If a record would have to say something different, write a new one that supersedes it.

## Why

- The spec is the owner's design record. If agents rewrote it, the design the work is judged against would change without anyone deciding that it should.
- A record keeps the change, the reason and the date, and it can be superseded without losing history.

## Consequences

- The open rows are the owner's list of spec edits, if the owner wants the spec to match the records. Until then, a reader of the spec must read the decision records with it. The decisions index is the place to start.
- A new spec conflict is recorded the same way: a row in a new snapshot record, or a decision that settles it. This table is not extended in place.
