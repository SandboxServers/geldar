# 0387. The NeoForge shard is human-directed

- Status: Proposed (owner answer D-1 of 2026-11-17, given via the lead; the owner accepts or edits this record). See the status line below.
- Date: 2026-11-17
- Spec: section 2 (Principle 1), section 8.4 (spectator proxy), the role table (Ghost). Supersedes part of 0137 (the spectator rule, for the NeoForge shard's human listener only). Builds on 0059, 0073, 0383 and 0385. Source: [public-and-human-route.md](../analysis/neoforge/public-and-human-route.md), decision D-1.

**Status line (explicit).** The owner must either edit `docs/spec.md` (Principle 1 and the role table) to carve out the human-directed shard, or accept this record. Until one of those happens, the spec and this record disagree for the NeoForge shard. Agents never edit `docs/spec.md` (0073). Until the owner acts, a reader who cites Principle 1 for the NeoForge shard must also cite this record.

## Decision

1. **The NeoForge shard is human-directed.** Humans play there as players: they join, act, build and talk in its world. Agents may play there too. This is the owner's answer to D-1 of the public-route note.
2. **The autonomous shard is unchanged.** Principle 1 holds there as written: no human acts in its world. It stays agents-only. Its Velocity stays offline-mode, unpublished and reachable only on its own compose network. Decision 0137 applies to it in full.
3. **0137 is superseded in part, for the NeoForge shard's human listener only.** The spectator-proxy rule of 0137 (humans are held in spectator mode, the ghost rule, the ghost signal, and the public proxy admitting humans as ghosts) does not apply to the NeoForge human listener. Its admission rules are replaced by item 5 of this record. The rest of 0137 still applies to that listener:
   - the deploy guards of its item 4 (a strict IPv4 bind that is not `0.0.0.0`; a port from 1 to 65535 that is never 25565 or 25566; the publish merged only after the proxy reports healthy);
   - its item 3 (least privilege: the human listener reads the life registry and skins read-only, and holds no KV publish).
   - The concurrent-player cap and the login rate limit of 0137 item 1 stay at their defaults (5 and on) until the owner changes them (D-9 of the public-route note).
   - The text of 0137 is not edited. This record is cited from 0137 by path, as 0381 does for 0041.
4. **Two listeners on the NeoForge shard.**
   - The bot ingress stays offline-mode, reachable only on the compose network, and is never published. Bodies connect to it. No human reaches it.
   - The human listener is a separate Velocity with `online-mode = true`. It is the only game listener of the NeoForge shard that is published, and it forwards to the NeoForge server over modern forwarding.
   - The human listener refuses agent names and offline-mode UUIDs (item 5). It never writes to the life registry.
5. **The human lane's refusals.** The human listener refuses a login when any of these holds, and checks them on every login, not only at registration:
   - (a) the lowercase name is in the NeoForge life registry (`geldar-life-registry` on the NeoForge shard's NATS; the agent registry);
   - (b) the name has the agent id shape. UNVERIFIED: the `ag_` shape in the public-route note has not been checked against the life-id generator for NeoForge; check it before relying on it;
   - (c) the session UUID equals the offline-mode UUID of the claimed name (UUIDv3 of `OfflinePlayer:` plus the name). The formula was recomputed in [p0-findings.md](../analysis/neoforge/p0-findings.md) row 3, not compared with a Paper run. UNVERIFIED: that a Microsoft session under online mode and Proxy Compatible Forge never produces that UUID (packet A2 settles it);
   - (d) the UUID is not a registered human, or the human record is revoked. The human registry's bucket name and record shape are open (public-route note D-2 and B4). A name match alone never admits a human.

   The admission rules beyond these refusals (the human registry, the cap, the denial limiter) are in the public-route note, section 4, and are not decided here.
6. **Humans earn nothing and hold no marks.** The progression defaults apply on the NeoForge shard: no marks, no stipend, no trade, no post, no accept or award for a human (`progression-defaults.md`, Q5 and Q9; 0385 items 3 and 4). No progression record is created for a human.
7. **No observation of humans reaches agents.** 0059 holds. No agent-facing tool, prompt, seed or template text says that humans watch, join or act on the NeoForge shard. The `identity_mode` of the NeoForge shard file (public-route note D-11) is still open and does not change this rule.
8. **Telemetry D-F stays open.** Human chat, sign and book text verbatim with no speaker id is not decided. Nothing human-written is exported until the owner answers. Other human telemetry follows the as-built defaults of the NeoForge telemetry note, and nothing exports until an enablement window is opened.

## Why

- The owner answered D-1 on 2026-11-17: humans are players on the NeoForge shard, and the autonomous shard stays agents-only. Principle 1 cannot hold for one shard and not the other as written, so the NeoForge shard is an explicit exception, recorded here, and the spec is left to the owner.
- 0137's two-listener design exists because the bot ingress trusts the name a client claims. The human listener keeps that trust off the human route by refusing agent names and offline UUIDs (items 4 and 5). The bot listener is never reached from outside.
- Humans on the NeoForge shard are players, so the 0137 ghost rule, which holds non-agents in spectator, would be wrong on that shard. The rule stays for the autonomous shard, where it protects Principle 1.

## Consequences

- The spec and this record disagree for the NeoForge shard until the owner acts (see the status line).
- 0137 is superseded in part, for the NeoForge human listener only. Its text is not edited.
- The autonomous shard, its Velocity and its compose project are unchanged by this record.
- The human route work is ordered in the public-route note, section 7: scratch packets A1 to A4 first; B2, B3 and B4 wait for the owner's names and the live project; B5 and B6 do not start, because their paths are on the colo-images filter.
- Public names, the game port and the bind are not decided here. The game port is decided as an SRV record (see the public-route note, section 3), and the port number, bind literal and DNS names still need the owner's explicit approval before anything is opened.

## Not settled by this record

- The human registry bucket name, record shape, cap and admission list (public-route note D-2, D-9).
- The agent id shape for NeoForge (item 5 (b), UNVERIFIED).
- The online-mode UUID under Proxy Compatible Forge (item 5 (c), UNVERIFIED; packet A2).
- `identity_mode` for the NeoForge shard file (D-11).
- Telemetry D-F (D-5 of the public-route note).
- The registration route for humans, Microsoft only or GitHub and Discord too (D-4; 0135).
