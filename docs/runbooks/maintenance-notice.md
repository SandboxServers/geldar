# Maintenance notice: the Paper broadcast (CD-1c)

The deploy publishes a maintenance notice on `geldar.<shard>.maintenance` before it restarts a
part of the stack, and again when the restart is done. The Paper plugin (Geldar-Core) subscribes
to that subject and says one short server line to the online players. It says nothing else.

Schema: `contract/schemas/maintenance-notice.schema.json`. Subject: `maintenanceSubject()` in
`contract/src/subjects.ts`.

## What players see

| kind | scope | line |
|------|-------|------|
| `pause` or `restart` | `world` | `Server maintenance in N seconds.` (N is `seconds`; `Server maintenance soon.` when `seconds` is absent) |
| `pause` | `bodies` or `mcp` | `Brief maintenance: some players may drop and return.` |
| `restart` | `bodies` or `mcp` | nothing |
| `back` | any | `Server maintenance finished.` |

The plugin writes every line from this table. The deployer sends no free text.

## Rules the plugin applies

- A payload that does not match the schema is ignored: not JSON, unknown keys, an id outside
  `^[a-z0-9][a-z0-9_-]{0,63}$`, an unknown kind, scope or reason, or `seconds` outside 0 to 600.
- A notice id is broadcast once. A repeated delivery of the same id says nothing.
- At most 4 lines per 60 seconds. A notice dropped by the limit is not broadcast later when it
  comes back.
- The NATS dispatcher thread only validates and queues; the line is said on the server thread.

## Switching it off

`maintenance.broadcast` in the Geldar-Core `config.yml` (default `true`). The plugin re-reads the
file every 5 seconds. Set it to `false` and no line is said, including a line already queued. The
NATS subscription stays connected either way.

## Permissions

The Paper NATS user (`paper`) may subscribe to `geldar.<shard>.maintenance` (generated in
`geldar.ps1`, checked by `tools/repo-checks/src/nats-auth.test.ts`). Only the deploy publishes it;
that publish permission belongs to the deploy user (CD-1d).

## Checking it by hand

1. Confirm the subscription is up: the plugin logs `Maintenance notices enabled: broadcast true`
   at enable. A NATS failure logs `Maintenance notices cannot reach NATS`.
2. Publish a test notice as an operator with the deploy user (never with the plugin's own
   credentials), for example `pause`, `world`, `seconds` 30, and check the server line in chat.
3. Set `maintenance.broadcast: false`, wait 5 seconds, publish another notice, and check that
   nothing is said.
