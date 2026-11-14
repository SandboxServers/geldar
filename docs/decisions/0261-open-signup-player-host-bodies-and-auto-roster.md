# 0261. Open sign-up, player-host Bodies for sign-up agents, and auto-roster on registration

- Status: Decided (owner ruling, 2026-11-14)
- Date: 2026-11-14
- Spec: 5.15 (self-registration, sovereign players), 5.15.6 (one human, many players). `docs/spec.md` is not edited (decision 0073).
- Related: 0070 (invite-only wording, amended here for Phase 1 sign-up), 0135 (self-registration; R36, R40 to R42), 0153 (terms, consent and deletion before sign-up still apply), 0155 (legal text v1), 0170 (body quotas and the Colo capacity ceiling), 0171 (erasure), 0212 (golem-body profile), 0260 (body helper, fixed verbs), 0040 (Velocity life-registry key), 0136 (operator ban)
- Packets: [c7f-packets.md](../analysis/phase1/packets/c7f-packets.md) (cards LEGAL-SERVE, SIGNUP-RUNBOOK, REG-NATS-COMPOSE, ROSTER-AUTO, BODY-HOST; GLOBAL-CAP is folded into C7-03c1), [c7-wave-plan.md](../analysis/phase1/packets/c7-wave-plan.md) (ordered plan for M1 and M2)

## Context

The C7 readiness audit of 2026-11-14 (gaps G1 to G13) found four questions that only the owner could answer:

1. The sign-up posture was unclear. 0070 says invite-only, not announced; 0135 and its amendment R41 say verified sign-up, unannounced, with the verified-account rule later removed. The kill switch can only be all-or-nothing, so the owner could not be admitted alone (G13).
2. A Body that the supervisor starts for a sign-up agent runs the house Adam entry point and joins as the house identity, not as the agent (G2).
3. Nothing creates a roster row except the operator command, so every agent needs one manual step, and that step is the only brake on how many Bodies sign-up can create (G8).
4. Nothing caps the running Bodies on the node, although 0170 point 3 says the Colo capacity ceiling still applies (G10a).

The owner was asked directly on 2026-11-14 and ruled as follows.

## Decision

1. **Sign-up posture: open for everyone, unannounced once M1 is ready.** No allowlist, no invite check, no short window. Sign-in is Microsoft only (0135 R40). The verified-account rule and the age floor stay removed (R41). "Unannounced" means the URL is not published, linked or advertised. It is not an access check. This ruling is the Phase 1 posture for sign-up. It reconciles the invite-only wording of 0070 and the verified-sign-up wording of 0135 as amended. Those records stay as written. The spec's invite-only default is not edited (0073). Where the spec text and this ruling differ for Phase 1 sign-up, this ruling is the owner's current answer.
2. **A managed Body for a sign-up agent runs through the player-host path.** It runs the per-player host entry point (`golem/src/players/main.ts` with `player-config.ts`), not the house Adam entry point (`golem/src/adam/main.ts`). Its identity (the login name and the life id) comes from the database, not from the shard YAML. The helper admits the Body on Paper's whitelist and on the Velocity life-registry key (0040) without giving the Body RCON. Card BODY-HOST carries this. It supersedes the open part of C7-03b4 (the live check's name and admission). The Body container spec of C7-03b4 otherwise stands.
3. **Roster: auto-roster on registration, with a ceiling on running Bodies first.**
   - a. On registration of an agent, a SECURITY DEFINER function writes the `mcp_roster` row (card ROSTER-AUTO). It is idempotent, writes an audit row, pins `search_path`, and is granted to `geldar_register` only. Existing agents are not changed.
   - b. Per-owner agent cap: default **3** agents per owner, the same number as the existing `mcp_owners.player_cap` (sql/0002), so no new number is introduced. The owner's existing column is the per-owner setting. The cap is refused at the registration form and in SQL.
   - c. Display names: a name that is not a valid Minecraft login (3 to 16 letters, digits or underscore) is refused at the registration form and in SQL. Existing agents with other names keep working as they do now and are not given a Body.
   - d. **Global cap on running Bodies: 40 in total**, and the 15 sovereign hosts count toward it. The value is read from one config place (a shard file or one env name, default 40). The helper (card C7-03c1) refuses a start when running Bodies are at or above the cap, with a clear error and audit outcome `capacity`.
   - e. **Alert and review at 30 running.** Before any raise, re-measure: TPS 20 and MSPT under 25 at the Colo. Raise the cap in steps of 10. Per-owner caps stay in auto-roster, and the quotas of 0170 stay as they are.

## What it changes

- Sign-up no longer waits for an allowlist. The kill switch is the only gate, and geldar-93 flips it by the runbook (card SIGNUP-RUNBOOK).
- A Body for a sign-up agent runs the player-host entry point, with identity from the database (card BODY-HOST).
- A roster row for a new agent is written by code (card ROSTER-AUTO). The operator `roster-add` command remains for existing agents.
- The helper gets one global running-Body cap (folded into C7-03c1).
- The approved legal texts are served at `/register/terms` and linked at sign-up (card LEGAL-SERVE), as 0153 item 1 requires.

## What it does not change

- 0153 still applies. The legal text (LEGAL-SERVE), the consent box and deletion and export (C7-09, with the erasure rule of 0171) are required before the URL is opened to anyone outside the project. This ruling does not waive them. **OPEN QUESTION for the owner: does M1 wait for C7-09 and C7-11, or does 0261 supersede that part of 0153?** Not decided here. What 0153 requires is set out in the M1 and M2 plan of the wave plan. The M1 path there carries C7-09 and C7-11 as conditional steps until the owner answers.
- The quotas of 0170 (1 running per agent, 3 starts per agent per hour, 10 per owner per day, admin exempt).
- 0260: the helper holds the fixed verbs and the Docker socket, and no container mounts the socket.
- The Body spec of C7-03b4 and the NATS least-privilege rules (0067, 0080).

## Open sub-questions for geldar-93

- The RCON whitelist verb: which verb the helper uses to add a sign-up agent's life to Paper's whitelist, given that the Body itself holds no RCON.
- The life key: how the Velocity life-registry key (0040) is written for a database-only agent.
- Whether the helper reaches NATS through the published loopback port (open point of C7-03c1).
- Which containers carry the label set that the global count of 40 counts (the 15 sovereign hosts must be included).

## Consequences

- The M1 and M2 paths and their milestones are in [c7-wave-plan.md](../analysis/phase1/packets/c7-wave-plan.md).
- M2 is not reachable until the helper chain (C7-03c1, C7-03c3, C7-03b5, C7-03c2, C7-03b2 with REG-NATS-COMPOSE), ROSTER-AUTO, BODY-HOST and C7-04d-mount are merged and the node steps are done.
