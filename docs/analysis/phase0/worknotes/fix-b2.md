# Fix B2: journal abuse (scale review)

Branch `fix/b2-journal` from `phase0/integration` (83b0922). Worktree `.claude/worktrees/fix-b2`.

## Finding

The MCP `journal` tool is free, has no spacing bucket, and each call publishes a `sovereign_call`
with up to 2000 characters of journal text. Limits are 60 calls a minute per player and 600 a minute
per owner, so one owner can write about 1.3 MB a minute into the 30-day JetStream stream (no
`max_bytes`) and the never-pruned Postgres `events` table.

## Steps

1. Spacing bucket `journal:<life>` (`journal_min_seconds` in `sovereign.rate_limits`, default 5 s,
   tests). Status: done (step 1 commit; the refusal test was checked by reverting the world.ts check).
2. `sovereign_call` no longer carries the journal text: `journal_chars` and `journal_sha256` (16 hex
   of SHA-256 of the kept text) only (schema, `world.ts`, tests). Glass, report and eventsink do not
   read it (checked: no reference). Status: done (commit a8236f8; the leak test was checked by adding
   the text back to the event in `world.ts`, which failed it).
3. Stream byte limit `max_bytes` 2 GiB in `STREAM_CONFIG.maxBytes` (`eventsink/src/config.ts`), set in
   `consumer.ts` and `NatsEventPublisher.java`; `stream-config.test.ts` checks both and the README.
   The value is a constant changed in both places, like `retentionDays`, not an env setting. An existing
   stream keeps its limits (both creators only create when missing). Retention note for the Postgres
   `events` table is an open follow-up in `eventsink/README.md`; no pruning job. Status: done (commit
   8545908; the mutation check removed the line from `consumer.ts`, the test failed; Gradle
   `:core:test` ran green with the Java builder line, no unit test added for the private `ensureStream`).

## Notes

- Refused journal lines throw `ToolError('rate_limited')` before the write and record nothing, as `act`
  does.
- Only `threshold/mcp/src/world.ts` builds the sovereign_call payload. The tests that read the old
  `journal` field were `world.test.ts` and `contract/test/sovereign.test.ts`; both now check the length and hash.
