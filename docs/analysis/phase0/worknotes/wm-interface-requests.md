# Wave M interface requests

Requests from a Wave M packet to a packet that owns the shared interface. Each section names the packet that raised the request.

## WM-04

(a) `PresenceStore` needs `touch(playerId)`. The `wait` tool calls it when the wait opens, on each poll, and when it closes. Until the store has it, `wait` takes `touchPresence` as an optional dependency and leaves it out. WM-11 owns the WM-01 ports, so WM-11 adds the method.

(b) `threshold/mcp-mock` should export `present.ts` from its index. WM-04 carries a copy at `threshold/mcp/src/events/present.ts` so the MCP package can build the presence view without the mock's index. Once the mock exports it, the copy can be removed.

(c) The event texts `You slept.`, `You died and woke at spawn.` and `Your actions finished: N done, M failed` are not defined by the packet or the mock. None were added. Whoever owns the event wording should decide them.
