# Wave M fix requests

## R1

- tools/mcp-tokens/secret-files.ts (CLI): refuse a pepper under 32 bytes at mint time, with the same rule as threshold/mcp `pepperBytes` (one trailing LF or CRLF removed, nothing else trimmed).
- tools/mcp-tokens `init --force`: print a loud warning that the database role password is not changed by a rewrite of postgres-mcp.txt, and document it in the README.
- tools/mcp-tokens checkOutPath: resolve the parent directory with realpath before the in-repo check, so a symlink outside the repo that points in is refused.
- tools/mcp-tokens on win32: mode 0o600 is not enforced and mkdir uses the default mode; add an icacls step or document the limitation.
- Item C (token CLI) done: the pepper golden table holds the CLI and the server to one rule; init --force prints the role-password warning; checkOutPath resolves symlinks; the win32 owner-only ACL runs icacls best effort. The README note for init --force is for the R5 docs owner.


## R2

Branch `wave-m/fix-r2`, from `2afeed2`. Scope: the sovereign MCP store, the migrations, and the
migration ledger.

### Done

- Budget lock: `pg-budget.ts` locks the budget row before accrual, so concurrent reserves cannot
  overspend. Unit test in `pg-budget.test.ts`; IT case in `test/it/pg-stores.it.test.ts`.
- Sleep mark table: migration 0003 moves the sleep mark to `mcp_sleep_marks` and grants `agents`
  by column (no UPDATE, no `last_sleep_day`). Tests in `pg-agents.test.ts`, `migrate.test.ts`
  and the IT file.
- Journal index and trim: migration 0003 adds `mcp_journal_life_id_idx`; each append keeps 1000
  lines per life; NUL bytes are dropped before insert. Tests in `pg-journal.test.ts` and the IT
  file.
- Token catch-up and epoch: after a LISTEN reconnect the store catches up revocations and stops a
  stale cache write. Test in `pg-tokens.test.ts`.
- SCRAM: `geldar_mcp` gets a SCRAM verifier, not the plain password. Tests in `scram.test.ts` and
  `role-password.test.ts`.
- Ledger rule: every migration inserts its own `schema_migrations` row (`sql/README.md`).
  `tools/migrate/src/ledger.test.ts` checks every `sql/NNNN_*.sql`; 0001 is exempt because it
  predates the ledger. `sql/test/check-schema.sql` checks that the ledger holds 0001 to 0003.

### Left or known

- Rotation expiry without revoke does not end sessions (low).
- Refund has no reservation id. This is a documented limit.
- Over-length journal lines still throw `RangeError` (over 4000 characters).
- Integration cases owed to ops: the only IT file changed in R2 is
  `threshold/mcp/test/it/pg-stores.it.test.ts`. It is skipped unless `GELDAR_IT=1` and needs the
  MCP stack and Postgres. Run it with the stack up (`./geldar.ps1 mcp up`):
  `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm --dir threshold/mcp exec vitest run test/it`.
- Request for R1 `main.ts`: none needed. `PgAgentStore` kept its constructor.


## R3a

The contract has no outcome-unknown code. When an `act` call's `submitPlan` times out after the
Body may have received the plan, the reserve is refunded and the call is reported with the closest
existing code. The plan may still run. This is a known low-severity gap: the player is told the
plan was refused while the Body may act on it. Closing it needs a contract code for an unknown
outcome, which is out of scope for this packet.


## R3b

### (a) For R3a: `threshold/mcp/src/tools/wait.ts`

A cursor above `head` must be clamped to `head`, and the gap reported in `dropped_events`, instead of refused as `bad_cursor`.

Today `wait.ts:99-103` takes `head` from the life's own events only (`log.head(lifeId)`). After a restart, a player whose newest event is older than the 60-minute replay window has `head` 0, so its stored cursor is refused with `bad_cursor`. The player then cannot resume, although its events exist on the stream.

### (b) For the event log in `threshold/mcp/src/main.ts`

`main.ts:176` builds `new RingEventLog()` (from `threshold/mcp/src/events/player-log.ts`) with no backfill. A cursor older than the 1000 events the ring keeps only counts as dropped; the log cannot replay those events to the player.

### (c) The replay catch-up bound

The replay catch-up bound is the constant `REPLAY_CATCHUP_MS = 30000` in `threshold/mcp/src/cli.ts:206`. It has no config key. A change to it is a code change, not a shard setting.


## R4

- journal quota (per-player rate/size cap in tools/journal.ts) is a request to the tools owner: 60 calls/min x 4000 chars is about 240 KB/min.
- wantBody is redundant with touch: both write the same record (awake, desired_body up, stamped now), so the bound-call path could drop the wantBody call.


## R5c

1. **Live cases (f) and (g): wire the test-player guard.** `threshold/mcp/test/live/guards.ts` exports
   `assertTestPlayer(playerId)`, which throws unless the id starts with `ag-test-`. The owner of
   `threshold/mcp/test/live/revoke-kill-hibernate.live.test.ts` (R5b) should call it on the player id the operator
   puts in env, before either case acts on that player.
2. **`players logs` reads the whole file.** `tools/players-cli/src/rangers-cli.ts` (the `logs` verb, about line 146)
   reads each ranger log with `readFileSync` and keeps the last 200 lines. It should read only the last N KB
   (for example 256 KB) and cut to whole lines, with a test. That file is in the rangers block owned by R5b.
3. **Ranger logs grow without rotation.** The supervisor in the rangers code should rename a log to `<name>.1` when
   it passes a size cap (for example 10 MB) and reopen the file, so a long run cannot fill the disk. It belongs to the
   rangers owner (R5b), because the supervisor lives in the files R5b is changing.
