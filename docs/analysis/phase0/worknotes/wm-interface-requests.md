# Wave M interface requests

Requests from a Wave M packet to a packet that owns the shared interface, and follow-ups that a packet
hands on. Each section names the packet that raised the request. The WM-04 section is on the
`wave-m/wm-04-wait` branch and is merged with the others by the orchestrator.

## WM-10

Raised by WM-10 (container, compose overlay, tunnel template, threat model). No request against a WM-01
file. Follow-ups, each for the orchestrator to schedule:

1. **WM-10b: least-privilege NATS user for the MCP.** Needs a credentials mechanism, a NATS config file
   and the `nats` block in `compose/phase0.yml`. WM-10 did not touch that block (owner decision Q6): the
   block stays as it is, and the MCP reaches NATS as any local process does until WM-10b lands. The
   subjects for the `mcp` user are: `snapshot`, `plan` and `book` bodies, `sovereign_call`, `day_night`,
   the `geldar-presence` KV bucket, the stream and consumer API for `GELDAR_EVENTS`, and `_INBOX.>`.
2. **Ops: build the image and decide `pnpm deploy`.** `threshold/mcp/Dockerfile` uses the mock's
   `pnpm install --filter` pattern, not yet built. Build it with `docker build -f threshold/mcp/Dockerfile .`
   once WM-11 adds `src/cli.ts` (the entry point), then decide whether to switch to `pnpm deploy`.
3. **Base image digest.** The Node base digest is the one `threshold/mcp-mock` pins (`node:22.23.2-trixie-slim`).
   It is not a placeholder. Re-check it at the next base-image update.
4. **Decision 0053 (owner).** The public-hostname decision is reserved, not written. `compose/mcp.yml`
   and the threat model refer to it. The tunnel stays unrun until the owner takes it.
