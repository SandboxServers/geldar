# 0154. Perception rules: what the Mind and the Body may see and hear

- Status: Decided (owner rulings, 2026-11-11)
- Date: 2026-11-11
- Spec: the knowledge boundary (5.2), the perception channels; related 0058, 0068, 0145, 0057 (credits)
- Packet: wave PX (see [packets/px-perception-packets.md](../analysis/phase1/packets/px-perception-packets.md))

## Decision

Principle: an agent gets what a player could see or hear, in fixed text, with no wiki knowledge and nothing about who is watching. Facts, never advice. The owner ruled on seven points.

1. **Hostile flag.** Known always-hostile mobs are ALWAYS flagged `hostile`: zombie, skeleton, creeper, witch, phantom, drowned, husk, stray, pillager and the like, following the game's own hostile classification. Neutral and conditional mobs (wolf, enderman, piglin, bee, iron golem, spider, and similar) are not flagged from the type alone. Their threat is read from observed behaviour: state (idle, closing, attacking, fleeing) and the held item.
   - Spider is conditional. It is neutral in daylight or bright light unless provoked, and hostile at night or in low light. Its hostility shows only through observed state. Orchestrator ruling, 2026-11-11: this replaces the earlier "always flagged" reading, and PX-2b may be dispatched.
2. **Time of day.** A coarse sun phase only (morning, midday, afternoon, low, set). No tick countdown and no clock.
3. **Hearing.** Sounds arrive as `heard_sound` events with a compass direction and a distance band (near, mid, far), never coordinates. The radius is fixed. Sounds do not wake the Mind on their own; a wake interest `sound` is off by default.
4. **Regeneration hint.** The hint states the rule plainly as fixed text, and the trend is shown as data. It does not give advice.
5. **Block counts require line of sight.** Counts of nearby block kinds count only cells the Body can see.
6. **Body reflexes use line of sight too.** The body and the Mind must not disagree about what is there. Reflexes do not act on hostiles they cannot see.
7. **Reach and entity positions.** The `reach` tool is free (it costs no credits). Entities in sight carry exact coordinates. Entities only heard carry a bearing and a distance band, never coordinates.

Nothing in any perception channel shows who watches the agent (Glass, Lakitu, spectators). This follows 0093, 0138 and 0139.

## Consequences

- The packets in wave PX implement these rules. Each packet names the ruling it implements.
- Reflexes lose sight-free knowledge of hostiles. A fight-or-flee reflex can no longer react to a hostile behind a wall. This is intended.
- Decision numbers: this record is the only decision number used by wave PX. Packets do not draft new numbers.
- The death fields (per-life counter, death location, dropped items, respawn point) are not in this record. They belong to decision 0144 and packet PX-0 (C6-DEATH).

## Orchestrator's recommended default and why

Not applicable. The owner ruled on every point. The spider point under ruling 1 is settled by the orchestrator (conditional mob); no open points remain.
