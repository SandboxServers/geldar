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
