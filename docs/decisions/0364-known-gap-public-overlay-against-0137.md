# 0364. Known gap: the public overlay against decision 0137, recorded and not fixed

- Status: Proposed (owner to accept)
- Date: 2026-11-16
- Spec: 8.4 (human identity: watchers and ghosts). Decisions 0137 (Accepted), 0096 (Proposed) and 0361 (Proposed).
- Source: an owner ruling, given to the documentation writer in its brief of 2026-11-16. No other repo record holds it. This record writes it down. It does not make it. Repo evidence was read at 03c1f5de. Nothing was read on the node.

## Decision

The item below is a known gap. It is not fixed now: development is frozen. Following [0361](0361-agents-never-placement-and-public-detail.md), this record names the gap and its policy, not its mechanism.

### The public overlay against decision 0137

- **The design.** Decision [0137](0137-public-spectator-proxy-is-separate-and-online.md) is the authoritative design and stays so. Under it, the offline-mode bot ingress is never published. A separate online-mode spectator proxy is the only service in `compose/colo-public.yml` (0137, point 1).
- **The repo.** The repo does not match. `compose/colo-public.yml` lines 6 to 9 publish the `velocity` service, which is the bot ingress (`compose/velocity/velocity.toml`, line 1). No spectator proxy service exists in `compose/colo.yml`.
- **The earlier decision.** Decision [0096](0096-public-topology-as-built.md) (Proposed) describes this overlay as built, publishing `velocity` (point 5). Its commit came before 0137's, on the same day (54a845eb, then 08eeb900). Packet C2-02c would build the proxy, and it has not merged.
- **The stop rule.** `docs/analysis/phase1/RESUME.md` line 22 already holds it: do not set the overlay's two variables on the node until C2-02c merges.
- **The node.** Node state is unchecked (plan decision D8: no node reads).

## Why

- The owner ruled that the gap is to be recorded as known and not fixed during the freeze.
- The code and the decision disagree. Writing both down keeps the disagreement visible instead of settling it silently (persona rule 8). The spec is not edited; a record states the gap ([0073](0073-spec-is-never-edited.md), point 2).

## Consequences

- 0137 is not superseded. 0096 is not changed.
- The gap closes with a later record that cites the merged C2-02c fix. Until then, the RESUME stop rule holds.
- Documents that describe the public overlay cite this record in one line and do not restate the gap. This record and the Phase 1 RESUME are the only places that describe it.
- Revised on 2026-11-16 in the closing pass of the documentation library (W7): retitled and renamed.
