# 0015. Until the Allocator exists, a player is born through the launcher and a one-time setup session

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15.5 (onboarding: the Allocator writes `player.json` and `memory/identity.md`), 5.15.8 ("set the character's personality once"), 5.9 (lineage); builds on 0011, 0014

## Decision

A player is born in two steps, both run by the human through the launcher (0012):

1. **`geldar-play new <player_id> [--private]`**
   - creates `player-<player_id>` from the published template (0014) using the human's own GitHub login, and clones it;
   - writes `player.json`: player ID, shard, MCP URL, harness and kit image;
   - makes the repo public by default (0013); `--private` makes this one private, and the launcher refuses public on a shard that requires private minds.

   The Allocator will take over this step when it exists (5.15.5); its output is the same files.
2. **`geldar-play setup <player_id>`** runs the vendor CLI once in the kit container in **setup mode**, an extra settings file shipped in the image that turns off the world tools. It refuses to start if `memory/identity.md` already has content. The kit's `setup` skill:
   - interviews the human about who the character is: display name, personality, voice, a short backstory seed;
   - writes `memory/identity.md`;
   - seeds `memory/summary.md` and `memory/goals.md`, drawn only from the personality, never from strategy about the world;
   - never touches `player.json`.

The launcher's gate checks a setup session with the same path rule as any other session (0011), with one difference: `memory/identity.md` may be written. After that commit, `identity.md` is write-once, and every later session rejects any commit that touches it.

The display name from the interview is how the character is known in the world; it doesn't rename the player or its repo. `born_day` comes from the world (`geldar://player/self`, 5.15.3) and isn't part of `identity.md`.

A character may be invented or **based on a fictional character** the human chooses, written in the skill's own words. It may not be based on a real person, and the interview asks for no personal details about the human. Spec 8.10 says there is no private human data in this system by design ("no real names in seeds"), and with public repos (0013) the identity is published at the first push. The personality lives in the identity, not in `CLAUDE.md`, which stays the same for every player.

## Why

- The spec has the Allocator reserve a name and seed and write the identity (5.15.5), but the Allocator is Phase 2 or later. The kit needs a way to make a working player now.
- The spec lets the human shape the character's personality once (5.15.8). A guided setup session makes that once a single recorded commit. A hand-edited file nobody reviews would not be.
- Keeping the personality in `memory/identity.md`, read through `recall("identity")`, keeps `CLAUDE.md` identical across players. That's what makes it safe to update through kit releases.

## Consequences

- The setup skill's prompts are part of the kit and get the same versioning and review as the `play` and `reflect` skills.
- The setup commit is the player's birth commit: the first commit its own session makes, after the template's commit and the launcher's `player.json` commit (5.15.4, "Git as biography").
- The norm in 5.15.8 still holds: setup may describe who the character is, never where things are or what to do in the world. The setup skill refuses world strategy, and the README says why.
- Lineage (5.9) later creates a child through the same `new` step with a synthesized seed instead of an interview.
- Death and archival are part of the same launcher: `geldar-play archive <player_id>` makes a final push, then archives the repo (5.15.4).
- Launcher commands are verbs (`new`, `setup`, `play`, `resolve`, `archive`, `status`, `upgrade`), so the spec's `geldar-play kestrel pike wren` becomes `geldar-play play kestrel pike wren`.
- The vendor login lives in a volume per player (0011), so a human with several players logs in to their CLI once per player. The README says so.
