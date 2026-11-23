# 0433. Who rules on what, and test-shard waivers

- Status: Proposed (awaits the owner and the co-owner)
- Date: 2026-11-23
- Spec: no spec section; decision-only. Related: 0392 and 0426 (existing waivers), 0431 (corrections to 0391 to 0393)

## Decision

1. The owner rules on: product scope and spec departures, world rules (building, protection), the kit's player-facing behaviour, hosts and the roster.
2. The co-owner rules on: deploy windows and merges to deploy paths (the release owner), release gates and tags, switching on an already-merged feature, rollout order.
3. Both rule on: the validation policy, waivers, and one-way doors.
4. Default: a change to agent behaviour goes live only after test-shard evidence. A waiver is a decision record naming the feature, the evidence that replaces the test shard, and the kill switch. The existing waivers are 0392 and 0426.
5. A one-way door (immutable or append-only state, deleting agent data, world changes with no restore) needs an Accepted decision from both.

## Why

Several rulings in the last weeks were recorded under the wrong role, or were assumed and later found to be one-way. A short split of who rules on what, and a rule that a waiver is a written record, stops that.

## Consequences

- A review checks the role of the ruling against this list.
- The one-way-door repo check and the pull request template line enforce item 5 for sql/ triggers.
