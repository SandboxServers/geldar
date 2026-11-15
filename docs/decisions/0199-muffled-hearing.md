# 0199. Muffled hearing: walls absorb speech, and a muffled notice replaces the words

- Status: Proposed
- Date: 2026-11-14
- Number: 0199. Highest on main is 0196; 0198 (proximity chat) is not yet landed. Decision 0197 (the owner's ruling that map bubbles show all speech; being written by geldar-93, confirm number before merge) is not in this repo yet.
- Spec: 5.2 (earshot, perception snapshot), 5.8 (communication: the 32-block speech rule and information bubbles), 5.9 (`chat` config block)
- Related: 0154 (ruling 3: `heard_sound`, no coordinates, does not wake the Mind), 0181 (prompt budget), 0198 (proximity chat, plugin-side cut), 0197 (bubbles show all speech, owner request), 0067 and 0087 (NATS least privilege and scoped subjects), 0058, 0068, 0145 (nothing about who is watching)
- Packets: [docs/analysis/muffled-hearing/packets.md](../analysis/muffled-hearing/packets.md)

## Context

Spec 5.8 says `say(text)` reaches agents within 32 blocks. The rule is a plain distance cut and ignores walls. Two agents 10 blocks apart with a stone wall between them hear each other word for word. That breaks the physical-information premise: a wall should mean something.

Today nothing is range-limited in code yet. `golem/src/voice/ears.ts` keeps every chat line, and `plugin/core` has no radius code. The cut arrives with decision 0198 (`ProximityRule`, plain 3D distance, branch `phase1/proximity-chat`). This record builds on that cut. It does not replace it. 0198 lands first, then the spec amendment (MH-7), then the rest of the packets.

A listener beyond the cut never receives the chat packet, so the Body cannot learn of a muffled voice from its own chat hook. A muffled notice travels on a plugin-to-Body NATS subject (decision 5 below).

## Decision (proposed)

1. **Effective distance.** For a speaker and a listener, effective distance `e` is the raw 3D distance `d` plus the absorption of every block the straight line between them passes through. Air costs 0. Each absorbing block adds its absorption value (table below).

2. **Gate.** Only listeners with raw distance `d <= 32` are evaluated. The 32-block raw gate stays the outer bound for words and for notices: a listener beyond 32 raw blocks learns nothing, not even a muffled notice (owner ruling, 2026-11-14). Among the evaluated listeners:
   - **Clear**: `e <= 32`. The full words are delivered, as today.
   - **Muffled**: `32 < e <= 40`. No words. A `heard_muffled` notice carries a compass direction and a distance band, as `heard_sound` does (ruling 3). The muffle margin `M` is 8 (proposal, not measured, see step 5 and MH-8).
   - **Silent**: `e > 40`, or the ray cast was cut short by the cost cap (step 5). Nothing is delivered.

   The 0198 rule moves from raw distance to effective distance for the words. This changes 0198's acceptance tests. MH-3 rewrites them to gate on effective distance; 0198 itself lands first with plain distance.

3. **Sealed rooms.** A listener inside a fully enclosed space (no open path to the sky along a vertical ray from the listener) gets one extra absorption step, a fixed penalty `S`, proposed 4, not measured. This is the rule's answer to gaming by standing indoors: a sealed room costs the speaker's words one more step, nothing more.

4. **Absorption table (proposal, all values tunable in config, not measured).**

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

   These values are proposals and are not measured. The packet that adds the table needs a test that pins each row, so the table cannot drift without a visible change. MH-8 (the bench with 9 and 15 agents) sets the final values, the margin `M` and the sealed penalty `S`, before MH-3 merges.

5. **Cost cap.** The ray cast runs on the server thread, reading chunk snapshots, never live world calls. As built (MH-3): the plugin reads loaded chunks on the server thread through `PaperBlockReader`, never forces a chunk load, and treats an unloaded block as silent; it does not take chunk snapshots. The hearing sink makes one connect attempt at plugin enable (shared limit with `NatsKinoSink`), so notices are dropped until the next restart (the counter is not read anywhere yet) if NATS was down then.
   - Only listeners already within 32 raw blocks are cast (step 2).
   - A ray stops after 64 block reads (safety cap; a 32-block ray needs at most 32).
   - Per chat line, at most 512 block reads in total. When the total is reached, remaining listeners get the silent tier, and the plugin logs a counter, not the words. The 512 and 64 caps are proposals, not measured.
   - Results are cached per tick per (speaker, listener) pair, so a line is cast once per listener.

6. **Notice content.** Fixed text built from enumerated codes. No words, no coordinates, no speaker name. Two codes only: direction and band (near, mid, far, as in 0154 ruling 3). Direction is one of eight compass points, or `overhead` or `below` for a voice straight above or below the listener. "About 0" means the horizontal offset is under 1 block (dx and dz both below 1 in absolute value). `overhead` is used when the speaker is level with or above the listener (dy >= 0, the speaker's y minus the listener's y), `below` when under. The notice does not identify the speaker. A listener who hears a muffled voice knows only that someone spoke through a wall.

7. **Wake.** A `heard_muffled` event does not wake the Mind. This follows 0154 ruling 3. No new wake interest is added. See "Wait interests" below.

8. **Prompt budget.** A notice is about 20 to 30 tokens (estimate, about one token per three ASCII characters). The Body collapses notices by direction in the snapshot, with at most three lines per snapshot. Mind-facing text is versioned in `prompts/` (see Consequences). Text shown to kit agents is owned by scriptorium and is not decided here.

9. **Hearing channel (decided).** The plugin sends each muffled notice to the Body on a per-agent NATS subject:

   `geldar.<shard>.body.<lifeId>.hearing`

   It matches the existing per-life Body subjects (`snapshotSubject`, `planSubject`, `bookSubject`, `viewSubject` in `contract/src/subjects.ts`), so it follows the `maintenance` pattern of a plain subject with no WorldEvent envelope. A helper `hearingSubject(shard, lifeId)` is added beside them (MH-1). The payload is the `heard_muffled` event (below) and nothing else.

   **Current ACL, read from `geldar.ps1` (`Get-NatsUsers`):**
   - Body role (`body`, one shared credential for every body): Pub `geldar.<s>.>` plus JetStream and KV; PubDeny `geldar.<s>.kino.>`, `geldar.<s>.blockowner.changed`, `geldar.<s>.ctl.body.>`; Sub `geldar.<s>.body.>`, `geldar.<s>.blockowner.changed`, `_INBOX.>`.
   - Plugin role (`paper`): Pub `geldar.<s>.>` plus JetStream, with PubDeny on `kino.control`, `blockowner.query`, `ctl.body.>`; Sub `kino.control`, `maintenance`, `blockowner.query`, `_INBOX.>`.

   **So under the shared roles, the hearing subject needs no allow change.** The plugin may already publish it (inside `geldar.<s>.>`) and the Body may already subscribe to it (inside `geldar.<s>.body.>`). This is the proposal the packets use (option A), with one recommended change: the shared Body role can also publish the subject (its Pub is `geldar.<s>.>`), so a body could forge a notice for another life. Option A adds `geldar.<s>.body.*.hearing` to the PubDeny of the body, mind and mcp roles, because mind and mcp also hold Pub `geldar.<s>.body.>`, so a deny on body alone would let them forge a notice. That is a one-line generator change, so it reaches nodes only in a geldar-93 window like any `nats-auth.conf` change; the owner decides whether to take it with option A or with option B.

   **The owner asked for per-agent scoping (option B), which the current design does not do.** `geldar.ps1` says no role is scoped to one life (decision 0087), because a life is not known when the file is written. Option B would need, as a proposal and not built:
   - A per-life Body user, minted when a body starts (through the supervisor and register path, 0152), not in `shard nats-auth`. Its Sub: `geldar.<s>.body.<lifeId>.hearing` only, plus the `blockowner.changed` and `_INBOX.>` it has today. If the Body needs more of its own life tree, `geldar.<s>.body.<lifeId>.>`; still no wildcard over other lives.
   - Its PubDeny adds `geldar.<s>.body.*.hearing`, so a Body cannot forge a notice for any life. Its broad Pub `geldar.<s>.>` is a separate hardening, not proposed here.
   - The plugin's Pub stays `geldar.<s>.>`. Narrowing it to `geldar.<s>.body.*.hearing` would narrow every plugin subject and is not proposed.
   - `tools/repo-checks/src/nats-auth.test.ts` pins the exact body deny list today and would change with option B.
   - Option B supersedes part of 0087 and needs its own record before any code. Option A ships first; option B is a follow-up if the owner still wants per-life credentials.

   **Deploy.** Option A needs no allow change, so the plugin and Body deploys suffice for it. The recommended body, mind and mcp PubDeny on `geldar.<s>.body.*.hearing` is a `nats-auth` generator change (`Get-NatsUsers` in `tools/geldar.ps1`) and reaches a node only in a geldar-93 deploy window (`deploy/README.md`: regenerate, copy, restart `nats`, which drops every client, after a notice). Per-life scoped credentials stay out of scope (0087).

   Known limit (not verified live): the body, mind and mcp roles also hold $JS.API.>. A JetStream stream republish may emit to a subject without a publish-ACL check on that subject. If so, the PubDeny guards against mistakes and ordinary bugs, not against a hostile or compromised role. The existing Kino and state.*.level denies share this property.

## Heard_muffled event shape

`heard_muffled` reuses the `heard_sound` shape:

- `kind`: `"heard_muffled"`
- `direction`: one of eight compass points, or `overhead` or `below` (step 6 defines them)
- `band`: `near` | `mid` | `far`
- no coordinates, no speaker, no words

It is a new schema file (`contract/schemas/heard-muffled-event.schema.json`), not an edit to `heard-sound-event.schema.json`, so that the existing sound path keeps its contract unchanged. The text sentence is a new function beside `heardSoundSentence` in `contract/src/outcome-words.ts`.

## Wait interests

`McpInterest` in `contract/schemas/mcp-common.schema.json` is a closed six-value enum marked PROVISIONAL. Adding a value needs its own decision record. This record recommends no wake interest for muffled speech. A Mind that wants to be woken by muffled speech can still set a `sound` interest, which is already off by default (0154 ruling 3). If a later decision wants a `muffled` interest, it is a new record.

## Fairness and consistency

- **Spec 5.8 (32 blocks).** The spec's "within 32 blocks" becomes "within 32 effective blocks through air, with a muffled notice up to 40", with the raw 32-block gate as the outer bound. The spec amendment (MH-7) is an owner approval point and lands before MH-3 merges. This is the largest change to the spec in the record.
- **Spec 5.2 (earshot).** The perception snapshot says entities are seen "within line of sight or earshot". This record defines earshot as the clear tier, plus the muffled notice for the margin. No new sense is added.
- **Information bubbles (spec 5.8, "Villages become information bubbles").** Settled by the owner (2026-11-14): the public map speech bubbles show ALL speech, on purpose (owner request, decision 0197). They are a human observer's view. Agents never see the bubbles; their hearing follows the rules in this record (the clear tier, the muffled notice and the silent tier). A wall stops an agent's hearing, and the bubbles are not an agent input, so there is no unfairness between agents. The MH-7 spec note records this.
- **Who is watching.** Nothing in the notice or the snapshot shows who watches the agent. This follows 0058, 0068, 0145, 0093, 0138 and 0139.

## Principle 1

Nothing in this design lets a human act inside the world. The muffled notice is produced by the plugin from world state, and the cut is applied to the same world state for every listener. A human spectator has no new input. The bubbles are a human observer's view only (above).

## Risks

- **Ray cast cost.** 9 to 15 agents chatting in one area can mean dozens of lines per second, each cast against up to 14 listeners. The per-line cap and the per-tick cache bound this. MH-8 measures it at 20 TPS, with the body benchmark's shard, before MH-3 merges.
- **Gaming by standing in a sealed room.** A listener inside a sealed room hears less. A speaker can exploit this by enclosing the speaker, not the listener. The sealed-room penalty is one fixed step, so the gain is capped. Measure the gain in the bench; do not assume it is small.
- **Consistency with spec 5.8.** Spec and code disagree until the amendment merges. The amendment (MH-7) lands before MH-3.
- **Absorption values, margin and sealed penalty.** Proposals, not measured. MH-8 sets them. The table test pins each row; changing a value is a visible diff.
- **Hearing subject ACL.** Under the shared body role, a body can publish `geldar.<s>.body.<lifeId>.hearing` and forge a notice for another life. The body, mind and mcp PubDeny on `geldar.<s>.body.*.hearing` is recommended and needs a geldar-93 window; until it lands the forgery gap stays. Option B needs its own record (see decision 9).

## Consequences

- Packets in `docs/analysis/muffled-hearing/packets.md` implement this record. Each packet names the step it implements. Order: 0198, then MH-7, then the rest.
- Plugin: extends 0198's `ProximityRule`. Config constants (`chat.muffle`, see packets) are added to the spec's `chat` block at 5.9.
- Body and contract: a new `heard_muffled` perception event in the Appendix A perception schema, a new contract schema, a new sentence function, a new threshold handler beside `heard-sound.ts`, and the `hearingSubject()` helper.
- NATS: option A adds no allow. The recommended body, mind and mcp PubDeny on `geldar.<s>.body.*.hearing` changes the generator in `tools/geldar.ps1` and `tools/repo-checks/src/nats-auth.test.ts`, and reaches a node only in a geldar-93 window. A test (MH-CH) pins that the existing plugin and Body allows cover the hearing subject, so a later narrowing fails it.
- Prompts: the Mind-facing text for muffled notices is added in `prompts/` with a version bump. No released template is edited in place (Appendix D).
- Tests: each behavior change has a test that fails when reverted (repo rule). Every absorption row is pinned.

## Settled by the owner (2026-11-14)

- **Raw gate.** 32 blocks stays the outer bound for words and notices. Muffled reaches effective 40 (`M` = 8).
- **Channel.** A per-agent subject, `geldar.<shard>.body.<lifeId>.hearing`, decision 9. Option A (shared roles, no ACL change) ships first.
- **Map bubbles.** Show all speech to human observers, on purpose (0197). Agents' hearing follows these rules.
- **Order.** 0198 first (plain distance), then the MH-7 spec amendment (an owner approval point), then the rest.

## Still open

1. **Values.** The absorption table, `M` = 8, `S` = 4 and the caps (512 per line, 64 per ray) are proposals, not measured. MH-8 sets them before MH-3 merges.
2. **Per-agent NATS credentials (option B).** The owner asked for per-agent scoping. Option A is the proposal; option B needs its own record and changes the body role. Not decided.
3. **Kit-agent text (scriptorium).** Not decided here.
4. **Decision 0197 number.** Confirm before this record merges.

## MH-1 notes

docs/spec.md Appendix A still needs the heard_muffled event paragraph; docs/spec.md is the owner's file and the paragraph goes in the owner's spec PR.
