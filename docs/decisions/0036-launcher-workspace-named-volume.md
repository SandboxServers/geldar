# 0036. The launcher keeps the player workspace in a named Docker volume on every OS

- Status: Accepted (text supplied by the Scriptorium orchestrator; filed here)
- Date: 2026-11-09
- Spec: section 5.15 (sovereign players, repo-per-player, container sessions); decision 0011 (push from the host); the launcher hardening checklist H-06, H-07

## Decision

The launcher keeps the player workspace (`/player` in the kit container) in a named Docker volume created per player, populated by a helper container from the kit image that clones the verified start bundle into it; the session container mounts that volume. It does not bind-mount a host folder. The workspace stays what decision 0011 says it is: a throwaway, copy-based clone that the host never edits directly.

## Why

Measured on the author's machine (Docker Desktop for Windows): a bind-mounted folder appears inside the container as `root:root` mode 0777, and git in the kit image then refuses it ("detected dubious ownership") for uid 1000 and any other uid; `safe.directory` cannot be set from `-c` or the environment, and the kit's git runner nulls the global config on purpose. A named volume mounted over `/player` takes the image directory's owner (player, uid 1000) and git works. It also removes host-uid mapping differences between Linux, macOS and Windows.

## Consequences

- Supersedes the Wave 4 line that required the container user to match the workspace owner's uid through a bind mount.
- The host never edits the working copy directly; all host-side reading goes through the bundle and verify gate (H-09 to H-17), which is the existing design. Archive or export of memory uses `git archive` from the volume through a helper container.
- This changes the documented bind-mount contract, not the behaviour of the gate.
