# 0092. Velocity spectator whitelist and the ghost rule

- Status: Proposed (orchestrator, 2026-11-11; owner to confirm)
- Date: 2026-11-11
- Spec: sections 8.4 (human identity: watchers and ghosts), Appendix F (bot-ingress identity). Decisions 0021, 0067, 0070, 0071, 0077, 0080.

## Problem

Phase 1 puts the public Minecraft TCP port on Velocity (0071). Velocity must admit only the names the registry knows, must not tell a stranger what the registry holds, and must keep a ghost (a registered name whose life is not live) out of the agent command channel. The code before this record admitted every registered name the same way and had no ghost state.

## Decision

1. **The whitelist is the registry.** Velocity keeps no second list. A username is admitted when the registry has synced, the name is a plain username, and the registry holds a fresh entry for it (`LoginGate.classify`, `LifeRegistry.find`).
2. **Three outcomes.** `DENIED`: the name is unregistered, the registry has not synced, the name is not a plain username, the entry is older than 90 s, or the entry's `live` field is not a JSON boolean. `LIVE`: a registered entry whose `live` is true or absent. `SPECTATOR` (a ghost): a registered entry whose `live` is `false`.
3. **Refusal reveals nothing.** Every `DENIED` sees the same message (`This connection is not admitted.`). It names neither the registry, a life, nor an agent.
4. **Ghosts are admitted, not refused.** A `SPECTATOR` connection passes login. It is never admitted to the `geldar:cmd` channel (`LoginGate.isAdmitted` is true for `LIVE` only). The spectator game mode is forced by Paper (Geldar-Core ghost enforcement, spec 8.4), not by Velocity, which has no game-mode API. Velocity's part is the channel block and the log line.
5. **Field absence means live.** Writers that predate the `live` field (the Golem registry writer) keep their meaning. Nothing in the repo writes `live: false` yet, so no name is a ghost in Phase 1 until a writer does.
6. **No real port in the record.** The public port is set at deploy time (C2-07). This record names no port and no host.

## Consequences

- A ghost cannot send `geldar:cmd` messages, so it cannot offer, propose or vote (spec 8.4).
- The spectator game mode still depends on Paper. Until Geldar-Core enforces it, a ghost joins in the game mode the backend gives. That gap is recorded here and in the C2-02 worknote, not fixed in Velocity.
- A registry writer that sets `live: false` is a change to the registry value format. It belongs to the owner of the life registry writer, not to this record.

## Open

- The owner confirms the ghost rule (item 2 and item 4) and the field name `live`.
- Whether a ghost's life state is written by the Body, or by a ghost-add command (spec 8.4, `geldar ghost add`), is not decided.
