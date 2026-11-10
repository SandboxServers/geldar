# Known gaps: the Phase 1 backlog

Status as of 2026-11-10, branch `phase0/integration` (head `83b0922`). This is the one list of what Phase 0 left open. Each item has a pointer (a file, a decision or a worknote) and a size guess: S (under a day), M (a few days), L (a packet of its own or more, or needs the owner).

Sources: the fix rounds A to F and the W6 packets (worknotes), decisions [0053](../../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md) to [0068](../../decisions/0068-prompt-v4-and-agent-visible-text.md), and the run notes [adam-run-owner-decisions.md](adam-run-owner-decisions.md).

## Admission and identity

| Gap | Pointer | Size |
|---|---|---|
| The NATS auth overlay is untested against a live `nats-server`. The JetStream API, KV and plan/book permission lists may need changes once a server rejects a call. Verify first. | `compose/nats-auth.yml`, [0067](../../decisions/0067-nats-accounts-and-least-privilege.md), [fix-a2](worknotes/fix-a2.md) | S |
| Component credential reads (golem, animus, eventsink, MCP, the Java publisher and the Velocity client), and their connect tests, are not done. | [fix-a2](worknotes/fix-a2.md) | M |
| A hard-killed or crashed Body keeps its life name admissible for up to 60 s (lease in `LifeRegistry`). `players down` and `adam stop` do not yet delete the registry key or the Paper whitelist entry. `removeRegistryKey` deletes by the lowercase name, which needs a check. | [fix-a1](worknotes/fix-a1.md) | S |
| `owner add` does not apply `owner_cap_owner = 20` unless `--cap 20` is given. The yaml names no owner slug, so the default is not read from it. | [fix-b](worknotes/fix-b.md) item 5, [0052](../../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) | S |
| The owner cap is 3 in spec 5.15.6 and 20 in decision 0052. Owner decision; the spec edit is for the owner. | [0052](../../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md), `docs/spec.md` 5.15.6 | S (owner) |
| Public MCP topology is an owner decision: reverse tunnel, or the shard on the colo. The trusted-proxies value and the client header (`x-geldar-client-ip`) follow from it. | [0053](../../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md), [fix-b](worknotes/fix-b.md) item 1 | M (owner) |
| The unauthenticated path costs a global peek and a second query per request. No negative cache yet. | [fix-b](worknotes/fix-b.md) item 2 (todo) | M |
| Dead config keys are only partly wired (`shard/rules` shows effective values; the others were not reviewed). | [fix-b](worknotes/fix-b.md) item 4 (partial) | S |

## Data integrity

| Gap | Pointer | Size |
|---|---|---|
| Body crash reconciliation is partial. The no-checkpoint case and running actions are not closed. The fix needs a `body_started` field and touches about 30 files. | [fix-a1](worknotes/fix-a1.md) items 3 to 5 (not done), `golem/src` | L |
| The two-phase `prepared` receipt is not implemented. Abandoned reflex actions get no receipt, so the report cannot show them as aborted. | `golem/src/body/executor-action.ts` (about lines 60 to 93), [0020](../../decisions/0020-receipts.md), [fix-a1](worknotes/fix-a1.md) (line 137), [wave-m retro](retro/wave-m.md) | M |
| Journals are append-only by policy and by partial grants only. The adam-reset and live cases delete rows. | [0056](../../decisions/0056-first-migration-runner-and-least-privilege-grants.md), `threshold/mcp` migrations | M |
| Journal spacing bucket, the rule that no journal text goes into events, and the stream `max_bytes` were not started. | [fix-b](worknotes/fix-b.md) item 6 (not done), [fix-b2](worknotes/fix-b.md) (the journal branch; no worknote of its own on the integration branch) | M |
| The per-life opaque `wait` cursor is deferred. It is still a shard-wide JetStream sequence, with about 20 literal `c_N` sites. | [fix-c](worknotes/fix-c.md) (still open) | M |
| The start precondition (refuse a life that already has `thoughts` or `intents` rows) is not in place. | [fix-e](worknotes/fix-e.md) (C3, not done) | S |
| The eventsink DLQ has documented replay steps (`eventsink/README.md`, "Dead letters and replay") but no command. | `eventsink/README.md` | S |

## Scale to 20 agents per player

| Gap | Pointer | Size |
|---|---|---|
| The thought deadline is `deadline_s = 25`. A 600-token completion on the 32B may not finish in 25 s. The shard value was not changed; the 32B run should measure it. | `shards/phase0.yaml` (`mind.thought`), [fix-d](worknotes/fix-d.md) item 10 | M (measure, owner decides) |
| Bench evidence is local: `bench-results/` is git-ignored. Four dated copies are under `bench-runs/`. | [bench-results.md](bench-results.md), `bench-runs/` | S |

## Harness

| Gap | Pointer | Size |
|---|---|---|
| Timing-sensitive tests are flaky under parallel load: `golem/src/test-control.test.ts`, `golem/test/live/adam-stack.test.ts`, `tools/repo-checks/src/cli.test.ts`, `threshold/mcp/src/imports.test.ts`, and the lantern-local thinker reconnect. | [fix-e](worknotes/fix-e.md) | M |
| Harness checks that were never exercised live: the `bodyConnected` five-minute silence abort, the TPS reader, and the fresh-volume gate through `docker inspect`. The TPS rule is now real (`tick-rate.ts`) and `bodyConnected` reads the Body's own events, but neither has run in a live run. | [fix-e](worknotes/fix-e.md) sessions 3 and 6, [adam-run-owner-decisions.md](adam-run-owner-decisions.md) | M |
| Exit runs are deferred by decision 0066. The phase is closed as proof of life. | [0066](../../decisions/0066-phase0-closed-as-proof-of-life.md), [0064](../../decisions/0064-exit-run-lives.md) | L (owner) |
| No clean 20-minute live smoke has passed. `smoke-w6-20-a` aborted on a process-probe bug; `smoke-w6-25-a` ended when the 8B Adam died to a zombie about 6 minutes in, and the harness treated the death as a stall (fixed as `life_ended`). Neither run is a pass. | [RESUME.md](RESUME.md), [README.md](README.md) (OPS-1) | S |
| `tsc -p tools/mcp-tokens` reports 3 errors in `pepper-digest.test.ts` (`Uint8Array.equals`). That package's typecheck is not in `check`. | `tools/mcp-tokens` | S |
| `tools/mcp-tokens` is not covered by `./geldar.ps1 check`. | `geldar.ps1`, `tools/mcp-tokens` | S |

## Knowledge boundary

| Gap | Pointer | Size |
|---|---|---|
| The look projection still carries `shard`, `snapshot_id` and `body_generation`, and does not yet show in-world time. Contract schema descriptions for `mcp-world`, `common`, `look.ts` and `mcp-common` are TODO. | [fix-c](worknotes/fix-c.md) items 2 and 3 | M |
| Wake reasons are shown raw to the model (`mind_start`, `fallback`, `idle`, `unexpected_damage`). They need plain wording, and the library golden snapshot must change with them. | [fix-c](worknotes/fix-c.md) item 4 | S |
| Persona lint at `player add` and at seed update, with `--allow-meta`, is not written. The threshold MCP README should document it. | [fix-c](worknotes/fix-c.md) item 5, [0060](../../decisions/0060-persona-size-limits.md) | S |
| The reflection prompt does not tell the model about `due_tick`, so the model does not emit it. This is a prompt-version change. | [w6-01](worknotes/w6-01.md) | S |
| Damage while a thought is in flight is dropped (`coalesced_in_flight`), not held. A hit during a long thought is not re-raised after the thought settles. | [fix-d](worknotes/fix-d.md) item 1, [0065](../../decisions/0065-damage-wakes-the-mind.md) | S |
| The `suppressed_wakeups` row for an aborted cycle uses `snapshot_unavailable` because `recordLostWake` has a fixed reason. | [fix-d](worknotes/fix-d.md) item 6 | S |

## Ops and CI

| Gap | Pointer | Size |
|---|---|---|
| The MCP image carries `animus`, `mcp-mock` and `repo-checks` runtime dependencies. Slimming is deferred. | `threshold/mcp` Dockerfile, [fix-f](worknotes/fix-f.md) | M |
| The CI integration Postgres job has not run in CI yet. | [fix-f](worknotes/fix-f.md) (line 66), `.github/workflows` | S |
| `.github/dependabot.yml` has entries for `threshold/mcp`, `threshold/mcp-mock` and `/compose`, not verified online. Dependabot does not see the image digest in `compose/phase0.yml`; renaming the file is an owner call. | [fix-f](worknotes/fix-f.md) | S (owner) |
| `compose/phase0.yml` comment (around line 130) says the plugin writes `/tmp/geldar-identity.ready` at init. It is now written when the life registry syncs. | [w6-04](worknotes/w6-04.md) | S |
| The glass integration test still connects as `geldar`, not `geldar_glass`. Re-run it once the `0005` migration is merged. | [w6-12](worknotes/w6-12.md) (TODO) | S |
| `threshold/mcp-mock` `server.ts` (565 lines), `lantern-local/src/thinker.ts` (587), `golem/src/mind/thinking-loop.ts` (611) and `tools/adam-run/src/adapters.ts` (514 and over) are above the 500-line soft cap. | repo line counts | M |
| Owner adam-run decisions still open (O-2: the lifeEnded rule fires on any death in the run, not only inside the window). | [adam-run-owner-decisions.md](adam-run-owner-decisions.md) | S (owner) |

## Docs and spec

| Gap | Pointer | Size |
|---|---|---|
| Spec line about observers (around 1584) still says observers can read the prompt. Prompt v4 removed the sentence (decision 0068). The owner must amend the spec. | [0068](../../decisions/0068-prompt-v4-and-agent-visible-text.md), `docs/spec.md` ~1584 | S (owner) |
| Spec 5.15.6 owner cap is 3; decision 0052 says 20. | [0052](../../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) | S (owner) |
| Spec 2a and 3 use "player" and "agent" with different meanings. | `docs/spec.md` 2a, 3 | S (owner) |
| About 30 lines of the spec carry personal names. The repo is public, so the owner should replace them. | `docs/spec.md` | S (owner) |
| The retro for Wave 6 and the exit retro are pending. | [wave-m retro](retro/wave-m.md), [README.md](README.md) | S |

## Corrections to earlier claims

Earlier notes and the first version of this list stated the following. The truth after the fix rounds and the Phase 0 close is in the right-hand column.

| Earlier claim | Truth | Pointer |
|---|---|---|
| The owner cap is 3 (spec 5.15.6) or 20 (decision 0052), with nothing enforcing it. | The cap is enforced in the database by migration `sql/0006_owner_cap_trigger.sql`. `owner add` takes `sovereign.owner_cap_default` (3) unless `--cap` is given, so the owner needs `owner add --cap 20`. Spec 5.15.6 still says 3 (owner edit). | [fix-b](worknotes/fix-b.md) item 5, [README.md](../../../threshold/mcp/README.md) |
| The TPS rule was not real in the harness. | The TPS rule is real: it reads `server_tps` events from the Body (`tick-rate.ts`). It has not run in a live run. | [fix-e](worknotes/fix-e.md), `tick-rate.ts` |
| The report gave each criterion a pass or fail verdict. | A criterion is UNKNOWN when there are not enough samples. An UNKNOWN is not a pass. | `tools/adam-run` report generator |
| Receipts cover every action. | Receipts cover only plan actions. The `prepared` receipt is not implemented, so abandoned reflex actions get no `aborted` receipt. | [0020](../../decisions/0020-receipts.md), `golem/src/body/executor-action.ts` |
| Journals are append-only. | Append-only is policy plus partial grants. `adam-reset` deletes the rows of `ag_adam_02` before each live case (decision 0064 says append-only; O-10 to O-15 are open). | [0056](../../decisions/0056-first-migration-runner-and-least-privilege-grants.md), [adam-run-owner-decisions.md](adam-run-owner-decisions.md) |
| The observers sentence is in the agent prompt. | The sentence was removed from prompt v4 (the default, decision 0068). `docs/spec.md` around line 1584 still says it. OWNER EDIT NEEDED. | [0068](../../decisions/0068-prompt-v4-and-agent-visible-text.md) |
| Persona lint at `player add` and at seed update is not written. | Lint runs at `player add`, and `--allow-meta` keeps a flagged line with a warning (`tools/mcp-tokens/src/persona-lint.ts`). There is no seed update command, so lint at seed update does not apply. | [threshold/mcp README](../../../threshold/mcp/README.md) |
| The smoke run (OPS-1) is done, and so is W6-08. | OPS-1 has no clean pass (see the smoke row above). W6-08 has no branch, merge or worknote and is not done. | [README.md](README.md), [RESUME.md](RESUME.md) |
| CI does not run the integration tests against Postgres. | CI now runs the owner-cap integration cases in a Postgres job (`83b0922`). A CI run result was not checked here. | `.github/workflows`, [fix-f](worknotes/fix-f.md) |
| Bench evidence is in the repo. | Bench evidence is local: `bench-results/` is git-ignored, and copies are under `bench-runs/`. | [bench-results.md](bench-results.md) |
| Spec 2a and 3 are consistent in their terms. | They use "player" and "agent" with different meanings (owner edit). About 30 lines of the spec carry personal names (owner edit). | `docs/spec.md` 2a, 3 |