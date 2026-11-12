# Runbook: Chunky pregeneration

Chunky (`plugins/chunky/README.md`) pregenerates chunks in the Paper world so players do not wait on generation. Run its commands from the Paper console (the RCON path or `docker compose exec paper` for an operator). Do not paste console output that contains secrets into tickets.

## Commands (Chunky 1.5.3)

| Command | What it does |
| --- | --- |
| `chunky world world` | Selects the world to pregenerate. |
| `chunky center 192 226` | Sets the centre of the area, in block x and z. |
| `chunky radius 1000` | Sets the radius of the area, in blocks. |
| `chunky start` | Starts the task with the selected world, centre and radius. |
| `chunky progress` | Prints the task's progress. |
| `chunky pause` | Pauses the running task. |
| `chunky continue` | Resumes a paused task. |
| `chunky cancel` | Cancels the task. |
| `chunky quiet <seconds>` | Sets how often progress is reported (`update-interval`). |
| `chunky silent` | Stops progress messages. |

## Configuration

The config file is `plugins/Chunky/config.yml`, in the plugin's data directory. It is YAML, not JSON. The keys that matter here are:

- `continue-on-restart`: whether a task resumes after a restart.
- `force-load-existing-chunks`: whether already generated chunks are loaded again.
- `silent`: the same as the `chunky silent` command.
- `update-interval`: the same as `chunky quiet`.

The data directory `plugins/Chunky` is created by the plugin inside the writable Paper data volume. It is not a repo path and not a mount.

## Load

The jar has no thread or priority setting. Control the load in three ways:

1. Keep the radius small, and run pregeneration in steps.
2. Run `chunky pause` while players are busy, and `chunky continue` when they are not.
3. The Paper container's CPU cap bounds the whole process.

## BlueMap interaction

BlueMap renders only chunks that exist. Pregenerated chunks therefore appear on the map only after BlueMap has rendered them. BlueMap's render load is capped by `render-thread-count: 1` in `plugins/bluemap/config/core.conf`. Do not raise that value to speed up a pregeneration run.

## Checks

- The jar is verified against `plugins/chunky/chunky.lock.json` at deploy time. A sha256 mismatch stops the deploy, and nothing is installed.
- `/plugins/chunky.jar` is a read-only mount. A change to the jar needs a new lock entry, not a file edit on the host.
