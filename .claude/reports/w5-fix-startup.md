# w5-fix-startup progress

Findings 1, 2, 5 (animus), commit 1b819a0:
- Loss proven before the fix by a Mind test over the fakes (Body failing with `unavailable` at start): the loop's one `requestSnapshot` threw `BodyLinkError`, the cycle returned `fallback_hold` with `skipped: 'snapshot_unavailable'`, and nothing was written (no thought, no suppressed row, no event, no log). The hypothesis in the note held.
- Fix: `ThinkingLoop.snapshotWithRetry` (250 ms doubling to 5 s, budget `mind.snapshot_retry_s`, default 60) for every wake; on giving up a `suppressed_wakeups` row with reason `snapshot_unavailable` (new `SuppressionReason`).
- `no_thinker`: `callWaitingForThinker` waits `mind.thinker_wait_s` (default 20) through `awaitThinker` (hub `waitForThinker`) and retries once; the error code goes to `provider_usage` (`{error_code, source: 'error'}`) and to the `thought_outcome` log line.
- Hub: `onThinker` callback, `waitForThinker`; `main.ts` logs `thinker_connected` / `thinker_disconnected` with model names.
- Interfaces changed: `AnimusConfig.mind`, `LoopOptions.snapshotRetryMs/thinkerWaitMs`, `LoopDeps.sleep/awaitThinker/log`, `MindDeps.sleep/awaitThinker/log`, `HubResource.waitForThinker`, `SessionContext.onWelcomed`, `SuppressionReason`, `ThoughtRowInput.errorCode`.

Findings 3, 6 (lantern-local), commit 017e733: backoff 250 ms to 5 s with jitter, logs for connect, hello, welcome, close (code, reason); a refused connection raises `error` with no `close` on Node 22, so the old code never reconnected: the attempt now ends on `error` too. `ollama.it.test.ts` timeout 180 s.

Finding 4 (golem live stack): start order Body, animus, lantern-local, then wait for animus `thinker_connected` (`ProcessSpec.then`).
