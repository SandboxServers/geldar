# 0364. Known gaps against decision 0137 and spec 8.4, recorded and not fixed

- Status: Proposed (owner to accept)
- Date: 2026-11-16
- Spec: 8.4 (human identity: watchers and ghosts). Decisions 0137 (Accepted), 0096 (Proposed) and 0361 (Proposed).
- Source: two owner rulings, relayed by the Phase 1 coordinator to the documentation writer in its brief of 2026-11-16. No other repo record holds them. This record writes them down. It does not make them. Repo evidence was read at 03c1f5de. Nothing was read on the node.

## Decision

Both items below are known gaps. Neither is fixed now: development is frozen. Following [0361](0361-agents-never-placement-and-public-detail.md), this record names each gap and its policy, not its mechanism.

### Gap 1: the public overlay against decision 0137

- **The design.** Decision [0137](0137-public-spectator-proxy-is-separate-and-online.md) is the authoritative design and stays so. Under it, the offline-mode bot ingress is never published. A separate online-mode spectator proxy is the only service in `compose/colo-public.yml` (0137, point 1).
- **The repo.** The repo does not match. `compose/colo-public.yml` lines 6 to 9 publish the `velocity` service. In `compose/colo.yml` (line 156 on), that service mounts `compose/velocity/velocity.toml`, which calls itself the bot ingress (line 1) and sets `online-mode = false` (line 9). No spectator proxy service exists in `compose/colo.yml`.
- **The earlier decision.** Decision [0096](0096-public-topology-as-built.md) (Proposed) describes this overlay as built, publishing `velocity` (point 5). Its commit came before 0137's, on the same day (54a845eb, then 08eeb900). Packet C2-02c would build the proxy, and it has not merged.
- **The stop rule.** `docs/analysis/phase1/RESUME.md` line 22 already holds it: do not set the overlay's two variables on the node until C2-02c merges.
- **The node.** Node state is unchecked (plan decision D8: no node reads).

### Gap 2: a ghost measure against spec 8.4

- **The gap.** A ghost measure described in spec 8.4 is not implemented in the plugin at 03c1f5de; a plugin-side fix is planned after the freeze (owner ruling relayed 2026-11-16).
- **Scope.** Any further detail is withheld under 0361.

## Why

- The owner ruled that both gaps are to be recorded as known and not fixed during the freeze.
- In each case the code, the spec or the decision disagree. Writing all of them down keeps the disagreement visible instead of settling it silently (persona rule 8). The spec is not edited; a record states the gap ([0073](0073-spec-is-never-edited.md), point 2).

## Consequences

- 0137 is not superseded. 0096 is not changed.
- Each gap closes with a later record that cites the merged fix: C2-02c for gap 1, and the plugin card for gap 2, which has no number yet.
- Until gap 1 closes, the RESUME stop rule holds.
- Some documents describe the public overlay, and they should cite this record. They include [compose-stacks](../reference/compose-stacks.md), [network-and-trust-zones](../architecture/network-and-trust-zones.md) and [velocity-identity-plugin](../reference/velocity-identity-plugin.md). Adding the citations is a documentation follow-up.
