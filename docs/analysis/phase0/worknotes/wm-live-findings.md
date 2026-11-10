# Wave M live-run findings

## L1

Packet L1 (branch `phase0/live-1`). Scope of this pass: the 401 diagnosis and its fix, and the stream
finding. Items 1 (reasons in the 401/403 log) and the cross-implementation pepper test are not done
in this pass; see "Not done".

### The 401: most likely cause (fixed)

The minted token is written as a one-line env file: `GELDAR_MCP_TOKEN=gmcp-<64 hex>\n`
(`tools/mcp-tokens/src/tokens.ts`, `writeTokenFile`). The live reader read it with
`readFileSync(file, 'utf8').trim()` (`threshold/mcp/test/live/client.ts`, old `readTokenFile`), so the
`Authorization` header carried `Bearer GELDAR_MCP_TOKEN=gmcp-...`. The server's bearer pattern
(`threshold/mcp/src/http/auth.ts`, `BEARER`) accepts `=`, so the header parsed. The digest of that
string matches no `mcp_tokens` row, so `PgTokenStore.resolve` returned null and `verifyBearer`
returned `unauthorized`. That is the two `unauthorized` events with status 401 for ag-test-01.

Fix: `parseTokenFile` in `client.ts` takes the value after `GELDAR_MCP_TOKEN=`, ignores a BOM and
CRLF, and still accepts a bare token. Commit `e557d5e`. The test `token-file.test.ts` fails with the
reader reverted (3 of 5 fail) and passes with the fix (5 of 5).

Pepper rule (item 3, fixed): the pepper is the file bytes minus one trailing `\r?\n`; a UTF-8 BOM is refused by
`readPepper` and `pepperBytes`; the minimum is 32 bytes. The rule is now tested across implementations in
`tools/mcp-tokens/src/pepper-digest.test.ts` (CLI writer and digest against the container-ports reader; commit `4b39889`).
Each refusal and strip line was reverted in turn, and the pepper test files failed each time.

### Candidates checked

| # | Candidate | Evidence | Unit test that would catch it |
|---|-----------|----------|-------------------------------|
| a1 | Pepper bytes differ between `mcp-tokens` and the server | Both read the file as UTF-8 text and remove one trailing `\r?\n` (`secret-files.ts` `readPepper`; `main.ts` `pepperBytes`). `init` writes `hex + "\n"` (LF). Both key HMAC with the same UTF-8 bytes (`token-hash.ts`, `auth.ts` `tokenDigest`). They agree for LF and CRLF. Neither strips a BOM, so a BOM would be kept on both sides: consistent, but it should be refused (not done). | `pepper.test.ts` and `main.test.ts` test each side alone. No test runs the CLI mint and the server verify on the same bytes. This is the cross-implementation test still to add. |
| a2 | Token string has a prefix or trailing text | Minted value is `gmcp-` plus 64 hex (`token-hash.ts` `mintToken`). The file has no trailing text other than `\n`. | `tokens.test.ts` |
| b | Live reader keeps `GELDAR_MCP_TOKEN=` (the cause above) | `client.ts` old `readTokenFile`: `.trim()` only. | None before this fix. Now `token-file.test.ts`. |
| b2 | BOM or CRLF from PowerShell redirection | The CLI writes with Node `writeFile`, so the file is UTF-8, no BOM, LF. A file written by hand with `>` in Windows PowerShell 5.1 could be UTF-16 or carry a BOM; the new reader strips a BOM but not UTF-16. | Covered in `token-file.test.ts` for BOM and CRLF. |
| c | `/p/<player>` id versus minted id | The URL uses `TEST_PLAYER = 'ag-test-01'`, the same string as the `player_id` the brief names. A mismatch gives `forbidden` (403), not 401, so it does not explain the 401. | `front-address.test.ts`, `front.test.ts` |
| d | `wx` write and printing | `writeOwnerOnly(..., 'wx')` fails if the file exists and never prints the value. Not a 401 cause. | `secret-files.test.ts`, `cli.it.test.ts` |
| e1 | Expiry clock | `expires_at` is set from Postgres `now()` plus 30 days (`issue`). The server compares `expires_at.getTime() <= Date.now()` (`pg-tokens.ts` `activeToken`). Same host clock, so no skew. A 401 from expiry would need a wrong clock; check `date` in the container if it recurs. | `pg-tokens.test.ts` |
| e2 | Harness or player status | `activeToken` refuses a harness the config does not list as `true`, and a player whose status is not `active`. `shards/phase0.yaml` lists `claude: { enabled: true }`. The container reads the shard file it mounts; ops must confirm that mount is `shards/phase0.yaml` and not a stale copy. | `pg-tokens.test.ts` (harness cases) |

### Stream: `StreamNotFoundError: stream not found` at startup

- The stream name is correct: the MCP reads `GELDAR_EVENTS` (`threshold/mcp/src/cli.ts`
  `jetStreamReplay`, `jsm.consumers.add('GELDAR_EVENTS', ...)`, then `js.consumers.get`).
- Creators of `GELDAR_EVENTS`: eventsink (`eventsink/src/consumer.ts` `ensureStream`, `streams.add`
  when missing) and the Geldar-Core plugin (`docs/decisions/0041-event-export-stream-and-sink.md`:
  the plugin ensures the stream and re-ensures it after reconnect). The MCP does not create it.
- So `GELDAR_EVENTS` legitimately may not exist until eventsink or the plugin has started. A
  `consumers.add` against a missing stream throws the stream-not-found error. This is the replay
  path (`startReplay` -> `source.open`), which is not `settle_error`.
- `settle_error` is a different path. `world.ts` `startSettle` calls `deps.presence.lifeIds()` and
  `deps.presence.settle(lifeId)`. Neither touches `GELDAR_EVENTS` in the code read here: presence is
  a NATS key-value bucket (`cli.ts` `kvm.open` / `kvm.create`, `presence.ts` `openPresenceBucket`).
  A KV bucket is backed by a stream named `KV_<bucket>`. So a `StreamNotFoundError` from settle most
  likely means the presence bucket's backing stream is missing, not `GELDAR_EVENTS`. Not verified:
  `presence.ts` `openPresenceBucket` was not read in this pass.
- Recommended fix (not done): (1) confirm with `nats stream ls` which stream is missing; (2) if it is
  `KV_<presence bucket>`, the MCP should create the bucket idempotently at startup (`kvm.create` with
  the existing bucket config, the way `presence.ts` already does); (3) if it is `GELDAR_EVENTS` during
  replay, tolerate it: retry `source.open` with backoff, log once at info, and do not exit.

### Not done in this pass

- Item 1: `reason` on `unauthorized`/`forbidden`. The 401/403 event is emitted by
  `threshold/mcp-mock/src/server.ts` (around lines 350-357), not by `http/front.ts`. Adding the
  reason needs a change there (the `AuthDecision` must carry it) and a change to `pg-tokens.ts`
  (`resolve` must say why it returned null). Neither is done.
- Pepper BOM refusal and the cross-implementation test (mint with the CLI, verify with the server on
  the same bytes, pepper with CRLF and with BOM). Not added.
- Stream: the code change in the stream finding above. Not done; needs `nats stream ls` output first.

### What ops must re-run

- `./geldar.ps1 mcp smoke` against the existing token for ag-test-01. No re-mint is needed: the
  token file is correct, only the reader was wrong. If the smoke still returns 401, the next suspect
  is e2 (the container's mounted shard file).

## L2

### The act intent had no limits (fixed)

- Finding: the live stub-client case sent an `act` intent without `limits`. The contract requires
  `limits.max_world_ticks` and `limits.max_block_operations` on every intent
  (`contract/schemas/thought.schema.json`, Intent), so the act was refused and the case could not
  reach its wait.
- The player-facing `act` description did not say that `limits` is required. A model reading it
  had no way to know.
- The MCP does not default `limits`. It refuses the intent, so the fix belongs in the client's
  request and in the description, not in a server-side default.

### Fixes

- `contract/schemas/mcp-play.schema.json`: the `act` description now says an intent must carry
  `limits`, and ends with a minimal valid intent that shows both fields. The first version was 487
  characters and broke the 300-character cap that `contract/test/mcp-world.test.ts` applies to every
  input description, so it was shortened to 293 characters and the bounds were left out of the text
  (the example carries the fields). The generated copies are regenerated. `act-description.test.ts`
  checks the example against the validator and fails when `limits` is dropped.
- `threshold/mcp/test/live/live-requests.ts`: the case's look, act and wait bodies are built in one
  place. The act intent carries `limits` (max_world_ticks 2400, max_block_operations 64).
  `live-requests.test.ts` checks every body against the contract validator and the Mind output
  validator, and refuses an act without `limits`.
- `stub-client.live.test.ts`: `WAIT_STEPS` rises from 4 to 8. 2400 world ticks is about two minutes,
  so an intent that runs to its limit ends as `intent_run_too_long` inside the case's waits.

### What ops must re-run

- `./geldar.ps1 mcp smoke`. The case now takes up to about 200 s (8 waits of 25 s), not about 100 s.
  A run that ends `intent_run_too_long` is a pass: the limit was reached and reported.

## L1c

Two fixes in threshold/mcp: the presence bucket is created before it is used, and a missing GELDAR_EVENTS stream is waited for.

### Presence bucket: `settle_error` with a stream error

- Root cause: the MCP called `kvm.open` on the presence bucket. `Kvm.open` binds a name to a handle and never checks that the backing stream exists, so the first settle failed when the bucket had not been created yet.
- Fix (commit 0d6988f): `openPresenceBucket` (`threshold/mcp/src/presence.ts`) calls `kvm.create`, which creates the bucket when it is missing.
- No history or TTL option is set anywhere in the repo for this bucket (checked by search, outside docs). The player host and `create` therefore share the default options.
- `Kvm.create` does not compare options. A bucket that already exists with different options is used as found, and nothing is logged.

### GELDAR_EVENTS: waited for, not created

- `GELDAR_EVENTS` is created by eventsink (`ensureStream` in `eventsink/src/consumer.ts`) and by the Geldar-Core plugin (decision 0041). The MCP does not create it.
- `untilStreamExists` (`threshold/mcp/src/replay-source.ts`) waits for it: 1 s doubling to 30 s between tries, one waiting line at most a minute, and `StreamWaitTimeout` after 5 minutes. `reopenOrExit` (`threshold/mcp/src/cli.ts`) exits 1 on that timeout and does not count it toward the five failures.

### What ops re-runs

1. Rebuild the MCP image (the change is in `threshold/mcp/src`).
2. Mint a fresh token. The token file is an env line, so write the new token into it.
3. `./geldar.ps1 mcp smoke`.
4. Confirm the startup log has no `settle_error` line.

## L3

### Hibernated start: `players up` alone leaves no Body

- After a run, the settle moves the presence record to hibernating or down. The player host obeys the
  record, so `./geldar.ps1 players up` alone starts no Body.
- The designed wake is the first MCP call. The live case now has a wake phase
  (`threshold/mcp/test/live/live-wake.ts`) that brings the Body up before the scenario, and fails with
  a pointer to `players logs` and `players status` if it does not.

### PowerShell binder: `--out` (fixed)

- Finding: `geldar.ps1` had a `[CmdletBinding()]` param block. PowerShell read `--out` as an ambiguous
  prefix of `-OutVariable` and `-OutBuffer`, so `mcp-tokens token mint ... --out <file>` failed before
  the CLI ran.
- Fix (commit `13da18f`): the script has no param block. `$Command` and `$Rest` are read from `$args`,
  with the same meaning for every command. The guard is `threshold/mcp/src/geldar-script.test.ts`; it
  also runs the script under pwsh when pwsh exists and checks that the CLI's own error comes back.
- Bare flags through the pass-through, measured with `pwsh -File` (exit code, first output line). On
  origin/main, then on this branch:
  - `pnpm -v`: main exit 2, prints the script's help text; branch exit 0, prints the pnpm version.
  - `pnpm exec node -e 1`: main exit 1, `parameter 'e' is ambiguous`; branch exit 0.
  - `pnpm -C threshold/mcp exec tsc --noEmit`: main exit 0 but runs nothing (prints the help text); branch
    runs tsc and exits 0.
  - `pnpm --filter @geldar/mcp exec vitest run`: exit 0 on both.
  No form that worked on main fails on the branch. Not covered: forms outside these four.
- Fixed: the no-argument usage. `geldar.ps1` now prints its usage from `Show-Usage` (commit `b658744`) with
  `help`, `-h` and `--help`; an unknown command prints an error, the usage, and exits 2. The guard checks
  that the usage names every case of the dispatch switch.

### Leftover tokens policy

- Not decided. The brief named a policy, but no rule was given and none exists in the repo.
- Proposed for ops to confirm: each smoke run mints one token into a file outside the repo. At cleanup,
  revoke that token with the mcp-tokens CLI and delete the file. Do not leave a token minted for a test
  in use.

### What ops runs next

1. Mint a token: `./geldar.ps1 mcp-tokens token mint ag-test-01 --out <file outside the repo>`. The
   wrapper now passes `--out` through.
2. `./geldar.ps1 mcp up`.
3. `./geldar.ps1 players up --player ag-test-01`. Do not wait for the Body to join.
4. `./geldar.ps1 mcp smoke`. Its wake phase brings the Body up; allow up to 120 s.
5. The negative HTTP checks.
6. Cleanup, per the leftover tokens policy above.

## L4

### Evidence from the live run

- The intent `gather_oak_log`, count 12, ended `failed` at `max_world_ticks` with zero actions. The Body
  did nothing for its whole limit.
- The MCP consumer delivered 7 messages to the player. The live case waited for an end and none reached
  it as a terminal wake.
- The per-wait output of that run was not saved, so the exact cursor sequence is not on record. The
  mechanism below is the one the fix commit (`697f555`) names: a wait whose cursor was past the failure saw
  only the limit wake, which mapped to no player event, so it timed out.

### Trace: Mind event to wait to live case, before and after (`697f555`)

| Mind event | Mapper before (`cfbaa0b`) | Wait result before | Mapper after (`697f555`) | Wait result after | Live case reaction |
| --- | --- | --- | --- | --- | --- |
| intent terminal `failed`, detail `max_world_ticks reached` | intent_finished `failed` | wake `precondition_failed` (the reason for any failure) | intent_finished `limit_reached` | wake `intent_run_too_long` | before: a `precondition_failed` wake ended the case only if a wait saw it; after: the end is named for its limit |
| wake `limit_reached` for the same intent | no event | none: the wait times out | no second event (deduped by `lastEndedId`) | none | nothing to end on; the terminal event already ended the run |
| intent terminal `completed` | intent_finished `completed` | wake `goal_completed` | unchanged | `goal_completed` | ends the case |
| intent terminal `failed`, other detail (e.g. `no oak_log within reach`) | intent_finished `failed` | `precondition_failed` | unchanged | `precondition_failed` | ends the case |
| intent terminal `cancelled` or `interrupted` | intent_finished `failed` | `precondition_failed` | unchanged | `precondition_failed` | ends the case |
| a second terminal event for an intent already ended | intent_finished again | a second end | dropped (`lastEndedId`) | one end | one end |

The live case's end check (`stub-client.live.test.ts`) accepts exactly the contract's terminal wake reasons:
`goal_completed`, `precondition_failed`, `intent_run_too_long`. Those lists were already in place at
`697f555`, so this packet changed what the case prints on failure (`live-trace.ts`, commit `dbf76c0`), not
what it accepts. A run that stops at the limit is a pass: it ended, and the wake says why.

### Where the end was lost

- The Body's failure at its limit was reported as a plain failure, so the wake named `precondition_failed`
  for an intent that had run out of ticks. The contract's reason for a limit is `intent_run_too_long`.
- The Body's limit wake (`limit_reached`) mapped to no player event. A wait from a cursor after the failure
  had nothing to return, and the case timed out at its bound.

### Deviation: cancelled and interrupted have no contract wake reason

- The contract's wake list (`contract/schemas/mcp-common.schema.json`, `wake_reason`) has no reason for a
  cancelled or interrupted intent. Both wake as `precondition_failed`, so the agent hears that its intent is
  over, but not why it stopped.
- Extending the closed list needs a decision record. Follow-up: write the record before any change to the
  contract enum.

### Open: the Body's `gather` did nothing at spawn

- The Body's `gather` made zero actions in 2260 ticks at spawn (19.5, 79, 85.5), then ran to its limit.
- Open question for a later packet: is there an oak tree within the Body's perception range from that
  spot? If not, should `gather` end at once with a failed precondition (`no oak_log in range`) instead of
  idling to `max_world_ticks`? That needs the Body's perception radius and a look at its precondition checks.

### What ops must re-run

- `./geldar.ps1 mcp smoke`, after the image is rebuilt from `threshold/mcp/src` (the mapper change is in
  `697f555`). A run that ends `intent_run_too_long` or `precondition_failed` is a pass. The trace of each
  wait is printed on failure.

## L5

### Smoke 6: the failed act and the eight `none` waits

- The act intent was accepted at 09:33:04.88 and failed at 09:33:11.35 with detail `blocked: No path to the
  goal!`. The Body then woke the Mind with reason `action_failed` for the same intent. The MCP replay consumer
  acked every event (0 pending), and the mapper turns the failed intent into `intent_finished` with outcome
  `failed`, which wakes a wait as `precondition_failed`.
- The live case still traced `wake_reason none; no events` for all 8 waits.

### Cause: the live client read a field the server never sends (fixed)

- The mock registry (`threshold/mcp-mock/src/registry.ts`) returns each tool result as one JSON text part,
  `content: [{ type: 'text', text }]`. Nothing in the repo sets `structuredContent`. The live client read
  `waited.structuredContent`, so it was always undefined, and the trace printed `none` with no events
  whatever the wait returned.
- `structuredOf` (`threshold/mcp/test/live/client.ts`) now reads the JSON of the text part when there is no
  structured content, and the stub case uses it. The `wake-corpus` and `revoke-kill-hibernate` live cases use
  the same helper and were reading `{}` as well, so they now see the real result.
- `threshold/mcp/test/live/structured-of.test.ts` feeds the failed-act pair
  (`threshold/mcp/test/fixtures/real-body-action-failed.json`) through the stream, the mapper and `wait`, then
  reads the result the way the registry sends it. Without the client fix it fails (`wake_reason` undefined);
  with the text read mutated it fails the same way. Both checks ran before the commit.

### Not the cause: `action_failed`, the cursor, the mapper

- `action_failed` is in the Body wake schema (`contract/schemas/wake-event.schema.json`). `mapWake` maps it to no
  player event, which is correct: the failed intent's own terminal event carries the end. It is not in the
  MCP `McpWakeReason` list and does not need to be: a failed intent wakes as `precondition_failed`
  (`finishReason` in `threshold/mcp-mock/src/sim/wake.ts`).
- The wait reads from the caller's cursor. Replayed from cursor 0, the failed intent comes back as an
  `intent_finished` event with the `precondition_failed` wake. No cursor fault was found.

### Deviation: the fixture pair is reconstructed

- The state, detail, reason and times are the smoke 6 values recorded in this packet. The ids, ticks and the
  envelope are test ids that satisfy the contract patterns. The live rows were not copied, so the fixture
  proves the path, not the exact live bytes.

### What ops must capture on the next live run

1. The events rows for the failed act: `source_event_id`, `intent_id`, `tick`, `world_tick`, the exact payloads
   of the `intent` (failed) and `wake` (`action_failed`) rows, and their `at` values. Replace the test ids in
   `real-body-action-failed.json` with them, in a separate commit.
2. The `content` text of the 8 wait results of that run, or the new trace. This confirms each wait's
   `wake_reason` is read and shows whether any wait saw the failure.

### What ops must re-run

- `./geldar.ps1 mcp smoke`, after the image is rebuilt from this branch. A run that ends `precondition_failed`
  or `intent_run_too_long` is a pass, and the trace now prints each wait's reason.