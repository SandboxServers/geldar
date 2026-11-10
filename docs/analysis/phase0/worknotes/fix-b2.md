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
2. `sovereign_call` no longer carries the journal text: `journal_chars` and a short hash only
   (schema, mapper, tests). Glass, report and eventsink do not read it (checked: no reference).
   Status: pending.
3. Stream byte limit `max_bytes` (documented value 2 GiB, configurable) in `eventsink/src/consumer.ts`
   and `NatsEventPublisher.java`; retention note for `events` in docs; no pruning job.
   Status: pending.

## Notes

- Refused journal lines throw `ToolError('rate_limited')` before the write and record nothing, as `act`
  does.
- Only `threshold/mcp/src/world.ts` builds the payload; the tests that read `journal` are listed in the
  step 2 commit message.
