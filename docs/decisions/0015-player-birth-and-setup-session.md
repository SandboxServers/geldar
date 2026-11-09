# 0015. Until the Allocator exists, a player is born through the launcher and a one-time setup session

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15.5 (onboarding: the Allocator writes `player.json` and `memory/identity.md`), 5.15.8 ("set the character's personality once"), 5.9 (lineage); builds on 0011, 0014

## Decision

A player is born in two steps, both run by the human through the launcher (0012):

1. **`geldar-play new <name>`** creates `player-<name>` from the published template (0014) using the human's own GitHub login, clones it, and writes the parts of `player.json` the launcher knows: shard, MCP URL, harness and kit image. The Allocator will take over this step when it exists (5.15.5); its output is the same files.
2. **`geldar-play setup <name>`** runs the vendor CLI once in the kit container in **setup mode**. That's a separate settings file, shipped in the image, which allows writes to `memory/identity.md` and the identity fields of `player.json` and nothing else outside `memory/`. The kit's `setup` skill interviews the human about who the character is (name, personality, voice, a short backstory seed) and writes the identity. It also seeds `memory/summary.md` and `memory/goals.md`, drawn only from the personality, never from strategy about the world.

The launcher's path rule for a setup session (0011) allows exactly those files. After the first setup commit, `memory/identity.md` is write-once: every later session rejects any commit that touches it.

Characters may be based on people or fictional characters the human chooses. Their personality lives in the identity, not in `CLAUDE.md`, which stays the same for every player.

## Why

- The spec has the Allocator reserve a name and seed and write the identity (5.15.5), but the Allocator is Phase 2 or later. The kit needs a way to make a working player now.
- The spec lets the human shape the character's personality once (5.15.8). A guided setup session makes that once a single recorded commit. A hand-edited file nobody reviews would not be.
- Keeping the personality in `memory/identity.md`, read through `recall("identity")`, keeps `CLAUDE.md` identical across players. That's what makes it safe to update through kit releases.

## Consequences

- The setup skill's prompts are part of the kit and get the same versioning and review as the `play` and `reflect` skills.
- The setup commit is the player's birth commit, its first entry in `git log` (5.15.4, "Git as biography").
- The norm in 5.15.8 still holds: setup may describe who the character is, never where things are or what to do in the world. The setup skill refuses world strategy, and the README says why.
- Lineage (5.9) later creates a child through the same `new` step with a synthesized seed instead of an interview.
- Death and archival (`geldar-play archive <name>`: final push, then the repo is archived) are part of the same launcher.
