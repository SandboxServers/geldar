---
title: Incident response
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, ../operations/failure-modes.md, ../operations/README.md, colo-deploy.md, maintenance-notice.md, open-signup.md, nats-auth-inplace.md, backup-and-restore.md, rotate-secrets-by-role.md, retire-an-agent.md, world-and-memory-reset.md, ../concepts/world-operations-exceptions.md, ../threat-model.md]
sources: [docs/spec.md, ../operations/failure-modes.md, ./colo-deploy.md, ./open-signup.md, ./nats-auth-inplace.md, ./maintenance-notice.md, ./backup-and-restore.md, ./rotate-secrets-by-role.md, ./retire-an-agent.md, ./world-and-memory-reset.md, ./body-helper-node-steps.md, ./kino.md, ../concepts/world-operations-exceptions.md, ../operations/monitoring-and-vitals.md, ../reference/deploy-scripts.md, ../reference/register-service.md, ../reference/mcp-tools.md, ../reference/cli-tools.md, deploy/colo-status.sh, deploy/colo-public.sh, deploy/colo-admin.sh, deploy/colo-notice.sh, deploy/colo-rollback.sh, deploy/colo-down.sh, deploy/common.sh, threshold/register/src/config.ts, glass/src/config.ts, plugin/core/src/main/resources/config.yml, ../decisions/0071-public-endpoints-and-ports.md, ../decisions/0072-glass-and-bluemap-are-public.md, ../decisions/0076-backup-scope-and-destination.md, ../decisions/0091-public-mcp-behind-caddy.md, ../decisions/0093-glass-hardening.md, ../decisions/0094-public-sites-read-only-through-caddy.md, ../decisions/0136-register-ban-procedure.md, ../decisions/0152-programmatic-body-management-for-owners.md, deploy/README.md, tools/mcp-tokens/src/cli.ts, ../decisions/0137-public-spectator-proxy-is-separate-and-online.md, ../decisions/0153-terms-consent-and-deletion-before-sign-up.md, ../decisions/0169-players-host-restart-policy.md, ../decisions/0339-journal-reset-one-time-exception.md, ../decisions/0350-telemetry-scope-and-full-capture.md]
---

# Incident response

Use this when something on the Colo stack is broken, exposed or misbehaving: contain it with the narrowest switch the repo has, recover, and record what you did, without any human acting in the world.

**Untested.** Every step below comes from an existing runbook, script or decision, cited in place. None was run for this page, and no node, VM, database or world was read (plan decision D8). The spec describes a fuller system (alerts, an incident log, three kill-switch commands) that does not exist yet; [what exists](#what-spec-88-asks-for-and-what-exists) lists the difference.

To find the likely cause of a symptom, use [failure modes](../operations/failure-modes.md). To understand why world actions are off limits, read [world-operations exceptions](../concepts/world-operations-exceptions.md).

## Before you start

You need:

- Shell access to the Colo node as the operator account, by the self-hosted runner's account or the owner's own SSH access. The repo names no host or user (`deploy/README.md`, "Runner or SSH"; [network and trust zones](../architecture/network-and-trust-zones.md)).
- The rules in [failure modes, rules that apply to every row](../operations/failure-modes.md#rules-that-apply-to-every-row). The ones that matter most under pressure:
  - **No human acts in the world.** Never teleport, hand-fix, give items, place or break blocks, or edit an agent's memory ([spec 2](../spec.md#2-principles) principle 1; [spec 11](../spec.md#11-runbook): "Never teleport or hand-fix", "Someone wants to 'just drop one diamond': No.").
  - Never `docker compose down -v`. Never run `shard nats-auth` on the node. Never restart NATS ([open-signup global rules](open-signup.md#global-rules-every-step) 3 and 4).
  - Never print or paste a secret value (same, rule 2).

Who decides what:

| Decision | Who | Evidence |
|---|---|---|
| Any world-operations exception (the "never" row below) | The owner, by an order for that one change, with a decision record | [0339](../decisions/0339-journal-reset-one-time-exception.md); [world-operations exceptions](../concepts/world-operations-exceptions.md#what-keeps-an-exception-bounded) |
| A Paper recreate or a whole-stack `up` | The owner agrees the window | [open-signup](open-signup.md#global-rules-every-step) rules 5 and 10 |
| Opening sign-up again (`REGISTER_KILL_SWITCH=false`) | The owner, an explicit written yes | [open-signup owner gate](open-signup.md#owner-gate) |
| Restoring a database dump | The owner | [backup and restore](backup-and-restore.md#while-no-backup-exists) item 3 |
| Each in-place NATS change | The owner gives the go per batch | [runbooks index](README.md#index), nats-auth-inplace row |
| Containment with a switch listed in step 4, and reading state | The node operator, except `colo-rollback.sh` and `colo-down.sh`: both touch the whole project and need the owner's window, as the row above | the cited runbooks; step 4 notes |
| Banning an owner's identity after an abuse report | The operator ([decision 0136](../decisions/0136-register-ban-procedure.md): "Who bans: the operator"); 0136 names no approver | [0136](../decisions/0136-register-ban-procedure.md) |
| Retiring a player | The player's owner; the operator runs it when that owner asks | [retire-an-agent](retire-an-agent.md); decision [0152](../decisions/0152-programmatic-body-management-for-owners.md) item 1 |

**(a-n)** after a link marks a document labelled `audience: agents-never`, as in the [doc-update map](../agents/doc-update-map.md).

## Steps

### 1. Start the log

Write the UTC start time and what you see. Then write one line for every step you take: date, step, result, who ran it, and no values ([open-signup](open-signup.md#global-rules-every-step) rule 9). Work one step at a time and verify each before the next (same, rule 1).

### 2. Look before you touch

Run only read-only commands first:

```sh
deploy/colo-status.sh            # node env values, then docker ps -a and docker stats for the project only
deploy/colo-admin.sh player-list # each sovereign player host: running, exited, created or dead
deploy/colo-public.sh status     # each public site: not installed, on or off (files only; not what Caddy loaded)
```

Evidence: [colo-down.sh and colo-status.sh](../reference/deploy-scripts.md#colo-downsh-and-colo-statussh); [colo-admin.sh](../reference/deploy-scripts.md#colo-adminsh); [colo-public.sh](../reference/deploy-scripts.md#colo-publicsh).

If a deploy ran recently, read its job summary in GitHub Actions, including the "needs manual" list ([colo-deploy](colo-deploy.md#needs-manual)), and `cd.log` in the node's state directory ([deploy-scripts, node state](../reference/deploy-scripts.md#node-state-these-scripts-write)).

On a local stack, use `./geldar.ps1 shard status <name>` and `./geldar.ps1 shard logs <name> [service]` ([shard actions](../reference/cli-tools.md#shard-actions)).

Find the symptom in [failure modes](../operations/failure-modes.md) and note the component and its blast radius.

### 3. Decide what kind of problem it is

The owner's 2026-11-14 ruling sorts operator changes into three kinds ([world-operations exceptions, what counts](../concepts/world-operations-exceptions.md#what-counts); recorded in an analysis file, not yet a decision record).

| Kind | Examples | What you may do |
|---|---|---|
| Infrastructure | Hosts, deploys, limits, the record, a Body or gateway defect where a verb does not do what it says | Fix it. Continue with step 4 |
| World rules and agent-visible text | Gamerules, the world border, shard toggles, text agents read | Only by a recorded decision at a change window. Stop and tell the owner |
| Never | Moving a Body, editing an agent's memory, giving or removing items, placing or breaking blocks | Not done. Only the owner can order an exception, one time, with a decision record; the owner's procedure for a reset is [world-and-memory-reset](world-and-memory-reset.md) |

An agent that is hungry, lost, stuck or dying is not an incident. Spec 2, principle 1: "If something breaks, fix the infrastructure, not the story."

### 4. Contain: pick the narrowest switch

Use the switch whose blast radius matches the problem. Each row names its own undo.

| Scope | Switch | Takes effect | Undo | Evidence |
|---|---|---|---|---|
| One sovereign player's Body | `deploy/colo-admin.sh player-stop <player-id>` | At once; stops and removes that one container | `deploy/colo-admin.sh player-start <player-id>` | [colo-admin.sh](../reference/deploy-scripts.md#colo-adminsh); decision [0169](../decisions/0169-players-host-restart-policy.md) |
| The public MCP, now | `deploy/colo-public.sh off mcp`, then restart the MCP container | After Caddy loads the swap; decision 0091 says to restart the MCP container after the swap because closing open streams was unverified, and gives no command for it | `deploy/colo-public.sh on mcp` | [0091](../decisions/0091-public-mcp-behind-caddy.md) item 4; [0094](../decisions/0094-public-sites-read-only-through-caddy.md) item 4 |
| The public MCP, lasting | `public.kill_switch: true` in the shard file | At the next MCP start; every public request gets 503 before authentication | Set it back and restart | [0091](../decisions/0091-public-mcp-behind-caddy.md) item 4; [HTTP refusals](../reference/mcp-tools.md#http-refusals) |
| New sign-ins | Set `REGISTER_KILL_SWITCH=true` and recreate the register service only | At the register start; anything but exactly `false` keeps it on (`threshold/register/src/config.ts` line 155) | Only with the owner's written yes | [open-signup rollback summary](open-signup.md#rollback-summary); [kino kill switch](kino.md#kill-switch) item 4 **(a-n)** |
| The Glass site | `deploy/colo-public.sh off glass`; or `GELDAR_GLASS_ENABLED=false` and a restart of Glass | Caddy swap: after Caddy loads it. The flag: at the Glass start (`glass/src/config.ts` line 143) | `on glass`; unset the flag and restart | [0072](../decisions/0072-glass-and-bluemap-are-public.md); [0093](../decisions/0093-glass-hardening.md); the Glass off file also covers the register paths ([register-service](../reference/register-service.md#build-test-and-deploy)) |
| Kino | The kill switch in [kino](kino.md#kill-switch) **(a-n)** | As that runbook says | As that runbook says | [kino](kino.md) |
| The public map | `deploy/colo-public.sh off map` | After Caddy loads the swap | `deploy/colo-public.sh on map` | [0094](../decisions/0094-public-sites-read-only-through-caddy.md) item 4 |
| Every public site | `deploy/colo-public.sh off all` | After Caddy loads the swaps | `deploy/colo-public.sh on all` | [colo-public.sh](../reference/deploy-scripts.md#colo-publicsh) |
| The in-game maintenance line | `maintenance.broadcast: false` in the Geldar-Core `config.yml` | Within 5 seconds; a queued line is dropped too | Set it to `true` | [maintenance-notice](maintenance-notice.md#switching-it-off) |
| A bad release | `deploy/colo-rollback.sh`, only in the owner's agreed window | Ends with `dc up -d --wait --pull never` on the whole project (last lines of the script): a whole-stack `up`, which recreates any service whose image or config differs from the running one, Paper included (open-signup rules 5 and 10) | Run it again to go forward, in the same window | [colo-deploy rollback](colo-deploy.md#rollback); `deploy/colo-rollback.sh` |
| The whole Colo project | `deploy/colo-down.sh` | Stops every container of the project; keeps containers, networks and volumes | A full `up`, which is a whole-stack `up` (owner's window, rule 5 and 10) | [colo-down.sh](../reference/deploy-scripts.md#colo-downsh-and-colo-statussh) |

Notes on the table:

- **Caddy apply mode.** Each `colo-public.sh` swap is applied by `caddy reload`, by one container restart, or not at all, per `GELDAR_PUBLIC_APPLY`; `restart` needs `GELDAR_PUBLIC_RESTART_OK=1`, otherwise the script prints a note to restart Caddy by hand ([colo-public.sh](../reference/deploy-scripts.md#colo-publicsh)). `deploy/README.md` (the `GELDAR_PUBLIC_APPLY` row, about line 366) calls `restart` "the Colo setting"; the node's own value was not read for this page. Until Caddy has loaded the off file, the site is still on. See [conflict 2](#conflicts-recorded).
- **A Caddy restart interrupts the node's other sites.** The Caddy is shared: a restart, by the script or by hand, drops every site it serves, not only Geldar's ([decision 0071](../decisions/0071-public-endpoints-and-ports.md) item 6). Every `off` or `on` row that goes through `colo-public.sh` carries that harm in `restart` mode; say so to the owner before you use one.
- **The rollback is not a narrow switch.** `colo-rollback.sh` runs a whole-stack `up` (row "A bad release"), so it needs the owner's window like `colo-down.sh` below.
- **Stopping the whole project stops Paper.** Treat `colo-down.sh` like a Paper recreate and get the owner's word first, unless the owner has already said otherwise (inferred from [open-signup](open-signup.md#global-rules-every-step) rule 5; no runbook covers an emergency stop). Whether `docker compose stop` lets Paper save the world cleanly was not checked for this page.
- **The public bot ingress.** `compose/colo-public.yml` publishes the offline-mode bot ingress, against decision [0137](../decisions/0137-public-spectator-proxy-is-separate-and-online.md) (a known gap, [velocity-identity-plugin](../reference/velocity-identity-plugin.md#known-gaps)). The deploy merges that overlay only when both `GELDAR_MC_BIND` and `GELDAR_MC_PORT` are set (`public_overlay` and `dc` in `deploy/common.sh`). Removing an existing publish needs a recreate of the `velocity` service; no runbook covers it. Take it to the owner.
- **Never a world action.** None of these switches moves an agent, changes a block or edits a memory. If you think one is needed, stop: step 3, row "Never".

### 5. Tell players, only if the owner wants it

`deploy/colo-notice.sh [--dry-run] <pause|restart|back> <bodies|world|mcp> [seconds 0-600|-] [update|plugin_update|config]` (usage, line 3 of the script) publishes one maintenance notice; the plugin says one fixed line, never free text ([colo-notice.sh](../reference/deploy-scripts.md#colo-noticesh); [what players see](maintenance-notice.md#what-players-see)). Use `--dry-run` first. A failed publish exits 0 with a warning unless `COLO_NOTICE_STRICT=1`.

The line is in-world text that agents read ([paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads), "In-world text"). The maintenance-notice runbook says only the deploy publishes it, and no runbook covers a notice outside a deploy ([conflict 3](#conflicts-recorded)). Ask the owner before you send one.

### 6. Recover

Follow the runbook that the component's row in [failure modes](../operations/failure-modes.md) names. The recoveries the repo has:

| Problem | Recovery | Limits | Evidence |
|---|---|---|---|
| A bad release | In the owner's agreed window: `deploy/colo-rollback.sh` on the node (a whole-stack `up`, step 4 notes); or `gh workflow run colo-deploy.yml -f sha=<older sha on main> -f plan_only=true`, read the plan, then dispatch without `plan_only` | Does not undo migrations. Decide with the owner before rolling back a release that changed the schema | [colo-deploy rollback](colo-deploy.md#rollback); [backup and restore](backup-and-restore.md#while-no-backup-exists) item 4 |
| A player host stopped or exited | `deploy/colo-admin.sh player-start <player-id>` for that host | A host stopped by hand stays down after a node reboot; a host that a reboot stopped restarts by itself (decision [0342](../decisions/0342-body-hosts-unless-stopped.md)) | [colo-deploy, per-player host containers](colo-deploy.md#per-player-host-containers); decision [0169](../decisions/0169-players-host-restart-policy.md) |
| A NATS config change went wrong | Restore the backup in place with `cat`, check its sha256, send SIGHUP, read the NATS log | Whether a reload closes live sessions is not verified | [nats-auth-inplace](nats-auth-inplace.md) (rollback in the procedure; [client impact](nats-auth-inplace.md#client-impact)) |
| A failed body helper install | The rollback in the helper runbook | None recorded | [body-helper-node-steps](body-helper-node-steps.md) |
| A secret or a player token may be exposed | Rotate it by its role; for one player's MCP token, follow the token section | Describe the secret by role in the log, never its value or location | [rotate-secrets-by-role](rotate-secrets-by-role.md); [rotate a player's MCP token](rotate-secrets-by-role.md#rotate-a-players-mcp-token) |
| An abuse report against a player's owner | Ban the owner's registered identity with `mcp-tokens identity ban` | The operator bans ([decision 0136](../decisions/0136-register-ban-procedure.md)). A ban revokes every live token of that owner and refuses new ones; the owner's players stay `active` and nothing is retired. No runbook covers the ban yet; follow 0136. To stop a Body at once, use `player-stop` (step 4) | [0136](../decisions/0136-register-ban-procedure.md); `tools/mcp-tokens/src/cli.ts` usage lines 68 to 74 |
| The player's owner asks to take a player out | Retire the player | Only on that owner's request (0152 item 1). Retire is not deletion, and cannot be undone; erasure follows the account-deletion rules | [retire-an-agent](retire-an-agent.md); [account-deletion](account-deletion.md) **(a-n)** |
| Data lost or corrupted | None in the repo. Stop and escalate to the owner. Never restore one store alone | The only copy is a pre-migration `pg_dump` taken by a CD run that changed `sql/` | [backup and restore](backup-and-restore.md#while-no-backup-exists); [spec 11](../spec.md#11-runbook) "Restore from checkpoint"; decision [0076](../decisions/0076-backup-scope-and-destination.md) |

### 7. Reopen

Reverse the switches you used, one at a time, in the reverse order, verifying each (the "Undo" column in step 4). Sign-up opens again only with the owner's written yes ([open-signup owner gate](open-signup.md#owner-gate)).

**Verify recovery:** run the three read-only commands from step 2 again and compare with what you logged in step 1: every container of the project running and healthy in `colo-status.sh`, each player host back in `player-list` as before, and each public site in `colo-public.sh status` back to its state before the incident.

### 8. Record

1. Finish the step log from step 1.
2. If the owner ordered a world-operations exception, it needs a decision record that names it one-time, a backup first, a logged time window, and a return to the standing rule ([what keeps an exception bounded](../concepts/world-operations-exceptions.md#what-keeps-an-exception-bounded); [0339](../decisions/0339-journal-reset-one-time-exception.md)). Ask for the next free decision number.
3. Spec 8.8 asks for an incident log in `docs/incidents.md`, with a one-paragraph post-mortem for every alert that turns out to matter. That file does not exist at `03c1f5de`. The repo is public: a post-mortem written there may hold no secret, secret location, address, host name, account or personal name, and no observation detail ([documentation style](../agents/documentation-style.md#what-never-goes-in-a-document)). Whether to start that file, or keep incident notes elsewhere, is the owner's decision.
4. If a runbook step was wrong or missing, file it for a docs change; do not edit `docs/spec.md` (decision 0073).

## What spec 8.8 asks for and what exists

Spec [8.8](../spec.md#88-logging-detection-response) against the repo at `03c1f5de`.

| Spec 8.8 item | In the repo | Evidence |
|---|---|---|
| Append-only audit log, shipped off-host | Append-only tables in Postgres (`register_audit`, the journal tables, the Kino audit). Nothing ships them off-host | [database triggers](../reference/database-schema.md#triggers); [backup and restore](backup-and-restore.md#what-has-no-copy) |
| Alerts to the owner (mTLS failures, Thinker rate limits, agent command attempts, ghost chat, TPS under 12, spend ceiling, backup failure and others) | None built; the alert channel is not chosen | [monitoring-and-vitals, alerts](../operations/monitoring-and-vitals.md#alerts) **(a-n)**; decision [0350](../decisions/0350-telemetry-scope-and-full-capture.md) |
| `geldar thinker revoke <name>` | Not in the repo. No Thinker path exists on the Colo | `git grep` outside `docs/spec.md` finds none of the three commands (2026-11-16); [lantern-thinker-protocol](../reference/lantern-thinker-protocol.md#on-the-colo) |
| `geldar gateway drain` | Not in the repo. No gateway code exists | same |
| `geldar shard freeze` (stops Bodies, Paper saves) | Not in the repo. Nearest: `deploy/colo-down.sh` (stops the project), `colo-admin.sh player-stop` per player | same; step 4 |
| Incident log `docs/incidents.md` | Does not exist | `ls docs`, 2026-11-16 |

Spec [11](../spec.md#11-runbook) entries that bear on incidents:

| Spec 11 entry | In the repo |
|---|---|
| An agent is stuck: the Body's watchdog injects a `stuck` event and restarts the Body after 3 cycles; never teleport or hand-fix | The snapshot has a `stuck` field and the Body has a stall watchdog; the restart after 3 cycles was not found: unverified ([failure modes, Golem](../operations/failure-modes.md#golem-body)). The rule "never teleport or hand-fix" stands |
| Server lag: check Spark | spark is bundled in Paper (`compose/paper/paper-entrypoint.sh` line 62); no repo runbook gives its commands |
| Restore from checkpoint: restore every component from one manifest, never one alone | No checkpoint exists ([backup and restore](backup-and-restore.md)) |
| A Patron host goes offline: the Allocator re-homes agents | No Allocator in the repo (`git grep -l -i allocator -- '*.ts' '*.java'` finds nothing, 2026-11-16) |
| "Just drop one diamond": No | Stands (Principle 1) |

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **Spec kill switches.** Spec 8.8 names three `geldar` commands; the repo has per-service switches instead (table above). The spec is not edited (decision 0073).
2. **Caddy reload or restart.** Decision [0071](../decisions/0071-public-endpoints-and-ports.md) item 6 and `deploy/caddy/README.md`: reload, never restart. `deploy/README.md` and the `restart` mode of `colo-public.sh`: one operator restart, because the shared Caddy's admin API is off (owner ruling R39, not a decision record). Decision 0091 item 4 calls the MCP off switch a "Caddy swap and reload". Which applies on the node decides how fast every Caddy switch in step 4 works ([network-and-trust-zones conflict 3](../architecture/network-and-trust-zones.md#conflicts-recorded)).
3. **Who publishes maintenance notices.** [maintenance-notice](maintenance-notice.md#permissions): "Only the deploy publishes it." `deploy/colo-notice.sh` is a standalone script any operator can run, and [cli-tools](../reference/cli-tools.md#commands-that-change-shared-state) lists the admin `notice` among operator commands. Step 5 asks the owner first.
4. **Sign-up switch wording.** Decision [0153](../decisions/0153-terms-consent-and-deletion-before-sign-up.md) point 3: "the kill switch stays off" until the gate opens; its own Context and the code: the switch is on by default and sign-up is closed while it is on (`threshold/register/src/config.ts` line 155). Step 4 follows the code and the open-signup runbook.
