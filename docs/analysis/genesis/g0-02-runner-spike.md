# G0-02 runner capacity spike

Status: measured (reduced profile only). Decision input for G6-04 and the ephemeral CI stamp in [plan.md](plan.md) section 3.

## Run

- Run: https://github.com/SandboxServers/geldar/actions/runs/43643768809
- Date: 2026-11-14, 21:37 to 21:39Z
- Branch: `phase1/gn-g0-02-runner-spike` at `2c02732a` (spike branch, to be deleted after the spike)

## Runner

- Hosted runner, ubuntu-26.04 image.
- 4 vCPU, 15983 MB RAM, 145G root disk.
- About 88G free on disk at start.

## Measured: reduced profile boot

Started Postgres, NATS and Paper (2.5 GB container limit, 2 GB heap) with the real geldar-core jar and an empty world.

| Item | Result | Limit |
|---|---|---|
| Postgres ready | 19 s | |
| NATS ready | 14 s | |
| Paper "Done" | 50 s | |
| Peak host memory | 3620 MB | 12288 MB |
| Disk growth | 2143 MB | 14336 MB |
| Wall time for the boot | 50 s | 900 s for the whole stamp |

## Not measured

- Velocity.
- The services: eventsink, MCP, register, Glass.
- Body hosts (768 MB each).
- Plugin sets.
- A pre-generated world.
- Image pull time for the Body and service images.

## Conclusion

- The boot fits with large headroom: about 8.4 GB of memory is left under the 12 GB limit.
- The ephemeral stamp stays a full-stack target. It needs a second measurement with Velocity, the services and 3 Body hosts at 768 MB. G6-04 must record that measurement before the stamp is called proven.

## Lessons from the earlier failed runs

- Secrets must be owned by uid 1000 for Paper. Docker on Linux ignores the uid, gid and mode that compose sets for file secrets.
- The first run was green although Paper never booted. The wait loop did not fail. The stamp's waits must fail hard: a timeout or a non-ready state is a failed job, never a warning.
