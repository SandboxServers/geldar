# XXXX. Muffled hearing: walls absorb speech, and a muffled notice replaces the words

- Status: Proposed
- Date: 2026-11-14
- Number: placeholder `XXXX`. geldar-93 assigns the number when this is merged. Highest on main is 0196; 0198 (proximity chat) is not yet landed.
- Spec: 5.2 (earshot, perception snapshot), 5.8 (communication: the 32-block speech rule and information bubbles), 5.9 (`chat` config block)
- Related: 0154 (ruling 3: `heard_sound`, no coordinates, does not wake the Mind), 0181 (prompt budget), 0198 (proximity chat, plugin-side cut), 0058, 0068, 0145 (nothing about who is watching)
- Packets: [docs/analysis/muffled-hearing/packets.md](../analysis/muffled-hearing/packets.md)

## Context

Spec 5.8 says `say(text)` reaches agents within 32 blocks. The rule is a plain distance cut and ignores walls. Two agents 10 blocks apart with a stone wall between them hear each other word for word. That breaks the physical-information premise: a wall should mean something.

Today nothing is range-limited in code yet. `golem/src/voice/ears.ts` keeps every chat line, and `plugin/core` has no radius code. The cut arrives with decision 0198 (`ProximityRule`, plain 3D distance, branch `phase1/proximity-chat`). This record builds on that cut. It does not replace it.

A listener beyond the cut never receives the chat packet, so the Body cannot learn of a muffled voice from its own chat hook. A muffled notice has to travel on a plugin-to-Body channel. The channel is not yet confirmed (see open questions).

## Decision (proposed)

1. **Effective distance.** For a speaker and a listener, effective distance `e` is the raw 3D distance `d` plus the absorption of every block the straight line between them passes through. Air costs 0. Each absorbing block adds its absorption value (table below).

2. **Gate.** Only listeners with raw distance `d <= 32` are evaluated (the existing 0198 cut and `chat.radius`). Among them:
   - **Clear**: `e <= 32`. The full words are delivered, as today.
   - **Muffled**: `32 < e <= 32 + M`, where `M` is the muffle margin (proposal 8). No words. A `heard_muffled` notice carries a compass direction and a distance band, as `heard_sound` does (ruling 3).
   - **Silent**: `e > 32 + M`, or the ray cast was cut short by the cost cap (below). Nothing is delivered.

   The 0198 rule moves from raw distance to effective distance for the words. This changes 0198's acceptance test and is recorded here so the packet can carry it.

3. **Sealed rooms.** A listener inside a fully enclosed space (no open path to the sky along a vertical ray from the listener) gets one extra absorption step, a fixed penalty `S` (proposal 4). This is the rule's answer to gaming by standing indoors: a sealed room costs the speaker's words one more step, nothing more.

4. **Absorption table (proposal, all values tunable in config).**

   | Material | Absorption per block | Note |
   |---|---|---|
   | air | 0 | |
   | glass, glass panes | 0.5 | |
   | iron bars | 0.5 | |
   | fences, fence gates, walls (cobblestone) | 1 | fence gates by state |
   | wood planks, logs, leaves | 1 | |
   | closed wooden door, closed trapdoor | 2 | by state |
   | open door, open trapdoor | 0 | by state; a door left open does not absorb |
   | stone, dirt, gravel, ores, bricks | 2 | |
   | wool (any colour) | 3 | highest of the solid blocks |
   | water (per block) | 1 | |
   | any other solid, unknown | 2 | default; avoids a free pass through unlisted blocks |

   Proposal values, not measured. The packet that adds the table needs a test that pins each row, so the table cannot drift without a visible change.

5. **Cost cap.** The ray cast runs on the server thread, reading chunk snapshots, never live world calls.
   - Only listeners already within 32 raw blocks are cast (step 2).
   - A ray stops after 64 block reads (safety cap; a 32-block ray needs at most 32).
   - Per chat line, at most 512 block reads in total. When the total is reached, remaining listeners get the silent tier, and the plugin logs a counter, not the words.
   - Results are cached per tick per (speaker, listener) pair, so a line is cast once per listener.

6. **Notice content.** Fixed text built from enumerated codes. No words, no coordinates, no speaker name. Two codes only: direction (one of eight compass points) and band (near, mid, far, as in 0154 ruling 3). The notice does not identify the speaker. A listener who hears a muffled voice knows only that someone spoke through a wall.

7. **Wake.** A `heard_muffled` event does not wake the Mind. This follows 0154 ruling 3. No new wake interest is added. See "Wait interests" below.

8. **Prompt budget.** A notice is about 20 to 30 tokens (estimate, about one token per three ASCII characters). The Body collapses notices by direction in the snapshot, with at most three lines per snapshot. Mind-facing text is versioned in `prompts/` (see Consequences). Text shown to kit agents is owned by scriptorium and is not decided here.

## Heard_muffled event shape

`heard_muffled` reuses the `heard_sound` shape:

- `kind`: `"heard_muffled"`
- `direction`: one of eight compass points
- `band`: `near` | `mid` | `far`
- no coordinates, no speaker, no words

It is a new schema file (`contract/schemas/heard-muffled-event.schema.json`), not an edit to `heard-sound-event.schema.json`, so that the existing sound path keeps its contract unchanged. The text sentence is a new function beside `heardSoundSentence` in `contract/src/outcome-words.ts`.

## Wait interests

`McpInterest` in `contract/schemas/mcp-common.schema.json` is a closed six-value enum marked PROVISIONAL. Adding a value needs its own decision record. This record recommends no wake interest for muffled speech. A Mind that wants to be woken by muffled speech can still set a `sound` interest, which is already off by default (0154 ruling 3). If a later decision wants a `muffled` interest, it is a new record.

## Fairness and consistency

- **Spec 5.8 (32 blocks).** The spec's "within 32 blocks" becomes "within 32 effective blocks through air, with a muffled notice up to 32 + M". The spec needs an amendment with this record. This is the largest change to the spec in the record and the packets wait for it.
- **Spec 5.2 (earshot).** The perception snapshot says entities are seen "within line of sight or earshot". This record defines earshot as the clear tier, plus the muffled notice for the margin. No new sense is added.
- **Information bubbles (spec 5.8, "Villages become information bubbles").** Spec says nothing about which speech is shown on the map. The working understanding is that bubbles show all speech to human viewers, not to agents. This is unverified and must be confirmed before the packet that relies on it is written. If the bubbles show chat to agents, a wall stops nothing on the map, and the rule is unfair in the way a player with a map would notice. Confirm; do not assume.
- **Who is watching.** Nothing in the notice or the snapshot shows who watches the agent. This follows 0058, 0068, 0145, 0093, 0138 and 0139.

## Principle 1

Nothing in this design lets a human act inside the world. The muffled notice is produced by the plugin from world state, and the cut is applied to the same world state for every listener. A human spectator has no new input.

## Risks

- **Ray cast cost.** 9 to 15 agents chatting in one area can mean dozens of lines per second, each cast against up to 14 listeners. The per-line cap and the per-tick cache bound this. The packet's bench (see packets.md, MH-8) measures it before merge, at 20 TPS, with the body benchmark's shard.
- **Gaming by standing in a sealed room.** A listener inside a sealed room hears less. A speaker can exploit this by enclosing the speaker, not the listener. The sealed-room penalty is one fixed step, so the gain is capped. Measure the gain in the bench; do not assume it is small.
- **Consistency with spec 5.8.** Spec and code disagree until the amendment merges. The amendment lands first.
- **Bubble fairness.** See above. Unverified.
- **Absorption values.** Proposal values, not measured. The table test pins them; changing a value is a visible diff.

## Consequences

- Packets in `docs/analysis/muffled-hearing/packets.md` implement this record. Each packet names the step it implements.
- Plugin: extends 0198's `ProximityRule`. Config constants (`chat.muffle`, see packets) are added to the spec's `chat` block at 5.9.
- Body and contract: a new `heard_muffled` perception event in the Appendix A perception schema, a new contract schema, a new sentence function, a new threshold handler beside `heard-sound.ts`.
- Prompts: the Mind-facing text for muffled notices is added in `prompts/` with a version bump. No released template is edited in place (Appendix D).
- Tests: each behavior change has a test that fails when reverted (repo rule). Every absorption row is pinned.

## Open questions

1. Which plugin-to-Body channel carries the muffled notice? The plugin's existing event bus or a NATS subject. Not confirmed; the Body's current channels are not read in this record.
2. Is the 32-block raw gate kept as the outer bound (this draft), or does the muffled margin reach beyond it? This draft keeps it, so a listener beyond 32 raw blocks learns nothing.
3. Map bubble behaviour (above). Confirm before the packet that relies on it.
4. Are absorption values right? They are proposal values. The bench measures cost, not realism.
5. The sealed-room penalty `S` and the margin `M`: proposed 4 and 8. Tunable.
6. Kit-agent text (scriptorium).

## Owner rulings needed

None are settled yet. This record is Proposed. The owner decides items 2 and 3 above before the first code packet is dispatched.
