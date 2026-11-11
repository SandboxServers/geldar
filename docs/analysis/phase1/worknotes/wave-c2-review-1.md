# Wave C2 review, round 1

Reviews run on `main` after C2-00 to C2-06 merged. Each reviewer's full report is kept in the orchestrator's local reports (`.claude/reports/phase1/C2-R<n>-review-1.md`). This file records the findings and who owns each one.

## C2-R3 Glass and BlueMap: verdict fix (3 high, 8 medium, 5 low)

| Finding | Severity | Summary | Owner |
|---|---|---|---|
| R3-01 | high | `/api/agents` lists living sovereign agents while the filter is on | fix slice A1 |
| R3-02 | high | `/api/thoughts/:id` returns `model_input`, which carries coordinates, inventory and nearby speech | orchestrator ruling R21 (hide), then fix slice A1 |
| R3-03 | high | Caddy forwards the public Host, so Glass answers 421 to everything | fix slice B |
| R3-04 | medium | The Glass Caddy site doesn't route the page or its assets | fix slice B |
| R3-05 | medium | `/api/stats` shows the viewer count publicly | fix slice A1 (route); fix slice B (README) |
| R3-06 | medium | No per-client SSE cap, and a stalled reader holds a slot | fix slice A2 |
| R3-07 | medium | The trusted-proxy list is empty and undocumented, so all visitors share one bucket | fix slice B (README); C2-07 live step |
| R3-08 | medium | IPv6 /64 rotation bypasses the rate limit | fix slice A2 |
| R3-09 | medium | The delay and sovereign SQL is tested by text; the IT runs Glass with the filters off | fix slice A1 |
| R3-10 | medium | The `limit` bound has no test | fix slice A2 |
| R3-11 | medium | BlueMap has no response headers; its live player markers may show sovereign positions | fix slice B (headers); C2-07 live step (markers off, proven) |
| R3-12 | low | Glass gives 405 on HEAD | fix slice A2 (allow HEAD); fix slice B (docs) |
| R3-13 | low | Receipts have no delay | fix slice A1 |
| R3-14 | low | The kill switch is read only at start | fix slice B (README: the fast switch is `glass-off.caddy`) |
| R3-15 | low | Slow headers and bodies rely on Node defaults | fix slice A2 |
| R3-16 | low | README and CI claims; the header-set order is not validated against a real Caddy | fix slice B |

The slices touch separate files. B covers `deploy/caddy`, `glass/README.md` and the snippet tests. A1 covers `glass/src/query.ts`, the visibility parts of `http.ts`, and the IT. A2 covers `guard.ts`, `sse.ts`, `server.ts`, and the limit and HEAD parts of `http.ts`. A1 and A2 start after C2-07a3 merges, because it edits `glass/src/config.ts` and the Host check.

## C2-R1 MCP public endpoint

Pending.
