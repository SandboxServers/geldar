# 0217: The Body counts its ownership lookups and logs the counts once a minute

- Status: Proposed (implementer; owner to accept)
- Date: 2026-11-14
- Amends: nothing; the ownership rules of decision 0164 and the record of decision 0165 stay as they are

## Context

The Body's goto digging reads the CoreProtect ownership record through its own chunk cache (decision 0165). On Colo today neither the host logs nor the events table show any line for an ownership lookup, so `geldar-worldops` cannot confirm the Body gets real answers from CoreProtect: a timeout, a truncated reply and a cache hit all look the same from outside.

## Decision

The Body's ownership client (`golem/src/body/block-owners.ts`) counts what it does, in `golem/src/body/ownership-counters.ts`, and writes one top-level JSON line `ownership_lookups` at most once per 60 seconds, and only while at least one lookup or chunk query happened in the interval. The line goes to the same top-level diagnostic sink as the `stall_diag` and `hurt` lines, not into the body log's envelope. There is no per-lookup line.

Fields of the line:

- `event`: `"ownership_lookups"`; `interval_ms`: 60000.
- `total`: the counts since the Body started. `interval`: the counts since the previous line.
- Each block holds `lookups` (ownership lookups), `cache_hits` (lookups answered from a complete cached chunk), `queries` (chunk queries sent to the plugin), `answered` (complete replies), `truncated` (replies the plugin marked truncated: their cells are unknown), `unknown` (no answer: a timeout or no responder), `errors` (a reply that did not parse or broke the contract), `avg_latency_ms` and `max_latency_ms` (over the queries that ended, timeouts included, so a silent plugin pulls the average toward the timeout; null when none ended). A lookup in a dimension with no Bukkit world is answered before the counters see it, so it is not counted; the line under-reports those lookups.

## Privacy

The line carries counts only. It holds no coordinates, no block names, no owner names and no world name (decision 0145). The tests check the key sets of the line and of both blocks.

## Consequences

- An operator can read from the host logs whether CoreProtect answers, how often it is slow, and how often a Body is blind (unknown or truncated) for lack of a record.
- The lookups themselves do not change: the same answers, the same timeouts, the same protection (decision 0164). Counting adds a timer that is cleared when the client stops; the last partial minute is not flushed at stop.
- The counters are not in the Mind's view and not in the metrics endpoint; a later record may add them there.
