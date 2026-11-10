# Wave M fix requests

Requests from fix packets that cannot make the change in their own files. Each section names the owner packet.

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
