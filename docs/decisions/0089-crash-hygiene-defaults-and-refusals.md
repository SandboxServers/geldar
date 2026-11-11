# 0089. Crash hygiene: the owner cap default, the start refusal while a name lease is held, and `players down`

- Status: Accepted (orchestrator)
- Date: 2026-11-10
- Spec: 5.15.6 (one human, many players: default cap 3 per owner per shard, raisable per person by the operator); decision 0052 (owner cap 20); decisions 0023 to 0028 (Phase 0 corrections)
- Packet: P1-C1-08 (crash hygiene)

## Decision

1. **`owner add` default cap.** Without `--cap`, the cap is read from the shard config key `sovereign.owner_cap_default` (3 in `shards/phase0.yaml`). A missing key refuses the command and names the key. There is no constant fallback. With `--cap N`, `N` may not exceed `sovereign.owner_cap_owner` (20, decision 0052). A missing `owner_cap_owner` refuses the command and names the key. The `--cap` ceiling is the owner's cap, not the default, because a flag capped at the default could never grant the owner's 20.
2. **Start refusal while a name lease is held.** A Body start for a life name is refused while the life's registry lease is in force. The lease is the registry key for the name: it lapses 60 s after its last put (`REGISTRY_TTL_MS`), and a running Body re-puts it every 20 s. The refusal names the seconds left. A registry that cannot be read refuses the start; it never counts as free. The check reads the entry's `registered_at` against an injected clock, so tests need no sleeps.
3. **Plain case.** A life id given unchanged (no prefix, no case change) gets the same lease check as every other name. A second start for a live life is refused.
4. **`players down` for a stopped life.** `players down` deletes the registry key and the whitelist entry of a life whose Body has stopped. A running Body keeps both. This was re-verified against the code and tested in P1-C1-08; the line in `docs/analysis/phase1/plan.md` that said otherwise is stale.

## Why

- A default that falls back to a constant hides a missing config key. The owner cap must be visible in the shard file that the operator edits.
- A lease that is still in force means a Body may still be writing the same journal under the same name. A second Body would split one life's rows, so the start waits for the lease to lapse (at most 60 s) instead of racing it.
- An unreadable registry is the same risk as a held one. Refusing is the safe default, and the operator can retry once NATS is back.

## Consequences

- `owner add` without a `sovereign.owner_cap_default` in the shard file fails until the key is added.
- A start shortly after a crash waits up to 60 s. The refusal names the seconds left.
- The refusal is in `checkPreconditions` (`tools/adam-run`). The step that reads the registry entry and passes it in as the lease is not wired in this packet. Until it is, the lease fact is absent and the start is not checked. The worknote lists this as open.
- The crash window (a Body killed without a delete) is covered by the lease, and its remaining gaps are in `docs/analysis/phase0/known-gaps.md`.
