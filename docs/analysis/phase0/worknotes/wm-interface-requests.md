# Wave M interface requests

Notes from the Wave M packets, for the packets and hosts that follow them.

## WM-08 (player host: whitelist, presence, Body)

(a) Latent bug in the Adam host. `golem/src/adam/main.ts` `BodySupervisor` only listens for stop after start has begun, so a stop issued during start hangs until the bot ends. The player session (`golem/src/players/session.ts`) works around it. Follow-up for the Adam host: listen for stop from the beginning of start, the same way the player session does.

(b) `golem/src/players/main.ts` opens `PRESENCE_BUCKET` with `open`, and fails if the MCP has not created it. WM-11 must create the bucket first, so that the player host can open it on a fresh stack.

(c) No test covers the `extraServe` path of `startPlayerBody`. It needs a live case later, against a running stack.
