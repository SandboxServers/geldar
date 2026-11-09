# P0-04 coder report

Branch phase0/p0-04-thinker, worktree p0-04. Packet: Thinker protocol frame schemas (spec Appendix H, section 6.3).

## Files
- contract/schemas/thinker-frame.schema.json (new): root oneOf of nine frames in $defs, title ThinkerFrame.
- contract/test/thinker-frame.test.ts (new): 9 Appendix H examples accepted; completion 32769 chars, error code "oops", hello with extra thinker field, { "type": "job" } rejected; plus a few extra guards.
- contract/src/index.ts: only the `// --- P0-04 thinker ---` block (types, MAX_FRAME_BYTES, MAX_COMPLETION_TEXT, validateThinkerFrame).
- contract/src/generated/types.ts, validators.js, validators.d.ts: regenerated.

## Checks (final)
- generate: wrote 3 files.
- typecheck: exit 0.
- test: `pnpm test` (root Vitest, the contract package has no own test script): 33 passed.
- check:generated: up to date.
- check (`./geldar.ps1 check`): All checks passed.

## Mutation check (rule 7)
Changed completion text maxLength 32768 to 40000, regenerated, ran tests: "rejects a completion with 32769-character text" failed (1 failed, 32 passed). Schema restored byte-identical and regenerated. Other rejection tests were not separately mutated.

## Deviations and choices
- Frame defs are named HelloFrame ... DrainFrame, not bare names, so no generated type shadows the global Error.
- The import of validateThinkerFrame sits inside the P0-04 block (mid-file), so the shared header is untouched.
- Constraints the spec does not state, chosen by me: ModelName pattern `^[a-z0-9][a-z0-9._:/-]{0,127}$`; ThinkerName pattern `^[a-z][a-z0-9-]{1,63}$`; semver regex; job.max_tokens 1–32768; usage_reported requires both counts; welcome.accepted_models uniqueItems; message content unbounded (frame size cap applies).
- heartbeat.load is a map, so its additionalProperties is the value schema (integer >= 0), not false.
- Formatter pass (biome format) applied to the new schema after the first lint failure (formatting only).
