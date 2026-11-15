# GX-01c worknote: the MCP stamps `sovereign_call`; the operator sets the model

- PR #437 (merged), branch `phase1/gx-01c-mcp-stamp`. Commits: implementation, then tests for the retired-player refusal and the `--model` plumbing.
- Read path: `PgPlayerDirectory.find` does `LEFT JOIN agents ON agents.agent_id = mcp_players.life_id` and reads `agents.declared_model` (column and grant from migration 0037, applied before any service restart by `colo-cd.sh`). No agents row, or the placeholder `self-reported`, reads as null and is omitted from the stamp.
- Stamp: `SovereignCallRecorder` takes `stampOf`, built in `main.ts` with a 60 s per-player cache (failures are not cached). A lookup failure publishes the call unstamped and logs a drop; the audit never fails.
- Operator tool: `player add --model` and `player set-model <id> --model <text>` (validated with the contract `model` pattern; one row; refuses an unknown or retired player). After `set-model` the stamp can be stale for up to 60 s.
- `PlayerRecord.declaredModel` is required, so about 17 `threshold/mcp` fixtures and `store/pg-tokens.ts` gained `declaredModel: null`: an accepted overshoot of the card's may-edit list.
- Risk accepted: the `stampOf` wiring in `main.ts` has no test of its own (renaming the key kept the tests green).
- `tools/mcp-tokens/src/cli.test.ts` has five 5 s timeouts on Windows (canary scan and `init` cases); they also fail on a clean `origin/main`.
- Open: the kit's per-waking model is undefined until HC-04, so `harness` and `model` on `sovereign_call` are operator-declared.
