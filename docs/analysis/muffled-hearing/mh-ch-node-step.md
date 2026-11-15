# MH-CH node step: the hearing subject deny

Decision 0199, record decision 9 (the hearing subject ACL). Packet MH-CH. For geldar-93 and geldar-worldops.

Status: this packet changes the generator in the repo only. Nothing is queued or applied to any node by it. The node change waits for a geldar-93 window and the owner go that the runbook requires. Scope: body, mind and mcp, as the owner instruction (geldar-93) asks; decision 0199 names body only.

## What changes in the generated config

The subject is `geldar.<s>.body.<lifeId>.hearing`. The deny is `geldar.<s>.body.*.hearing`: `*` matches exactly the life id token. Paper gets no deny. Only the plugin publishes a hearing notice.

Generator (`Get-NatsUsers` in `geldar.ps1`):

| Role | PubDeny before | PubDeny after |
|---|---|---|
| body | `"geldar.$s.kino.>", "geldar.$s.blockowner.changed", "geldar.$s.ctl.body.>", "geldar.$s.helper.body.>", "geldar.$s.state.*.level"` | the same list, plus `"geldar.$s.body.*.hearing"` at the end |
| mind | no PubDeny key | `PubDeny = @("geldar.$s.body.*.hearing")` |
| mcp | no PubDeny key | `PubDeny = @("geldar.$s.body.*.hearing")` |
| paper | unchanged | unchanged |

Rendered into the config, the publish clause of each of the three users gets one more deny entry, `deny: ["geldar.<s>.body.*.hearing"]` (body keeps its other entries). Mind and mcp had no deny clause before.

Why it works: body's allow `geldar.<s>.>` and the `geldar.<s>.body.>` allow of mind and mcp both match the hearing subject. The server takes deny before allow, so the deny removes it. Paper's allow `geldar.<s>.>` is then the only one left.

The live node's conf differs from the generator (runbook drift table). The change adds only the one deny entry per role and no other line.

## Procedure

The runbook `docs/runbooks/nats-auth-inplace.md` is the only procedure. It does not regenerate on the node: its Notes say "Do not run `./geldar.ps1 shard nats-auth colo` on the node". The steps, quoted or summarised from it:

- Step 0: "The owner go is recorded, and the window is agreed." Mind and mcp lose publish rights on the hearing subject, so "publish a maintenance notice first" applies.
- Step 1: back up the live conf with a UTC stamp; "Record the two sha256 values. They must match."
- Step 2: stage the new conf in a private directory outside `secrets/`. Passwords are copied from the existing per-user files, never typed. Add only the three deny entries above. "Both must print `http: "127.0.0.1:8222"`" (the monitor line must not change).
- Step 3: validate with `nats-server -t`; "Expect `is valid`." Diff the redacted old and new conf: the diff must show only the three deny entries.
- Step 4: "cat ... > ... live file", then check the mode is still `600`. "Do not run `mv`."
- Step 5: reload with SIGHUP, not a restart: `docker kill -s HUP <nats container>`. The log must show `Reloaded: authorization users`, `Reloaded: accounts` and `Reloaded server configuration`. The connection count returns to its pre-change value.
- Step 6: verify (below).
- Step 7: rollback (below).

The brief named "regenerate, copy, restart". The runbook uses the staged copy in place of regeneration and SIGHUP in place of restart. A restart drops every NATS client (`deploy/README.md`) and is not needed for this change.

## Check after the change

Run each check with the role's own client, never the admin account (runbook step 6).

1. Body client publishes to `geldar.<s>.body.<probeLifeId>.hearing`. Expect refusal, logged as `Permissions Violation`: `docker logs --since 5m <nats container> | grep -i 'permissions violation'`.
2. Mind client and mcp client: the same publish, the same refusal.
3. Paper client publishes to the same subject with a probe life id that no body subscribes to (a `<probeLifeId>` that is not a live life). Expect success and no `Permissions Violation` line. Do not use a real life id: a success would reach that life's body as a notice.
4. Each of body, mind and mcp still publishes one of its allowed subjects. (Runbook step 6: "one allowed publish still works".)
5. Body, mcp and eventsink are connected (connection count and `/connz`, read through `docker exec ... wget`). No new dead letters since the change.

## Rollback

- Repo: revert the MH-CH commit (the `geldar.ps1` and `nats-auth` test lines). Reverting alone changes no node.
- Node: runbook step 7. Copy the step 1 backup over the live conf with `cat`, check the sha256 equals the step 1 value, send SIGHUP, check the three `Reloaded` lines and the connection count. Do not regenerate the conf on the node (runbook Notes).

## Client impact

The runbook says it is "Not verified" whether a reload closes sessions of changed users on nats-server 2.15.1. Plan as if mind and mcp sessions are closed. Body and mcp reconnect on their own; confirm it in their logs (runbook step 6). Do not restart them by hand unless they stay disconnected for more than five minutes.
