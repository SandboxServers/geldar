# 0029. RCON replies end on a quiet period, not an empty packet

- Status: Accepted
- Date: 2026-11-09
- Spec: section 5.1 (RCON for ops tooling only); packet P0-07a

## Decision

`golem/src/rcon.ts` reads a command's reply as the burst of packets that share its request id, and treats the reply as complete when no packet has arrived for 100 ms. It does not send the empty "terminator" request that the common Source RCON trick uses.

## Why

The live Paper 26.1.2 server closes the connection when it receives an empty type-0 request, so the terminator trick cannot work. Replies are matched by request id, so late packets from another command cannot be mixed into this one.

## Consequences

- Each command costs about 110 ms. Test control is not on any hot path.
- `stop` loses its reply because the server drops the connection first; callers treat that as success.
- RCON stays test and ops control only: nothing under `golem/src/actions/` may import it.
