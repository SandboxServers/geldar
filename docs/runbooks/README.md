---
title: "Runbooks index"
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [../README.md, ../decisions/README.md, ../../deploy/README.md]
sources: [docs/runbooks, tools/repo-checks/src, deploy/test]
---

# Runbooks

A runbook is a how-to: one goal, the steps to reach it, and how to undo them. This index lists every runbook in this
folder, what it is for, who it is for, which part of Geldar it covers, and how far its references were checked.

This folder is operator documentation. Several runbooks describe Glass, Kino, thoughts, journals and progress metrics.
Never copy any of it into a prompt, skill, kit file, tool text, `identity.md`, player repo or sign.

## How to read the status columns

- **Status** uses the one definition in the [documentation style](../agents/documentation-style.md#metadata-block):
  `verified` only after a reviewer has passed the runbook against the commit in its `last_verified`; `draft` until
  then; `stale` when a source changed since. No runbook has passed a review yet, so all 19 are `draft`.
- **References checked by writer**: `yes` means the index writer found every repo file, script, CLI verb and config
  key the runbook names in the repo on 2026-11-16 at commit `cd4499da`, with no contradiction with the code. `no`
  means at least one reference is missing, stale or contradicts the code or another runbook; the reason is in
  [What could not be checked](#what-could-not-be-checked). Neither value means the procedure was run or works on the
  Colo node. No node, VM, database or world was read for this index (owner default D8).
- **Last verified** is the date and commit of the writer's repo check above, and nothing more.
- **Audience** `agents-never` marks an operator runbook whose goal is to set up, show or measure an observation
  surface (Glass, Kino, thoughts, journals, telemetry, progress metrics, the public map). `operators` covers node and
  stack work, even when one step touches an observation surface (open-signup.md installs the Glass as one of many
  steps). `contributors` covers repo and test work.
- **Component (role-owner)** names the part of Geldar and the role that runs the runbook (owner default D3: a role,
  never a person). "Node operator" is the role that holds the Colo node.

## Index

| Runbook | Goal | Audience | Component (role-owner) | Files and commands it references (checked 2026-11-16) | References checked by writer | Status | Last verified | Read first |
|---|---|---|---|---|---|---|---|---|
| [account-deletion.md](account-deletion.md) | Understand and run an owner's account deletion, and clean up after a self-serve one | agents-never | Register service (node operator, on the owner's written request) | `sql/test/check-schema-account-delete.sql`, migrations `0039`/`0040`, `deploy/colo-admin.sh player-stop`, `./geldar.ps1 players status/down`, `threshold/register/src/api/account-export.ts` | no | draft | 2026-11-16 at `cd4499da` | Decisions [0171](../decisions/0171-account-erasure-rule.md) and [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md); SQL access as the register role |
| [block-owner.md](block-owner.md) | Configure CoreProtect for the block owner bridge and run its live checks | operators | geldar-core plugin and CoreProtect (node operator) | `plugins/coreprotect/coreprotect.lock.json`, `blockowner:` keys in `plugin/core/src/main/resources/config.yml`, `contract/schemas/block-owner.schema.json` | no | draft | 2026-11-16 at `cd4499da` | [coreprotect.md](coreprotect.md); decision [0165](../decisions/0165-block-owner-subjects.md) |
| [body-helper-node-steps.md](body-helper-node-steps.md) | Install the root-owned body helper unit on the Colo node and wire its NATS users | operators | Body helper systemd unit (node operator, owner go per step) | `deploy/install-body-helper.sh`, `deploy/body-helper-node.env`, `body-helper/src/helperConfig.ts`, `.github/workflows/body-helper-bundle.yml`, `geldar.ps1` `Get-NatsUsers` | no | draft | 2026-11-16 at `cd4499da` | [nats-auth-inplace.md](nats-auth-inplace.md); decision [0260](../decisions/0260-body-container-control-by-host-helper.md) |
| [chunky.md](chunky.md) | Pregenerate world chunks with Chunky without overloading the server | operators | Paper plugins (node operator) | `plugins/chunky/README.md`, `plugins/chunky/chunky.lock.json`, `render-thread-count` in `plugins/bluemap/config/core.conf` | yes | draft | 2026-11-16 at `cd4499da` | Paper console access |
| [colo-deploy.md](colo-deploy.md) | Understand, dispatch, plan-only and roll back a Colo deploy from GitHub Actions | operators | CD pipeline and self-hosted runner (owner for runner and settings; node operator for "needs manual") | `.github/workflows/colo-deploy.yml`, `deploy/colo-cd.sh`, `deploy/colo-rollback.sh`, `deploy/colo-status.sh`, `deploy/test/colo-fetch-manifest.test.ts` | no | draft | 2026-11-16 at `cd4499da` | [`deploy/README.md`](../../deploy/README.md); decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) |
| [coreprotect.md](coreprotect.md) | Verify the pinned CoreProtect jar and set its config by hand on first start | operators | Paper plugins (node operator) | `plugins/coreprotect/coreprotect.lock.json`, `fetch_coreprotect` in `deploy/common.sh`, `deploy/colo-up.sh`, `modrinth:Lu3KuzdV@24.1` in `tools/repo-checks/src/release-dates.json` | yes | draft | 2026-11-16 at `cd4499da` | Nothing; then [block-owner.md](block-owner.md) |
| [glass-aliases.md](glass-aliases.md) | Show public aliases instead of stored agent names in Glass, Kino and the map | agents-never | Glass (node operator) | Alias mount and `GELDAR_ALIASES_FILE` in `compose/colo.yml`, `plugins/bluemap/README.md`, `plugins/bluemap/test/alias-format.test.ts` | yes | draft | 2026-11-16 at `cd4499da` | Root access to the node state directory |
| [kino.md](kino.md) | Enable, kill and audit Kino; capture evidence with kino-shot | agents-never | Glass Kino (owner enables; node operator applies) | `compose/colo-kino.yml`, `compose/colo-kino-session.yml`, `deploy/colo-public.sh`, `deploy/caddy/validate.sh`, `deploy/caddy/glass-off.caddy`, `glass/web/kino/`, `glass/test/kino-preview/server.ts`, `tools/kino-shot` (`browsers`, `shot`) | no | draft | 2026-11-16 at `cd4499da` | Decisions [0075](../decisions/0075-glass-is-a-lakitu-camera.md) and [0166](../decisions/0166-kino-monitor-wall-and-lakitu-camera.md); [glass-aliases.md](glass-aliases.md) |
| [maintenance-notice.md](maintenance-notice.md) | Know what players see during a deploy restart and switch the broadcast off | operators | Deploy and geldar-core plugin (node operator) | `contract/schemas/maintenance-notice.schema.json`, `maintenanceSubject()` in `contract/src/subjects.ts`, `maintenance.broadcast` in the plugin `config.yml`, its log lines in `plugin/core` | yes | draft | 2026-11-16 at `cd4499da` | [colo-deploy.md](colo-deploy.md) |
| [map-chat-panel.md](map-chat-panel.md) | Deploy the public map chat panel and time-of-day dial by hand, check and roll back | agents-never | BlueMap web and geldar-core (node operator; owner approval for the Paper restart) | `compose/bluemap-web/Caddyfile`, `plugins/bluemap/web/geldar-{chat,sky}.js`, `deploy/genesis/config-bundle.list` lines 54 to 56, `dc` in `deploy/common.sh` | no | draft | 2026-11-16 at `cd4499da` | Decision [0310](../decisions/0310-live-chat-panel-on-the-map.md); [node-only-config.md](node-only-config.md) |
| [mcp-tokens.md](mcp-tokens.md) | Add a sovereign player to the roster, set the first admin, set a player's public flags | agents-never | MCP tokens and roster (node operator) | `tools/mcp-tokens/src/cli.ts` (`roster`, `player flags`), `deploy/colo-admin.sh` (`roster-add`, `owner-set-cap`, `roster-list`, `owner-admin`, `player-flags`), `tools/admin/admin.sh` | yes | draft | 2026-11-16 at `cd4499da` | Decision [0108](../decisions/0108-mcp-roster-source-of-truth.md) |
| [merge-queue.md](merge-queue.md) | Create, check and roll back the merge queue ruleset on `main`, and queue PRs safely | contributors | GitHub repository settings (orchestrator) | `.github/workflows/ci.yml` (`merge_group`, `ci gate`), `.github/workflows/colo-images.yml`, `merge=union` in `.gitattributes`, `tools/repo-checks/src/decision-rows.ts` | yes | draft | 2026-11-16 at `cd4499da` | Decision [0220](../decisions/0220-merge-queue-for-main.md) |
| [nats-auth-inplace.md](nats-auth-inplace.md) | Change NATS users and permissions on the live node with a SIGHUP, not a restart | operators | NATS (node operator; owner go per batch) | `compose/nats-auth.yml`, `geldar.ps1` (`Initialize-NatsAuth`, `Get-NatsUsers`), `deploy/colo-notice.sh`, `threshold/mcp/test/nats-auth.it.test.ts`, `compose/opt-in/sheet-sink.yml` | no | draft | 2026-11-16 at `cd4499da` | Decisions [0080](../decisions/0080-nats-auth-cutover.md) and [0087](../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md) |
| [node-only-config.md](node-only-config.md) | Inventory what the Colo node holds that the repo does not reproduce | operators | Colo node (node operator; genesis owns the fixes) | `compose/colo.yml`, `compose/phase0.yml`, `deploy/colo-cd-plan.sh`, `golem/src/whitelist-house-body.ts`, `animus/src/colo-profile.test.ts`, `docs/analysis/genesis/plan.md` | no | draft | 2026-11-16 at `cd4499da` | [colo-deploy.md](colo-deploy.md) |
| [open-signup.md](open-signup.md) | Take the Colo node from sign-up closed to sign-up open, in order | operators | Register service and node (node operator; owner gate) | `deploy/gen-secrets.sh`, `deploy/colo-admin.sh migrate`, `deploy/colo-up.sh` lines 55 and 58, `deploy/colo-public.sh install glass`, `REGISTER_*` names in `compose/colo.yml` | no | draft | 2026-11-16 at `cd4499da` | [body-helper-node-steps.md](body-helper-node-steps.md), [nats-auth-inplace.md](nats-auth-inplace.md), [account-deletion.md](account-deletion.md) |
| [progress-metrics.md](progress-metrics.md) | Turn existing logs and samples into per-agent progress numbers per window | agents-never | `tools/progress-metrics` (operator) | `tools/progress-metrics/src/cli.ts` (all flags named), `tools/progress-metrics/sample.sh`, `tools/progress-metrics/export-glass.ts` | yes | draft | 2026-11-16 at `cd4499da` | Read access to node logs |
| [scratch-stack.md](scratch-stack.md) | Run a throwaway Phase 0 stack beside the live ones, then remove it | operators | Scratch test stack (operator; owner word for the Colo node) | `deploy/scratch/scratch.sh` (`up`, `status`, `down`), `compose/opt-in/scratch.yml`, `shards/character-fixture.yaml`, `tools/migrate/src/cli.ts` | no | draft | 2026-11-16 at `cd4499da` | `cd plugin; ./gradlew build`; [nats-auth-inplace.md](nats-auth-inplace.md) for the auth files |
| [signcheck-shard.md](signcheck-shard.md) | Run a throwaway vanilla Paper server to check sign facts and chat probes | contributors | Live-test fixture VM (contributor running live tests) | `compose/signcheck.yml` (profiles `core`, `rcon`) | no | draft | 2026-11-16 at `cd4499da` | Decision [0192](../decisions/0192-edit-sign-action.md) |
| [skins.md](skins.md) | Import ranger skins, upload a new one, and show skins in Kino and on the map | agents-never | Velocity identity plugin and `players-cli` (node operator; owner supplies the signed files) | `deploy/colo-admin.sh skin-import`, `tools/players-cli` (`skin set/show/heads`, `run heads`), `tools/players-cli/src/png.ts`, `plugins/bluemap/config/plugin.conf`, `AgentSkinSetup` in `plugin/core` | no | draft | 2026-11-16 at `cd4499da` | Decisions [0140](../decisions/0140-agent-skins.md) and [0250](../decisions/0250-skin-upload-visibility-and-export.md) |

Line numbers below are in the files as they stand after the metadata block was added (and, for coreprotect.md,
glass-aliases.md, maintenance-notice.md and node-only-config.md, after the `sources:` line the W0 review fixes added).

## What could not be checked

| Runbook | Why references checked by writer is "no" |
|---|---|
| account-deletion.md | Line 13 says the export half (C7-09b) "is not built", but the section at line 135 describes it and `threshold/register/src/api/account-export.ts` exists. Line 50 cites "(0025)" for the append-only audit table: that is migration `sql/0025_admin_flag_and_register_audit.sql`, not decision 0025. |
| block-owner.md | Line 50 says the lock file lands later ("once that lands"); `plugins/coreprotect/coreprotect.lock.json` exists. Line 68 says its CoreProtect key names are not checked against the 24.1 jar. Live checks 2 to 7 are marked unverified by the runbook itself. |
| body-helper-node-steps.md | Line 101 points to "the NATS secret rule above"; no such rule appears above it. Line 147 says the install script does not create `/opt/geldar`; nats-auth-inplace.md line 56 says the install script creates it. |
| colo-deploy.md | Line 26 says the job timeout is 40 minutes; `.github/workflows/colo-deploy.yml` line 48 sets `timeout-minutes: 30` (line 33 of the runbook also says 30). Line 63 says the compare status must be `ahead` or `identical`; the workflow (lines 89 to 92) and the runbook's own line 31 accept `identical` or `behind`. Lines 86 to 87 say `deploy/colo-cd.sh` is not in the repo; it is, and it prints `needs manual:` lines (line 336). |
| kino.md | Line 26 tells the reader to delete `nats-auth.conf` and rerun `shard nats-auth colo`. nats-auth-inplace.md line 225, body-helper-node-steps.md line 26 and open-signup.md line 29 forbid running that command on the node. |
| map-chat-panel.md | Line 61 says `bluemap-web` is at `compose/colo.yml` line 540; it is at line 541. |
| nats-auth-inplace.md | Lines 32, 50 and 56 say PR #415 is not merged; it is (merge commit `4bab81b3`), and `geldar.ps1` lines 411 to 413 hold the `supervisor`, `register` and `helper` users. Line 236 says to apply `./geldar.ps1 shard nats-auth <shard>` on the live node; line 225 of the same file forbids it. |
| node-only-config.md | Its line references into `compose/colo.yml` have drifted: the gamerule line is at 138 (cited 137), `profiles: ["adam"]` at 276 (cited 275), the whitelist one-shot near 674 (cited 671), the `node.env` note near 701 (cited 698). |
| open-signup.md | Lines 61 and 204 say PR #415 is not merged; it is (merge commit `4bab81b3`). The `REGISTER_NATS_*` pending marker still matches `compose/colo.yml` and its repo test. |
| scratch-stack.md | Line 56 says such a run "cannot test item 5"; the runbook defines no item 5. |
| signcheck-shard.md | Lines 13 and 76 name the live test `golem/test/live/edit-sign.live.test.ts`; no such file is in the repo (`git ls-files golem/test/live`). The edit_sign tests that exist are `golem/src/actions/edit-sign.test.ts` and `contract/test/edit-sign-action.test.ts`. |
| skins.md | Line 28 says to regenerate `nats-auth.conf` with `shard nats-auth colo` and recreate the NATS container. That conflicts with the in-place, SIGHUP-only rule in nats-auth-inplace.md. |

One note on a runbook whose references were checked "yes": mcp-tokens.md line 29 cites decision 0052 for the 0 to 50 owner cap range. The code
agrees (`deploy/colo-admin.sh` line 143, `tools/mcp-tokens/src/players.test.ts`), but the decision text names a cap of
20 and does not state the 0 to 50 range.

## Overlaps and duplicates

These are findings for a later change. No runbook text was changed for this index.

1. **Colo deploy facts are spread over four places.** [colo-deploy.md](colo-deploy.md) (the pipeline and rollback),
   [node-only-config.md](node-only-config.md) items 3, 7 and 14 (hand-synced compose, the plugin jar copy, the deploy
   entrypoint), [nats-auth-inplace.md](nats-auth-inplace.md) (the live NATS file and the `needs manual` NATS item), and
   [`deploy/README.md`](../../deploy/README.md) (scripts, rollback, admin verbs, NATS regeneration near lines 300 to
   320). [merge-queue.md](merge-queue.md) rule (b) repeats when a merge deploys.
2. **Creating NATS users has three conflicting instructions.** In place with SIGHUP (nats-auth-inplace.md,
   body-helper-node-steps.md, open-signup.md); delete and regenerate (kino.md line 26); regenerate and recreate the
   container (skins.md line 28). `deploy/README.md` also describes regeneration.
3. **CoreProtect is covered twice.** block-owner.md lists config keys (lines 53 to 66); coreprotect.md (line 45) says
   it does not list them. node-only-config.md item 2 adds the node side.
4. **Block ownership subjects** are described in kino.md (line 57) and again in block-owner.md.
5. **First admin** steps are in mcp-tokens.md and open-signup.md Section 5 (the latter points to the former).
6. **The node's compose sync check.** map-chat-panel.md ("Shipped versus node-only drift", line 144) gives a manual
   diff; node-only-config.md item 3 (line 23) says no sync check exists. Both are true only if "sync check" means an
   automated one.
7. **BlueMap heads and aliases** are in skins.md and node-only-config.md item 8.

## Planned runbooks (gaps)

From the documentation plan (ids O01 to O10, wave W3). None of these exist yet.

| Id | Planned file | Audience | Component | Sources named in the plan | Priority |
|---|---|---|---|---|---|
| O01 | `bring-up-phase0-shard.md` | operators | compose | `run-shard` skill, `compose/phase0.yml` | P1 |
| O02 | `backup-and-restore.md` | operators | deploy | spec section 6.8; a real procedure is unverified | P1 |
| O03 | `rotate-secrets-by-role.md` | operators | deploy | `deploy/gen-secrets.sh`, nats-auth runbook (roles only) | P1 |
| O04 | `add-a-contract-schema.md` | contributors | contract | `contract/scripts`, the CLAUDE.md rule | P2 |
| O05 | `add-a-migration.md` | contributors | sql | `sql/README`, `tools/migrate` | P2 |
| O06 | `release-a-prompt-version.md` | contributors | prompts | `prompts/README`, spec Appendix D | P2 |
| O07 | `add-a-decision-record.md` | contributors | docs | `docs/decisions/README.md`, repo-check decision gates | P3 |
| O08 | `incident-response.md` | operators | ops | spec sections 8.8 and 11, existing runbooks | P1 |
| O09 | `world-and-memory-reset.md` | owner | worldops | rescission decisions, town cutover notes | P1 |
| O10 | `retire-an-agent.md` | operators | register | account-deletion runbook, register, sql | P2 |

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
