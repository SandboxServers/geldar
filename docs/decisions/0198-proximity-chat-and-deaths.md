# 0198: Proximity chat and death messages reach only the players within 32 blocks

- Status: Accepted
- Date: 2026-11-14
- Accepted: owner requested proximity chat 2026-11-14; implemented in #360 (1ab9c878), live since the 11-14 Paper restart.
- Why: Spec 5.8 says speech is delivered only to agents (and ghosts) within 32 blocks, "There is no global chat", and spec 5.9 says death is announced only to agents within 32 blocks. Nothing implemented either. Chat and death messages went to the whole server, so an idle Body 500 blocks away heard every line.
- Implements: spec 5.8 ("Speech", line ~666) and spec 5.9 ("Death", line ~694). The spec text is unchanged.

## What the plugin does

- **Chat (`ProximityChatListener`).** On Paper's `AsyncChatEvent`, every player in the viewers set who is not in the speaker's world, or who is more than 32 blocks from the speaker, is removed from that set. The speaker always keeps their own line. The console is not a player, so it stays and the server log still records every line. The message is not cancelled or rewritten, so the event export and the Body's `say` echo are unchanged.
- **Death (`ProximityDeathListener`).** On `PlayerDeathEvent` the server-wide death line is cleared, and the same line goes to the players within 32 blocks of the deceased (same world; the deceased is at distance 0 and gets it too). It also goes to the console. The death event is not cancelled, so the death export and the gravestone listener are unchanged.
- **The rule (`ProximityRule`).** A pure class with one constant, `HEARING_RADIUS_BLOCKS = 32.0`. A listener hears a line when the offset from the source is at most 32 blocks in 3D (squared distance at most 1024). Exactly 32.0 is heard. A different world is never heard.
- **Limits per agent (256 characters, 1 message per 3 seconds).** These stay where they already are: the 256-character cap is the `say` schema (`maxLength` 256 in `contract/mcp-play.schema.json`), and the 3-second limit is the MCP rate limiter (`say_min_seconds`). The plugin does not repeat them.

## What changes for agents

- Agents no longer hear speech from beyond 32 blocks. The Mind sees fewer overheard speech events. This is the intended effect of spec 5.8.
- Death is heard only near the death. Others find out when the agent stops showing up, as the spec says.
- An idle Body far away hears nothing.

## What still sees everything

- The server console and the server log.
- The NATS event export (speech, death and the rest). The Mind of the speaker still gets its own line.
- The public map speech bubbles (decision 0197, in another PR) and Glass. They are not chat recipients and are not filtered here.

## Limits (honest)

- **3D distance, inclusive.** The distance is Euclidean in three dimensions, not a horizontal box. The bound is inclusive: 32.0 blocks is heard, 32.01 is not.
- **No occlusion.** Walls, sealed rooms and materials do not block sound. A sealed room is no quieter than an open field. Occlusion is a later decision.
- **Ghosts.** Ghost enforcement is not built yet, so the rule applies to a ghost only as to any other player: a ghost's distance is checked like any listener's. Ghosts' own speech is still cancelled by `GhostListener`, as before. The spec's "(and ghosts)" wording is not implemented beyond that.
- **Thread.** Paper calls the chat event on an async thread, so the listener reads the speaker's and each viewer's location there. The chat filter cannot run later on the server thread, because the event's recipients are fixed once it is dispatched.

## Consequence (for later)

The owner's idea of muffled voices (speech that is quieter in a sealed room or that carries less through a material) is a separate future change. It would need occlusion, which this decision leaves out. Nothing here sets its shape.
