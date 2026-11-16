---
title: Backup and restore
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, colo-deploy.md, bring-up-phase0-shard.md, nats-auth-inplace.md, account-deletion.md, node-only-config.md, ../reference/deploy-scripts.md, ../reference/compose-stacks.md, ../reference/database-schema.md, ../architecture/deployment-topology-colo.md]
sources: [docs/spec.md, ../decisions/0076-backup-scope-and-destination.md, ../decisions/0130-phase1-owner-rulings-for-c1.md, ../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md, deploy/colo-cd.sh, deploy/colo-rollback.sh, deploy/colo-down.sh, deploy/colo-public.sh, deploy/common.sh, deploy/README.md, compose/phase0.yml, compose/colo.yml, geldar.ps1, sql/README.md, docs/runbooks/open-signup.md, docs/runbooks/block-owner.md, docs/analysis/genesis/plan.md, docs/analysis/genesis/README.md, docs/analysis/genesis/RESUME.md, docs/analysis/autonomy/review-and-plan-2026-11-14.md, ../decisions/0339-journal-reset-one-time-exception.md, ../decisions/0188-genesis-environment-stamp.md, ../decisions/0056-first-migration-runner-and-least-privilege-grants.md, ../decisions/0185-per-turn-record-for-kit-minds.md, docs/runbooks/world-and-memory-reset.md]
---

# Backup and restore

**There is no backup procedure in Geldar today, and no restore procedure.** No script, workflow or runbook in the repo at `03c1f5de` takes a backup of the world, the NATS state or the full database on a schedule, and none restores one. This page says what the repo does keep, how to check it, what you must not do while no backup exists, and what is missing.

**Owner:** the project owner decides the backup build and its destination ([decision 0076](../decisions/0076-backup-scope-and-destination.md), owner ruling; [decision 0130](../decisions/0130-phase1-owner-rulings-for-c1.md), ruling 2). The node operator runs the read-only checks below.

**Tested?** No. Nothing on this page was run on the Colo node or a local stack for this page (documentation freeze, plan decision D8). The commands are read-only and every file they name exists in the repo at `03c1f5de`.

## Why there is none

- Spec section 6.8 asks for a nightly coordinated checkpoint (world, `pg_dump`, JetStream positions, CoreProtect data, player repo commit SHAs, one manifest), encrypted, one copy off the colo, 30 daily and 12 weekly copies, and a quarterly restore test.
- [Decision 0076](../decisions/0076-backup-scope-and-destination.md) chose option B (one coordinated checkpoint) and recommended a destination. On 2026-11-10 the owner accepted scope B and **deferred** the destination and the build ([0130](../decisions/0130-phase1-owner-rulings-for-c1.md), ruling 2). The ruling's stated consequence: until backups exist, a running Colo shard has no restore path, so it stays invite-only and unannounced and nothing irreplaceable lives on it.
- The genesis plan records the same state: "a pre-migration `pg_dump` into `state/backups` (no retention, no off-node copy). No world backup, no JetStream backup, no restore ever tested; rollback restores images only" (`docs/analysis/genesis/plan.md` line 13).

## What the repo does keep

| Copy | Made by | When | What it covers | Evidence |
|---|---|---|---|---|
| Pre-migration database dump `backups/pre-cd-<UTC stamp>.sql` in the Colo state directory | `deploy/colo-cd.sh` | Only on a CD run whose change touches `sql/`, before the migrations | The whole `geldar` database, as plain SQL (`pg_dump` with no `-F` option). No retention: nothing deletes old dumps. Made with `umask 077` | `deploy/colo-cd.sh` lines 389 to 398; [deploy scripts](../reference/deploy-scripts.md) |
| Release records `previous.env` and `current.env`, and `<release file>.bak-<stamp>` | `deploy/colo-cd.sh`, `deploy/colo-up.sh` | Every deploy | Image pins only. `colo-rollback.sh` re-applies the previous release with `--pull never`; it removes no volume and does not reverse a database change | `deploy/colo-cd.sh` lines 370 to 378; `record_release` in `deploy/common.sh` lines 458 to 471; `deploy/colo-rollback.sh` lines 1 to 4; `deploy/README.md` "Rollback" |
| `<Caddyfile>.bak-geldar-<stamp>` | `deploy/colo-public.sh` | Every Caddyfile change | The reverse proxy's config file | `deploy/colo-public.sh` lines 128 to 137 |
| One-time reset dumps and archive tables | The operator, by hand, under [decision 0339](../decisions/0339-journal-reset-one-time-exception.md) | Once, on 2026-11-15, before the journal and sleep-mark reset | A full database dump and a dump of the two reset tables, kept operator-only (mode 0600) in the operator state directory; the removed rows also sit in `mcp_journal_archive_20261115` and `mcp_sleep_marks_archive_20261115`, readable by the table owner only. Not a routine; no script made them | 0339 Decision items 1 to 4. Their presence on the node is unverified (D8). See [world and memory reset](world-and-memory-reset.md) |
| NATS auth config copy and its sha256 | The operator, by hand | Step 1 of each in-place NATS change | The live `nats-auth.conf` | [nats-auth-inplace](nats-auth-inplace.md), "1. Backup" |
| The volumes themselves | Docker | Always; `shard down` and `colo-down.sh` keep them | Live data, not a copy. A lost or corrupted volume is lost | `geldar.ps1` line 458; `deploy/README.md` "Rollback" |

## What has no copy

| Store | Where it lives | Holds | Evidence |
|---|---|---|---|
| World | `paper-data` volume (`compose/phase0.yml` lines 164 to 170, `compose/colo.yml` lines 740 to 744) | The Paper world, player data, and CoreProtect's SQLite database under `plugins/CoreProtect` | [block-owner](block-owner.md) lines 69 to 70 |
| NATS | `nats-data` volume | JetStream: the `GELDAR_EVENTS` stream and the KV buckets (life registry, checkpoints, body generation, skins) | [decision 0076](../decisions/0076-backup-scope-and-destination.md) "Problem"; KV names in `Get-NatsUsers`, `geldar.ps1` line 376 |
| Database, between migrations | `postgres-data` volume | Everything written after the last pre-migration dump: journals, thoughts, receipts, events, accounts | `deploy/colo-cd.sh` line 389 (the dump runs only when `sql/` changed) |
| Skins | NATS KV `geldar-skins` | Signed textures; a re-import needs the signed files the owner holds | [node-only-config](node-only-config.md) item 9 |
| Player repos | Sibling repos, outside this repo | Each sovereign player's memory files | spec section 6.8 lists them; no script here touches them |
| Secrets | The node's secrets directory; the dev secrets folder locally | Every secret role | [rotate secrets by role](rotate-secrets-by-role.md). Spec section 6.7 puts them in a secret store; none is wired up |

## Check that a deploy took its database dump (Colo node)

Use this after a CD run that changed `sql/`, before you decide anything about that release. Read-only.

1. On the node, with the deploy environment loaded (the state directory is `GELDAR_STATE_DIR`; its default is set in `deploy/common.sh` line 19), first check that the variable is set. If it is empty, the next commands read `/cd.log` and `/backups/` and look like "no dump":

   ```sh
   test -n "$GELDAR_STATE_DIR" && test -d "$GELDAR_STATE_DIR" || echo "GELDAR_STATE_DIR is not set: load the deploy environment first, then start again"
   ```

   Then find the dump line in the CD log:

   ```sh
   grep -F 'pg dump written before the migrations' "$GELDAR_STATE_DIR/cd.log" | tail -n 3
   ```

   `deploy/colo-cd.sh` line 395 writes that line with the dump's path. If the run failed at the dump, the log says `pg dump failed; migrations not applied` (line 393) and nothing was restarted.

2. Confirm the file exists, is not empty, and is readable by its owner only:

   ```sh
   ls -l "$GELDAR_STATE_DIR/backups/"
   ```

3. Record the dump's file name and size in the operator log. Do not copy it anywhere: it holds the whole database, personal data and token hashes included.

**Verify:** the newest `pre-cd-*.sql` is non-empty and its stamp matches the CD run's log line.

**Rollback:** nothing to undo; these steps only read.

## While no backup exists

1. **Never remove a volume** (`docker compose down -v`, `docker volume rm`) without the owner's word. On the local stack, `./geldar.ps1 shard down phase0` keeps volumes; on the Colo node, `deploy/colo-down.sh` and `deploy/colo-rollback.sh` remove none.
2. **Never restore one store alone.** Spec section 11 ("Restore from checkpoint"): restore every component from the same manifest, never one component alone. Decision 0076 gives the reason: a backup of one store does not restore a Body, because the stores no longer agree.
3. **Restoring a pre-migration dump is the owner's call.** The open-signup runbook allows it only "with the owner's go" ([open-signup](open-signup.md), step 13). The repo has no restore script. The dump is plain SQL, which PostgreSQL loads with `psql`, not `pg_restore`; the target database, the order and the stop of writers are not written down anywhere in the repo, so do not improvise them at 2am. Stop and escalate.
4. **A rolled-back release keeps the newer schema.** `colo-rollback.sh` re-applies images only; migrations are forward-only (`deploy/README.md`, "Rollback"; [deploy scripts](../reference/deploy-scripts.md)). Decide with the owner before rolling back a release that changed the schema.
5. **A local world you want to keep:** setting `GELDAR_WORLD_VOLUME` makes Paper use another named volume and leaves the default one untouched (`compose/phase0.yml` lines 167 to 170; `./geldar.ps1 adam-run <32b|8b> prepare-volume` makes a fresh, empty one). This sets the old world aside; it is not a copy.

## Privacy note

An account deletion ([account deletion](account-deletion.md)) runs inside the live database. It does not reach the `pre-cd-*.sql` files, which are never pruned (`deploy/colo-cd.sh` lines 389 to 398 create them; no script deletes them). A dump taken before a deletion still holds that owner's data, and restoring it would bring the data back. For the deploy dumps this is inferred from the code and not recorded in any decision. For the 0339 archive tables it is recorded: 0339 lists it as a known gap and a question for the owner ("an account deletion (0262) does not reach them", Consequences). [Decision 0185](../decisions/0185-per-turn-record-for-kit-minds.md) asks the same of turn records ("Backups and the dump copies: do they carry turn records, and for how long?"). [Privacy and data retention](../security/privacy-and-data-retention.md) **(a-n)** covers retention; this gap is not closed by any decision.

## Conflicts recorded

1. **Destination.** Decision 0076 and 0130 ruling 2 (2026-11-10) say the destination is deferred. The genesis campaign notes say "Backups go to another LAN node (owner, 2026-11-14)" (`docs/analysis/genesis/RESUME.md` line 14). No decision record carries the later choice. Treat the destination as unsettled until one does.
2. **Checkpoint contents.** Spec section 6.8 includes CoreProtect data and the commit SHAs of every living player repo. Decision 0076's recommended contents (Postgres dump, NATS KV and JetStream snapshot, world copy, manifest) do not list them separately. CoreProtect's SQLite file sits inside the world volume ([block-owner](block-owner.md) line 69), so a world copy would hold it; player repo SHAs are not covered.
3. **Restore test cadence.** Spec section 6.8: quarterly. Decision 0076: at every wave boundary in Phase 1. Decision 0130: moved to the end-of-phase gates.
4. **The deferral's condition.** 0130 ruling 2 deferred backups on the condition that nothing irreplaceable lives on the shard. The 2026-11-14 autonomy review says "That condition no longer holds" (`docs/analysis/autonomy/review-and-plan-2026-11-14.md` line 245, finding WD3). No decision record answers it.
5. **Where secrets live.** Spec section 6.7 puts Colo secrets in a secret store injected at deploy time. The node keeps them as files in a root-only directory ([decision 0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 6; `deploy/gen-secrets.sh`). [Decision 0188](../decisions/0188-genesis-environment-stamp.md) item 4 (Proposed) keeps only secrets that must outlive a host, the backup key among them, in a per-environment vault (also `docs/analysis/genesis/README.md` line 40, D-GN-04). None of that exists yet.
6. **"Backup first" with nothing to take it.** [Decision 0056](../decisions/0056-first-migration-runner-and-least-privilege-grants.md) says the operator runs `db migrate` on the Phase 0 volume "with a backup first". The repo has no tool that backs up the local stack; [bring up the Phase 0 shard](bring-up-phase0-shard.md) step 5 runs `db migrate` without one.

## Planned work (not built)

- [Decision 0188](../decisions/0188-genesis-environment-stamp.md) (Proposed) item 10 makes backups with an off-node copy and a restore drill in CI part of the genesis campaign; its open questions include the backup destination and its credential.
- Genesis packets G5-01 to G5-04: scheduled `pg_dump` and JetStream backups to an off-node location, a world archive, retention, a restore drill in CI, and a `restore` mode for a stamp (`docs/analysis/genesis/plan.md` lines 30 and 88).
- Autonomy plan item 0a.8, "A first backup: world, ownership log, Postgres, NATS state", with the restore drill in Stage 1 (`docs/analysis/autonomy/review-and-plan-2026-11-14.md` lines 539 and 570).

When either lands, this page becomes the procedure. Until then, it is a statement of the gap.

## Related

- The deploy that takes the dump: [colo-deploy](colo-deploy.md) and [deploy scripts](../reference/deploy-scripts.md).
- What the Colo node holds that the repo does not rebuild: [node-only-config](node-only-config.md).
- Failure modes across components: [failure modes](../operations/failure-modes.md) (W3, new in this wave). Incident steps: [incident response](incident-response.md) (W3, new in this wave).
- Resetting the world or memory on purpose: [world and memory reset](world-and-memory-reset.md).
