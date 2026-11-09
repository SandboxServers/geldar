# Wave 3 retro (the world to the record)

Written by the orchestrator after the wave test and review, 2026-11-09. Evidence: [worknotes/batch-core-review-1.md](../worknotes/batch-core-review-1.md), [wave3-review-1.md](../worknotes/wave3-review-1.md), [wave3-review-2.md](../worknotes/wave3-review-2.md), [wave3-review-3.md](../worknotes/wave3-review-3.md), [wave3-live-pass.md](../worknotes/wave3-live-pass.md), overnight decisions 18 to 25.

## What shipped

- `plugin/`: Gradle multi-project. `core` (Geldar-Core, Paper): event export to JetStream `GELDAR_EVENTS` with dedup headers, `server_tps`/`damage`/`death`/`sleep` events, recipe grant on join (decision 0032), player command cancel. `velocity-identity`: the bot-ingress gate (fail closed until synced, KV registry, probe of the bucket every 30 s, `geldar:cmd` drop for non-admitted connections).
- `eventsink/`: durable pull consumer, idempotent insert, dead letters, retry and recovery rules, image in compose.
- Golem: registers its bot username (and a derived life id) in the registry before every connect; a "not admitted" kick is fatal with the registry off and after 5 in a row with it on.
- Process: owner rulings made during the wave (decisions 19 to 21): reviews and tests once per wave, process packet after the retro, packets fan out early.
- Live evidence: three full live-lane passes (58, 60, 60, 60 tests), the sink integration test, an unregistered name denied at the proxy, a registered name stopped by Paper's whitelist, revocation.

## What the reviews caught that tests did not

1. **A poison-pill message wedged the sink forever** (NUL in jsonb, out-of-range ints) with no log; then **`max_deliver` silently dropped events** after about 7.5 minutes of Postgres downtime. The fix for the first created the second.
2. **The identity gate failed open if its plugin did not load** (healthchecks were a bare TCP connect). Same gap for Geldar-Core.
3. **A stale registry cache** after a deleted or recreated bucket kept old names admitted; a **duplicate login released the live session's admission**; names were canonicalised loosely (Kelvin sign).
4. **A lossy life id** (`Steve_1` and `Steve1` collide) that also disagreed with the plugin's `agent_id`.
5. **A fix broke CI**: an edit lost a newline in a workflow file; the test only sliced strings, so it passed. A fix to a race (round 3) was one line of ordering: a fix for one race created a fail-closed-forever liveness hole.
6. Tests that pass without their guarded code, again: a self-deduping fake, annotations never exercised, a revert-check mutation that did not reintroduce the old behaviour.

What live runs caught that unit tests could not: a Postgres volume initialised with another password (ops), a wrong expected life id in a live test.

## What cost the most

- **Review volume:** one batch review (17 findings), then wave reviews A and B (23), round 2 (7), round 3 (5); four fix rounds. Every round found real defects, but rounds 2 and 3 were mostly defects introduced by the previous round's fixes. Late rounds are cheap per finding but each fix round needed a full check and a live pass.
- **Late owner rulings** (tests and reviews only at wave end) arrived after the first batch review had run; no rework resulted.
- **No coder ran out of context** this wave: the wave 2 brief changes (commit per item, progress file, about 70k budget) held.

## What went wrong in the process

1. **Edits landed in the wrong worktree, twice.** A coder's absolute-path edits hit the orchestrator's `wave3` worktree (a workflow file; a README and a test file) and blocked a merge as uncommitted changes. They were identical to the coder's own commits, so nothing was lost, but it is a latent corruption risk.
2. **Revert-checks that were not faithful** (a mutation that did not reintroduce the old code) and one that lost work (a `git checkout` of uncommitted files).
3. **Reviewers cannot write reports**; the orchestrator copied findings into `worknotes/` (works, but costs a turn).
4. **PowerShell `-E` is ambiguous** for `pnpm add -E`; `--save-exact` works.
5. **A secret regenerated or copied between worktrees can orphan a volume**: the Postgres volume refused the new password. `shard secrets` never overwrites, but copies must copy every file.
6. The `itzg/mc-proxy` plugin directory and log-file assumptions were unverifiable without Docker until the live pass.

## Keep

- Fresh-eyes rounds that verify earlier fixes (found regressions each time).
- Fail-closed design with a probe that proves the component loaded.
- Orchestrator-owned live runs, once per fix round, including negative probes (unregistered name, revoked name).
- Writing reviewer findings to `worknotes/` with owners per item, so the fix coder starts from a file, not a paraphrase.

## Open items (not proven live, unit-tested only)

A bot's command being cancelled; `death` events in Postgres; a NATS outage while the gate runs; a consumer deleted alone on a live bucket (jnats exposes no consumer info; documented in the threat model); the case-differing duplicate-login edge (unverified against the Velocity source). Owner items: decisions 0032 and 0038 (unchanged), overnight decisions 18 to 25.

## Actions

Each is applied by the `W3-process` packet unless marked.

1. **A1 (S, agent edit)** `packet-coder.md`: edit only files by their path inside your own worktree root; before finishing, `git status` in your worktree must be clean and the path you edited must start with the worktree path in your brief. Revert-checks must reintroduce the old behaviour faithfully, and commit before any mutation (never `git checkout` uncommitted work).
2. **A2 (M, skill edit)** `campaign-packet`: the owner rulings as procedure: wave close order (step 0 wave test and review, docs sweep, retro, process packet, ledger), reviews and live runs once per wave, up to 5 rounds with a fix round between them, the packet planning rule (small unblockers first, fan out early), reviewer findings recorded by the orchestrator in `worknotes/wave<N>-review-<r>.md` with owners per item, fix coders get the file path in the brief.
3. **A3 (S, agent edit)** `packet-reviewer.md`: add checks for "fails open when a component is missing" (every security component needs a startup proof that it loaded), "a fix introduces a race or a retry-forever", config/YAML edits (parse them, do not slice strings), and judging each new test by whether it fails without its fix (mutation must be faithful).
4. **A4 (S, skill edit)** `run-shard`: plugin jars must be built before `shard up` (the shard-up check now enforces it); copy all of `compose/secrets/` between worktrees or none; a password mismatch means the volume was initialised with another secret; `GELDAR_NATS_URL` defaults to the loopback NATS.
5. **A5 (S, repo check)** `tools/repo-checks`: parse every workflow under `.github/workflows` with a YAML parser and fail on duplicate keys or invalid YAML. (A test in `threshold/mcp-mock` does this for one workflow only.)
6. **A6 (S, brief template)** briefs that add a retry, a requeue or a cap must say what happens at the cap (dead letter, fatal, drop) and require a test for the last allowed attempt.
