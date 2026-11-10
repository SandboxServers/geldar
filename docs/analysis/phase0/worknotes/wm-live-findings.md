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
- Open: a bare flag through the pass-through (`./geldar.ps1 pnpm -v`) now reaches pnpm and fails with
  `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`. At HEAD it printed nothing. Not fixed in L3.
- Open: `Get-Help` does not read the comment block at the top of `geldar.ps1` in this environment. The
  no-argument usage now prints only the script name (before the fix it printed the syntax line).

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
