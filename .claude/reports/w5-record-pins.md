# w5-record-pins

Status: done.

1. Personality seed: the owner-approved seed is in `shards/phase0.yaml` under `mind.agent.personality_seed` (YAML double-quoted); comments and decision 0051 status line updated (approved 2026-11-09). The animus placeholder test now builds its own placeholder docs instead of relying on the checked-in file.
2. `./geldar.ps1 adam select --model strong|fast`: `cli.ts` shares `applyLife` (over the existing `selectLife`) with `up --model`; `selectInFile` is exported and tested in `tools/adam-cli/src/cli.test.ts` (round trip on a temp copy; bad `--model` exits 1). Revert-check: not writing the file makes the round-trip test fail. The live cases' failure message names the command; `animus/README.md` and the `geldar.ps1` usage text updated.
3. Digests recorded with `adam models --record` (qwen3:32b 030ee887..., qwen3:8b 500a1f06..., nomic-embed-text 0a109f42...). The lantern-local test that asserted the real file is refused is replaced by a strict load of the real file; a matching strict test is added in animus. `adam models` now reports `ok` for all three.
4. The file selects the strong life `ag_adam_01`; the live cases need `adam select --model fast` first (stated in the README).
