# 0093. Glass hardening: defaults and the test for each 0072 item

- Status: Proposed (orchestrator, 2026-11-11; owner rulings on delay, sovereign and board recorded)
- Date: 2026-11-11
- Spec: 5.15; decisions 0071, 0072 (Glass and BlueMap are public), 0090 (client-address header)
- Packet: C2-03 (Glass hardening)

## Context

Decision 0072 lists the hardening Glass needs before it is exposed. C2-03 implements it. This record fixes the defaults and maps each item to the test that proves it.

## Defaults

- Rate limit: 60 requests per minute with a burst of 20, per client address, in a bounded table (orchestrator R15; 0090 gave no default). A refusal is 429 with `Retry-After` and a fixed body.
- Client address: the header `x-geldar-client-ip` is read only when the socket peer is in `GELDAR_GLASS_TRUSTED_PROXIES`; otherwise the socket address is charged.
- Size caps: a request target above 2048 characters gets 414; a declared body above 1024 bytes gets 413, before routing.
- Thought delay: default 60 s (`GELDAR_GLASS_DELAY_SECONDS`). OWNER 2026-11-11.
- Living sovereign agents: their thoughts and receipts are hidden by default; a dead sovereign agent and a house agent are shown. OWNER 2026-11-11 accepted the recommendation.
- Agent board: no agent-board text on Glass. OWNER 2026-11-11: none unless agents make it in-game, which would be a later decision.
- Kill switch: `GELDAR_GLASS_ENABLED`, on by default, off only for the exact value `false`.

## Item to test map

| 0072 item | Test file | Test name |
| --- | --- | --- |
| Strict CSP and security headers on every reply, errors included | glass/test/headers-errors.test.ts | `security headers on every reply` (200, 400, 404, 405, 421, 429, 500 cases); also glass/src/readonly-routes.test.ts `sends the CSP and the security headers on every reply: API, page, 404, 405, 421 and the stream` |
| Agent text escaped (rendered page) | glass/src/page-safety.test.ts | `agent text in the rendered page` |
| Agent text is data in the API reply | glass/src/page-safety.test.ts | `agent text in the API reply`; also glass/test/adversarial.test.ts and adversarial-stream.test.ts |
| No markup-from-string sinks in page sources | glass/src/page-safety.test.ts | `page sources` / `use no markup-from-string or code-from-string API` |
| Per-client rate limit | glass/src/guard-http.test.ts, glass/src/guard.test.ts | `serves the last request of the burst, then refuses with 429, Retry-After and the fixed body`; `charges a forwarded client address only when the socket peer is trusted`; `ignores the forwarded header when the peer is not in the trusted list` |
| Request size cap | glass/src/guard-http.test.ts | `serves a target of exactly 2048 characters and refuses 2049 with 414 and the headers`; `admits a declared body of 1024 bytes and refuses 1025 with 413 before routing` |
| Thought delay | glass/src/delay.test.ts | `the list cut-off is the fake clock minus the delay, and moves as the clock moves`; `a thought detail takes the same cut-off...`; `the stream feed takes the same cut-off as the API` |
| Living sovereign hidden | glass/src/sovereign.test.ts | `hides them by default`; `every statement carries the predicate, bound to %s`; `the receipts statement joins agents on the receipt life` |
| Kill switch | glass/src/kill-switch.test.ts | `every route, the page, a write and an unknown path answer 503 with the security headers`; `an open stream closes within one heartbeat of the switch going off` |
| No secret in any reply or log | glass/test/no-secrets.test.ts | `keeps the password and its file path out of every route, error and log` |
| No board on Glass | glass/test/no-board.test.ts | `serves only index.html, app.css and app.js as static files` and the 404 cases |
| Read-only database role | glass/src/readonly-routes.test.ts, glass/src/import-graph.test.ts | `sends only SELECT statements for every GET, and none for the page`; `the SQL the shipped Glass source can send` |

## Known gap

The SQL predicates for the delay and the sovereign filter are checked in unit tests by statement text and bound parameters only. The IT cases in glass/test/glass.it.test.ts (`hides the living sovereign agent by default, and shows it when the flag is on`, `the delay cut-off hides a thought newer than the cut-off`) need Postgres (`GELDAR_IT=1`) and have not run yet. They do not cover a dead sovereign or a house agent row.

## Consequences

Visitors see sovereign minds one minute late at best and never while the agent lives. The owner can change the delay or switch Glass off by config alone.
## In-network bind (C2-07a3)

Inside the Colo compose network Glass may bind `0.0.0.0` and read Postgres at the service name `postgres`, but only when `GELDAR_IN_NETWORK_HOSTS=1` is set (the pattern of decision 0131). Any other non-loopback bind and any other Postgres host except `localhost` is still refused. Without the opt-in nothing changes: loopback only. The Host check also answers the exact names listed in `GELDAR_GLASS_PUBLIC_HOSTS` (comma list, default empty, no wildcards), so Glass can be served behind Caddy; any other Host still gets 421. Status is unchanged.
