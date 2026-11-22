---
title: "Runbooks index"
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [../README.md, ../decisions/README.md, ../../deploy/README.md, ../guides/first-shard-on-your-machine.md, ../guides/operator-first-day.md, ../operations/README.md]
sources: [docs/runbooks, tools/repo-checks/src, deploy/test]
---

# Runbooks index

A runbook is a how-to: one goal, the steps to reach it, and how to undo them. This index lists all 29 runbooks in this
folder (`git ls-files docs/runbooks`: 30 files with this index, 2026-11-16 at 3f07a4be) in two tables: the
[main index](#index) for the 19 runbooks of the W0 index and W3 body pass, and
[new runbooks](#new-runbooks-o01-to-o10-wave-w3) for the ten written in W3. For each it says what it is for, who it is
for, and how far its references were checked. The Audience, Status and Last verified columns of both tables were
compared with each runbook's metadata block by script on 2026-11-16 at 3f07a4be: all 29 match.

New here? Walk a tutorial first: [your first shard on your machine](../guides/first-shard-on-your-machine.md) (G02)
before [bring-up-phase0-shard.md](bring-up-phase0-shard.md), and [operator first day](../guides/operator-first-day.md)
(G04) before any node runbook. Failure symptoms per component are in
[failure-modes](../operations/failure-modes.md).

This folder is operator documentation. Several runbooks describe Glass, Kino, thoughts, journals and progress metrics.
Never copy any of it into a prompt, skill, kit file, tool text, `identity.md`, player repo or sign.

## How to read the status columns

- **Status** uses the one definition in the [documentation style](../agents/documentation-style.md#metadata-block):
  `verified` only after a reviewer has passed the runbook against the commit in its `last_verified`; `draft` until
  then; `stale` when a source changed since. No runbook has passed a review yet, so all 29 are `draft`.
- **References checked by writer**: `yes` means the index writer found every repo file, script, CLI verb and config
  key the runbook names in the repo on 2026-11-16 at the commit in its Last verified column, with no contradiction
  with the code that the runbook does not itself record. `no` means at least one reference is missing, stale or
  contradicts the code or another runbook; the reason is in [What could not be checked](#what-could-not-be-checked).
  Neither value means the procedure was run or works on the Colo node. No node, VM, database or world was read for
  this index (owner default D8).
- **Last verified** is the date and commit of the writer's repo check above, and nothing more. Runbooks whose body
  was corrected in the W3 body pass carry `03c1f5de`; the others keep the W0 check at `cd4499da`.
- **Audience** `agents-never` marks an operator runbook whose goal is to set up, show or measure an observation
  surface (Glass, Kino, thoughts, journals, telemetry, progress metrics, the public map). `operators` covers node and
  stack work, even when one step touches an observation surface (open-signup.md installs the Glass as one of many
  steps). `contributors` covers repo and test work.
- **Component (role-owner)** names the part of Geldar and the role that runs the runbook (owner default D3: a role,
  never a person). "Node operator" is the role that holds the Colo node.

## Index

| Runbook | Goal | Audience | Component (role-owner) | Files and commands it references (checked 2026-11-16) | References checked by writer | Status | Last verified | Read first |
|---|---|---|---|---|---|---|---|---|
| [account-deletion.md](account-deletion.md) | Understand and run an owner's account deletion, and clean up after a self-serve one | agents-never | Register service (node operator, on the owner's written request) | `sql/test/check-schema-account-delete.sql`, migrations `0039`/`0040`, `deploy/colo-admin.sh player-stop`, `./geldar.ps1 players status/down`, `threshold/register/src/api/account-export.ts` | yes | draft | 2026-11-16 at `03c1f5de` | Decisions [0171](../decisions/0171-account-erasure-rule.md) and [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md); SQL access as the register role |
| [block-owner.md](block-owner.md) | Configure CoreProtect for the block owner bridge and run its live checks | operators | geldar-core plugin and CoreProtect (node operator) | `plugins/coreprotect/coreprotect.lock.json`, `blockowner:` keys in `plugin/core/src/main/resources/config.yml`, `contract/schemas/block-owner.schema.json` | yes | draft | 2026-11-16 at `03c1f5de` | [coreprotect.md](coreprotect.md); decision [0165](../decisions/0165-block-owner-subjects.md) |
| [body-helper-node-steps.md](body-helper-node-steps.md) | Install the root-owned body helper unit on the Colo node and wire its NATS users | operators | Body helper systemd unit (node operator, owner go per step) | `deploy/install-body-helper.sh`, `deploy/body-helper-node.env`, `body-helper/src/helperConfig.ts`, `.github/workflows/body-helper-bundle.yml`, `geldar.ps1` `Get-NatsUsers` | yes | draft | 2026-11-16 at `03c1f5de` | [nats-auth-inplace.md](nats-auth-inplace.md); decision [0260](../decisions/0260-body-container-control-by-host-helper.md) |
| [capture-real-payloads.md](capture-real-payloads.md) | Capture the owed real provenance, combat-fact and container-take payloads from a throwaway shard, and say what blocks it today | agents-never | Plugin evidence cards AN-26a, AN-27a, AN-47a, AN-51a (`ops` agent; orchestrator dispatches) | `BlockOwnerSetup.java`, `GeldarCore.java`, `geldar.ps1` `Get-NatsUsers`, `bench/sheet/run.sh`, `golem/test/live/` | no (not in the writer index check; added 2026-11-19) | draft | 2026-11-19 at `7efad8ca` | The four worknotes; the run-shard and body-bench skills |
| [chunky.md](chunky.md) | Pregenerate world chunks with Chunky without overloading the server | operators | Paper plugins (node operator) | `plugins/chunky/README.md`, `plugins/chunky/chunky.lock.json`, `render-thread-count` in `plugins/bluemap/config/core.conf` | yes | draft | 2026-11-16 at `cd4499da` | Paper console access |
| [colo-compose-drift.md](colo-compose-drift.md) | Know why the node's running compose differs from the repo, and what the options are before a sync | operators | Colo node compose copy (node operator, owner decides items 3 to 5) | `deploy/common.sh` (`GELDAR_COLO_ROOT`, `COMPOSE_FILE`), `compose/colo.yml`, `deploy/colo-admin.sh` `player-start`, `deploy/test/colo-admin-telemetry.test.ts` | yes | draft | 2026-11-20 at `aa0c19ee` | Decisions 0212 and 0342 |
| [colo-deploy.md](colo-deploy.md) | Understand, dispatch, plan-only and roll back a Colo deploy from GitHub Actions | operators | CD pipeline and self-hosted runner (owner for runner and settings; node operator for "needs manual") | `.github/workflows/colo-deploy.yml`, `deploy/colo-cd.sh`, `deploy/colo-rollback.sh`, `deploy/colo-status.sh`, `deploy/test/colo-fetch-manifest.test.ts` | yes | draft | 2026-11-16 at `03c1f5de` | [`deploy/README.md`](../../deploy/README.md); decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) |
| [coreprotect.md](coreprotect.md) | Verify the pinned CoreProtect jar and set its config by hand on first start | operators | Paper plugins (node operator) | `plugins/coreprotect/coreprotect.lock.json`, `fetch_coreprotect` in `deploy/common.sh`, `deploy/colo-up.sh`, `modrinth:Lu3KuzdV@24.1` in `tools/repo-checks/src/release-dates.json` | yes | draft | 2026-11-16 at `cd4499da` | Nothing; then [block-owner.md](block-owner.md) |
| [glass-aliases.md](glass-aliases.md) | Show public aliases instead of stored agent names in Glass, Kino and the map | agents-never | Glass (node operator) | Alias mount and `GELDAR_ALIASES_FILE` in `compose/colo.yml`, `plugins/bluemap/README.md`, `plugins/bluemap/test/alias-format.test.ts` | yes | draft | 2026-11-16 at `cd4499da` | Root access to the node state directory |
| [kill-switch-programs.md](kill-switch-programs.md) | Turn off a Body program (explore, farm or patrol) | operators | Body and player-core code (merge and deploy) | `player-core/src/validate/bounds.ts`, `golem/src/body/programs/index.ts`, `golem/src/body/restart.ts`, `contract/schemas/mcp-play.schema.json`, `contract/schemas/program-shapes.schema.json` | no | draft | 2026-11-21 at `f03537ee` (dry run) and `b6bfcfa0` | [kino.md](kino.md) (another kill switch, for Kino) |
| [kino.md](kino.md) | Enable, kill and audit Kino; capture evidence with kino-shot | agents-never | Glass Kino (owner enables; node operator applies) | `compose/colo-kino.yml`, `compose/colo-kino-session.yml`, `deploy/colo-public.sh`, `deploy/caddy/validate.sh`, `deploy/caddy/glass-off.caddy`, `glass/web/kino/`, `glass/test/kino-preview/server.ts`, `tools/kino-shot` (`browsers`, `shot`) | yes | draft | 2026-11-16 at `03c1f5de` | Decisions [0075](../decisions/0075-glass-is-a-lakitu-camera.md) and [0166](../decisions/0166-kino-monitor-wall-and-lakitu-camera.md); [glass-aliases.md](glass-aliases.md) |
| [maintenance-notice.md](maintenance-notice.md) | Know what players see during a deploy restart and switch the broadcast off | operators | Deploy and geldar-core plugin (node operator) | `contract/schemas/maintenance-notice.schema.json`, `maintenanceSubject()` in `contract/src/subjects.ts`, `maintenance.broadcast` in the plugin `config.yml`, its log lines in `plugin/core` | yes | draft | 2026-11-16 at `cd4499da` | [colo-deploy.md](colo-deploy.md) |
| [map-chat-panel.md](map-chat-panel.md) | Deploy the public map chat panel and time-of-day dial by hand, check and roll back | agents-never | BlueMap web and geldar-core (node operator; owner approval for the Paper restart) | `compose/bluemap-web/Caddyfile`, `plugins/bluemap/web/geldar-{chat,sky}.js`, `deploy/genesis/config-bundle.list` lines 54 to 56, `dc` in `deploy/common.sh` | yes | draft | 2026-11-16 at `03c1f5de` | Decision [0310](../decisions/0310-live-chat-panel-on-the-map.md); [node-only-config.md](node-only-config.md) |
| [mcp-tokens.md](mcp-tokens.md) | Add a sovereign player to the roster, set the first admin, set a player's public flags | agents-never | MCP tokens and roster (node operator) | `tools/mcp-tokens/src/cli.ts` (`roster`, `player flags`), `deploy/colo-admin.sh` (`roster-add`, `owner-set-cap`, `roster-list`, `owner-admin`, `player-flags`), `tools/admin/admin.sh` | yes | draft | 2026-11-16 at `03c1f5de` | Decision [0108](../decisions/0108-mcp-roster-source-of-truth.md) |
| [merge-queue.md](merge-queue.md) | Create, check and roll back the merge queue ruleset on `main`, and queue PRs safely | contributors | GitHub repository settings (orchestrator) | `.github/workflows/ci.yml` (`merge_group`, `ci gate`), `.github/workflows/colo-images.yml`, `merge=union` in `.gitattributes`, `tools/repo-checks/src/decision-rows.ts` | yes | draft | 2026-11-16 at `cd4499da` | Decision [0220](../decisions/0220-merge-queue-for-main.md) |
| [nats-auth-inplace.md](nats-auth-inplace.md) | Change NATS users and permissions on the live node with a SIGHUP, not a restart | operators | NATS (node operator; owner go per batch) | `compose/nats-auth.yml`, `geldar.ps1` (`Initialize-NatsAuth`, `Get-NatsUsers`), `deploy/colo-notice.sh`, `threshold/mcp/test/nats-auth.it.test.ts`, `compose/opt-in/sheet-sink.yml` | yes | draft | 2026-11-16 at `03c1f5de` | Decisions [0080](../decisions/0080-nats-auth-cutover.md) and [0087](../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md) |
| [node-only-config.md](node-only-config.md) | Inventory what the Colo node holds that the repo does not reproduce | operators | Colo node (node operator; genesis owns the fixes) | `compose/colo.yml`, `compose/phase0.yml`, `deploy/colo-cd-plan.sh`, `golem/src/whitelist-house-body.ts`, `animus/src/colo-profile.test.ts`, `docs/analysis/genesis/plan.md` | yes | draft | 2026-11-16 at `03c1f5de` | [colo-deploy.md](colo-deploy.md) |
| [open-signup.md](open-signup.md) | Take the Colo node from sign-up closed to sign-up open, in order | operators | Register service and node (node operator; owner gate) | `deploy/gen-secrets.sh`, `deploy/colo-admin.sh migrate`, `deploy/colo-up.sh` lines 55 and 58, `deploy/colo-public.sh install glass`, `REGISTER_*` names in `compose/colo.yml` | no | draft | 2026-11-16 at `03c1f5de` | [body-helper-node-steps.md](body-helper-node-steps.md), [nats-auth-inplace.md](nats-auth-inplace.md), [account-deletion.md](account-deletion.md) |
| [progress-metrics.md](progress-metrics.md) | Turn existing logs and samples into per-agent progress numbers per window | agents-never | `tools/progress-metrics` (operator) | `tools/progress-metrics/src/cli.ts` (all flags named), `tools/progress-metrics/sample.sh`, `tools/progress-metrics/export-glass.ts` | yes | draft | 2026-11-16 at `cd4499da` | Read access to node logs |
| [scratch-stack.md](scratch-stack.md) | Run a throwaway Phase 0 stack beside the live ones, then remove it | operators | Scratch test stack (operator; owner word for the Colo node) | `deploy/scratch/scratch.sh` (`up`, `status`, `down`), `compose/opt-in/scratch.yml`, `shards/character-fixture.yaml`, `tools/migrate/src/cli.ts` | yes | draft | 2026-11-16 at `03c1f5de` | `cd plugin; ./gradlew build`; [nats-auth-inplace.md](nats-auth-inplace.md) for the auth files |
| [signcheck-shard.md](signcheck-shard.md) | Run a throwaway vanilla Paper server to check sign facts and chat probes | contributors | Live-test fixture VM (contributor running live tests) | `compose/signcheck.yml` (profiles `core`, `rcon`) | no | draft | 2026-11-16 at `03c1f5de` | Decision [0192](../decisions/0192-edit-sign-action.md) |
| [skins.md](skins.md) | Import ranger skins, upload a new one, and show skins in Kino and on the map | agents-never | Velocity identity plugin and `players-cli` (node operator; owner supplies the signed files) | `deploy/colo-admin.sh skin-import`, `tools/players-cli` (`skin set/show/heads`, `run heads`), `tools/players-cli/src/png.ts`, `plugins/bluemap/config/plugin.conf`, `AgentSkinSetup` in `plugin/core` | yes | draft | 2026-11-16 at `03c1f5de` | Decisions [0140](../decisions/0140-agent-skins.md) and [0250](../decisions/0250-skin-upload-visibility-and-export.md) |

Line numbers below are in the files as they stand at `03c1f5de` after the W3 body pass (2026-11-16).

## What could not be checked

| Runbook | Why references checked by writer is "no" |
|---|---|
| open-signup.md | The step table still marks steps BLOCKED on cards that now have merged PRs on `main`: BH-1 (#525), BH-2 (#527), BH-3 (#530), ROSTER-AUTO (#515), LEGAL-SERVE (#404), C7-03c3 (#447), C7-03b5 (#503) (`git log --grep`, 2026-11-16). The "Pending" list now says so (lines 201 to 212), but whether each card is complete, and whether its BLOCKED marker can go, needs the campaign ledger (`docs/analysis/phase1/ledger.md`), which this pass did not reconcile. No commit names BH-4, BH-6 or C7-09c. The `REGISTER_NATS_*` pending marker still matches `compose/colo.yml` and its repo test. |
| signcheck-shard.md | The edit_sign live test the shard serves, `golem/test/live/edit-sign.live.test.ts`, is on the unmerged branch `phase1/body-edit-sign-live` (added in `37172f47`), not on `main` at `03c1f5de` (`git merge-base --is-ancestor` fails, 2026-11-16). The test's own header says to run it against the local shard with `--rcon-host`, while `compose/signcheck.yml` and the runbook say the signcheck shard (open conflict 3). The runbook says both (lines 13 and 76). Merging or retiring that branch is the orchestrator's call. |

### Open conflicts recorded in runbook text, not resolved

These are recorded in the runbooks with all sources, and flagged. No runbook picks a side beyond what the code does.

1. **Changing the live NATS conf: in place with SIGHUP, or regenerate and restart.** In place with SIGHUP and never a
   restart: nats-auth-inplace.md, body-helper-node-steps.md, open-signup.md, and genesis packet G2-02 acceptance (c)
   (`docs/analysis/genesis/packets.md` line 47). Regenerate on the trusted machine, copy, and restart NATS:
   `deploy/README.md` lines 309 to 318 (for the `deploy` user), and decision
   [0199](../decisions/0199-muffled-hearing.md) line 80 ("Deploy"), which says the hearing PubDeny reaches a node by
   that regenerate, copy and restart path. No decision record states a general rule (`grep` of `docs/decisions` for
   `nats-auth.conf`, `SIGHUP` and `shard nats-auth`, 2026-11-16), and 0199 names the restart path for one change that
   nats-auth-inplace.md now routes in place ("Pending additions"). nats-auth-inplace.md keeps the restart path for when
   in place is impossible; kino.md and skins.md point to it the same way and cite 0199. A decision record would close
   this (next free number from the orchestrator).
2. **The owner cap range 0 to 50.** Code: `deploy/colo-admin.sh` lines 136 to 145 (its comment cites decision 0052) and
   the `player_cap` CHECK in `sql/0002_sovereign_mcp.sql` line 17. Decision 0052: a cap of 20, no range. Spec section
   5.15.6 (`docs/spec.md` line 961): default 3, raisable by the operator, no bound. Recorded in mcp-tokens.md under the
   command block.
3. **Which shard the edit_sign live test runs on.** `compose/signcheck.yml` (header comment) and signcheck-shard.md:
   the signcheck shard. The test itself, on branch `phase1/body-edit-sign-live` at `37172f47`: "the shard up with
   `--rcon-host`", run through `./geldar.ps1 pnpm --filter @geldar/golem test:live`, which is the local Phase 0 shard.
   Recorded in signcheck-shard.md; settles when the branch is merged or retired.

### Fixed in the W3 body pass (2026-11-16, at `03c1f5de`)

| Runbook | Finding (W0 index or W0 review) | Correction and evidence |
|---|---|---|
| account-deletion.md | Export half (C7-09b) "is not built" | Now built and merged: PR #541; `threshold/register/src/api/account-export.ts`, mounted by `account-export-wiring.ts`. Deploy state not checked. |
| account-deletion.md | "(0025)" read as a decision | Now migration `sql/0025_admin_flag_and_register_audit.sql` under decision 0170 (its header comment), which points to migration 0007 for the trigger's limits. Decision 0085 covers other tables (`receipts`, `thoughts`, `suppressed_wakeups`, `mcp_journal`) and is cited only as the same pattern. |
| block-owner.md | Lock file "once that lands" | `plugins/coreprotect/coreprotect.lock.json` exists with sha256 and sha512; links coreprotect.md. |
| body-helper-node-steps.md | "the NATS secret rule above" points nowhere | Now names `GELDAR_BODY_NATS_SECRET_HOST_PATH` and the rule in `deploy/README.md` "(c) Secrets" (owner `GELDAR_SERVICE_UID`, mode `0600`). |
| body-helper-node-steps.md, nats-auth-inplace.md | Who creates `/opt/geldar` | `deploy/install-body-helper.sh` creates no `/opt/geldar` directory: it expects the bundle at `$INSTALL_DIR/dist/main.js` and the tarball under `/opt/geldar/node`, checks both, and extracts Node (lines 76 to 108). The operator creates the directories in Step 0a. nats-auth-inplace.md corrected to match. |
| body-helper-node-steps.md | Helper PR "is merged" pending | PR #415 merged as `4bab81b3` (2026-11-15); `geldar.ps1` lines 411 to 413. |
| colo-deploy.md | Timeout 40 versus 30 | `timeout-minutes: 30` (`.github/workflows/colo-deploy.yml` line 48). |
| colo-deploy.md | Compare status `ahead` or `identical` | `identical` or `behind` (workflow lines 89 to 95); the check runs on a manual dispatch only, and the runbook now says so. |
| colo-deploy.md | `colo-cd.sh` "not in this repository" | It is. `deploy/colo-cd-plan.sh` lines 61 and 90 to 93 write `manual <what>`; `deploy/colo-cd.sh` line 336 prints `needs manual: <what>`; lines 222 and 425 for a failed host refresh. The list now includes compose and Caddy changes. |
| kino.md, skins.md | Delete and regenerate `nats-auth.conf` with `shard nats-auth colo` | Now: change the live conf in place with SIGHUP by nats-auth-inplace.md; never run `shard nats-auth` on the node (`Initialize-NatsAuth` writes only into the repo's git-ignored dev secrets folder: missing password files and the Thinker token, and the conf only when the conf is missing, `geldar.ps1` lines 326 to 344; it never writes the live file). The restart path is named with its sources, `deploy/README.md` and decision 0199. See open conflict 1. |
| map-chat-panel.md | `bluemap-web` at line 540 | Line 541 at `03c1f5de`. |
| nats-auth-inplace.md | PR #415 "not merged" (three places) | Merged as `4bab81b3`. The drift table now compares the 2026-11-14 live record with the generator at `03c1f5de`, which gained the hearing denies (`3f6c1071`) and the body and eventsink state lines (`d2843e94`) on 2026-11-15, after that record; the `state.*.level` PubDeny (`a2d2a4e1`, 2026-11-14) was already drift in it. |
| nats-auth-inplace.md | AN-12b line told the reader to run `shard nats-auth` on the live node | Now: add the two lines with the procedure; the old instruction contradicted the Notes rule and the generator's behaviour. |
| node-only-config.md | Drifted `compose/colo.yml` line references | Gamerule 138, aliases mount 490, whitelist one-shot 674, `profiles: ["adam"]` 276, `node.env` note 701. Line references into other runbooks replaced by section names. |
| node-only-config.md | Generator user count | 11 users in the colo table at `03c1f5de` (was "10"); drift is 3 colo users plus deny lines (was "2 users"). |
| open-signup.md | PR #415 "not merged" (two places) | Merged as `4bab81b3`; the step 9 blocker now names only the node running the generator output. |
| scratch-stack.md | "cannot test item 5" | Now "cannot test the NATS roles"; the "item 5" wording comes from the warning in `deploy/scratch/scratch.sh` line 87, and no file defines that list. |
| signcheck-shard.md | Names a live test that is not on `main` | Stated as on the unmerged branch `phase1/body-edit-sign-live` (`37172f47`), with the unit tests that are on `main`. Still "no" (above). |

**Session labels and host aliases replaced by roles (W0 review M5, m5 and the rulings in section 3).** Every
coordinator session label and host alias in runbook bodies is replaced by its role: the node operator, the
world-operations coordinator, the genesis campaign, the node, a separate VM. Files: account-deletion.md,
body-helper-node-steps.md (9), map-chat-panel.md, nats-auth-inplace.md (2), node-only-config.md (3), open-signup.md (8),
scratch-stack.md, skins.md. A grep of `docs/runbooks/` for the old labels returned nothing on 2026-11-16; the pattern is
not printed here so that this index does not reintroduce them.

**Node paths replaced by variables (persona rule 3).** nats-auth-inplace.md and node-only-config.md named the node's
secrets and tokens paths; they now use `$GELDAR_SECRETS_DIR` and `GELDAR_TOKENS_DIR` (both named in
`deploy/README.md`). node-only-config.md also replaced two non-secret node paths: item 4 (the Glass aliases file, now
`aliases/aliases.json` under `GELDAR_STATE_DIR`, `compose/colo.yml` line 490) and item 7 (the Colo data directory,
not named). nats-auth-inplace.md step 0 now sets and checks `GELDAR_SECRETS_DIR` before any write, and quotes every
expansion. rotate-secrets-by-role.md names roles and variables only, with no folder, key-file or container file path.
What remains: repo-relative, git-ignored developer paths under `compose/secrets/` in signcheck-shard.md (the file the
contributor creates), scratch-stack.md (the generator's own output lines) and skins.md (a local skins folder), ruled
low risk in the W0 review (m7). They are paths in a developer's own checkout, not on a host.

## Overlaps and duplicates

These are findings for a later change.

1. **Colo deploy facts are spread over four places.** [colo-deploy.md](colo-deploy.md) (the pipeline and rollback),
   [node-only-config.md](node-only-config.md) items 3, 7 and 14 (hand-synced compose, the plugin jar copy, the deploy
   entrypoint), [nats-auth-inplace.md](nats-auth-inplace.md) (the live NATS file and the `needs manual` NATS item), and
   [`deploy/README.md`](../../deploy/README.md) (scripts, rollback, admin verbs, NATS regeneration near lines 300 to
   320). [merge-queue.md](merge-queue.md) rule (b) repeats when a merge deploys.
2. **Creating NATS users.** The three runbook instructions now agree (in place with SIGHUP; kino.md and skins.md point
   to nats-auth-inplace.md). `deploy/README.md` still describes regenerate and restart; see open conflict 1.
3. **CoreProtect is covered twice.** block-owner.md lists config keys (lines 56 to 67); coreprotect.md (line 45) says
   it does not list them. node-only-config.md item 2 adds the node side.
4. **Block ownership subjects** are described in kino.md (line 57) and again in block-owner.md.
5. **First admin** steps are in mcp-tokens.md and open-signup.md Section 5 (the latter points to the former).
6. **The node's compose sync check.** map-chat-panel.md ("Shipped versus node-only drift", line 144) gives a manual
   diff; node-only-config.md item 3 (line 23) says no sync check exists. Both are true only if "sync check" means an
   automated one.
7. **BlueMap heads and aliases** are in skins.md and node-only-config.md item 8.

## New runbooks (O01 to O10, wave W3)

From the documentation plan. All ten files exist in this folder on 2026-11-16; other writers wrote them in the same
wave. Review W3-a checked their references read-only on 2026-11-16 (about 90 checks) and its findings were applied in
the W3 fix pass, but no reviewer has passed them since, so the index column says "not checked" and every status stays
`draft`.

Fixed in the W3 fix pass (2026-11-16): incident-response.md gates `colo-rollback.sh` on the owner's window (it ends in
a whole-stack `up`), sends an abuse report to an identity ban under decision 0136 instead of a retire, names the
shared-Caddy restart harm, adds the fourth `colo-notice.sh` argument, a recovery check and the meaning of **(a-n)**.
rotate-secrets-by-role.md drops the dev secrets folder, key-file pointer and container file paths, and adds the
Postgres precondition for the pepper re-create. retire-an-agent.md marks the Death column and the `players up` undo
as inferred, with their evidence, and fixes the `FROM_STATUS` lines. backup-and-restore.md checks
`GELDAR_STATE_DIR` before reading. Measured results in add-a-contract-schema.md, add-a-migration.md and
release-a-prompt-version.md were re-run at 09:22 UTC.

| Id | Runbook | Audience | References checked by writer | Status | Last verified (its own block) |
|---|---|---|---|---|---|
| O01 | [bring-up-phase0-shard.md](bring-up-phase0-shard.md) | operators | not checked | draft | 2026-11-16 at `03c1f5de` |
| O02 | [backup-and-restore.md](backup-and-restore.md) | operators | not checked | draft | 2026-11-16 at `03c1f5de` |
| O03 | [rotate-secrets-by-role.md](rotate-secrets-by-role.md) | operators | not checked | draft | 2026-11-16 at `03c1f5de` |
| O04 | [add-a-contract-schema.md](add-a-contract-schema.md) | contributors | not checked | draft | 2026-11-16 at `03c1f5de` |
| O05 | [add-a-migration.md](add-a-migration.md) | contributors | not checked | draft | 2026-11-16 at `03c1f5de` |
| O06 | [release-a-prompt-version.md](release-a-prompt-version.md) | agents-never | not checked | draft | 2026-11-16 at `03c1f5de` |
| O07 | [add-a-decision-record.md](add-a-decision-record.md) | contributors | not checked | draft | 2026-11-16 at `03c1f5de` |
| O08 | [incident-response.md](incident-response.md) | operators | not checked | draft | 2026-11-16 at `03c1f5de` |
| O09 | [world-and-memory-reset.md](world-and-memory-reset.md) | owner | not checked | draft | 2026-11-16 at `03c1f5de` |
| O10 | [retire-an-agent.md](retire-an-agent.md) | operators | not checked | draft | 2026-11-16 at `03c1f5de` |

Gaps seen while indexing that the plan does not list: the geldar-core jar copy and Paper restart (map-chat-panel.md
step 1.2 says "the normal geldar-core deploy"; node-only-config.md item 7 says the copy step is not in the repo), and
token minting (`deploy/colo-admin.sh token-mint`, described only in `deploy/README.md`).

## Repo tests that read runbooks

Five tests read runbook text. Edit these runbooks with the test open; the metadata block was checked against each.

| Test | Runbook | What it asserts |
|---|---|---|
| `deploy/test/install-body-helper-runbook.test.ts` | body-helper-node-steps.md, nats-auth-inplace.md | Step order, prohibitions, rollback lines, no secret-shaped values, no run of 40 base64 characters |
| `tools/repo-checks/src/nats-auth-runbook.test.ts` | body-helper-node-steps.md | NATS subjects per user match `geldar.ps1`; PubDeny lines |
| `tools/repo-checks/src/open-signup-runbook.test.ts` | open-signup.md | `REGISTER_*` names match `compose/colo.yml`; no UUID; no run of 32 or more characters from `[A-Za-z0-9+/_-]` (so its metadata names decisions instead of linking long slugs) |
| `deploy/test/kino-deploy.test.ts` | kino.md | Names `REGISTER_MS_CLIENT_SECRET_FILE`; no client secret value |
| `plugins/bluemap/test/sky-wiring.test.ts` | map-chat-panel.md | Holds the exact `scripts` line |

No other test, script or workflow reads runbook text: `grep` for `runbooks/` outside `docs/` finds only these five
tests plus comments and README pointers (2026-11-16, at `03c1f5de`).

After the W3 body pass the text assertions of all five tests were re-run by a plain Node script that ports each
assertion (Vitest could not run: no `node_modules` in the writer's worktree). Result on the edited files: 124
assertions, 0 failures; the same script on the files at `03c1f5de` also gives 124 and 0, and a mutated copy fails as
expected. The script ports the open-signup compose parse with a line-based reader instead of the `yaml` package. Run
the real tests once before merge: `./geldar.ps1 pnpm test install-body-helper-runbook nats-auth-runbook
open-signup-runbook kino-deploy sky-wiring`.
