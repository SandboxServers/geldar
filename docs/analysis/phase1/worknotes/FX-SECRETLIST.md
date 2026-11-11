# FX-SECRETLIST worknote: the required secret list comes from the merged compose config

Branch `fix/deploy-derive-secret-list`, from `origin/main` a86a91a. It touches `deploy/common.sh`, `deploy/colo-up.sh`, `deploy/colo-rollback.sh`, `deploy/colo-admin.sh`, `deploy/gen-secrets.sh`, `deploy/compose.secrets.yml`, `deploy/README.md`, `deploy/test/colo-deploy.test.ts`, `deploy/test/colo-admin.test.ts` and this note.

## The problem

`deploy/common.sh` kept a hand list of the secret files the node needs. The list had drifted from `compose/colo.yml`: a secret added to the compose file (or to the overlay) was not checked before `up`, and the NATS files and the MCP files were not in the list at all.

## How the list is derived now

- `merged_config` runs `docker compose -p geldar-colo -f compose/colo.yml -f deploy/compose.secrets.yml config` once (read-only) and keeps the output in the run's temp directory.
- `secret_sources` is an awk pass over the top-level `secrets:` block of that output. It prints one `NAME<TAB>PATH` line per entry. An entry with no `file:` gets an empty path, and `check_secret` refuses it.
- `check_secrets` checks each NAME and PATH the config declares. It also checks the `nats-auth.conf` bind mount when the auth overlay is merged (`GELDAR_COLO_EXTRA_OVERLAY`), because that file is a bind, not a secret. If the merged config declares no secret at all, the check refuses.
- `check_merged_config`, `colo-up.sh`, `colo-rollback.sh` and `colo-admin.sh` use the same merged config, and `colo-up.sh`, `colo-rollback.sh` and `colo-admin.sh` run `check_secrets` after `check_merged_config`.
- `deploy/compose.secrets.yml` is the one place that maps each compose secret name to a file under `GELDAR_SECRETS_DIR`. It now covers all eight names the services use: `postgres`, `rcon`, `velocity-forwarding`, `nats-body`, `nats-mind`, `postgres-mcp.txt`, `mcp-token-pepper.txt` and `nats-mcp`.

Checked against the real output: `docker compose ... config` with `GELDAR_SECRETS_DIR` set to a temp directory prints exactly those eight names with their files. The awk, run by hand under Git sh on that output, prints the same eight names. Nothing else is declared.

## Guards in `check_secret`

For each declared file, in order:

1. The path is not empty (no `file:` in the merged config is refused).
2. The file exists. A missing file names the secret and the file. A `nats-*` file also names the step that writes it on a trusted machine: `./geldar.ps1 shard nats-auth colo`.
3. `readlink -f` resolves it. The resolved path must be inside `GELDAR_SECRETS_DIR` or `compose/secrets` (a symlink to a file outside is refused). Both sides of that test come from `readlink -f`, so they are spelled the same way.
4. It is a regular file.
5. It is not empty.
6. Its mode is `600`, `400`, `0600` or `0400`. The mode is read with `stat -c %a`.

The check never reads or prints the contents. A test checks that a refused file's contents never reach the output.

`gen-secrets.sh` creates only its own list: `postgres.txt`, `rcon.txt`, `velocity-forwarding.txt`, `nats-body.txt`, `postgres-mcp.txt` and `mcp-token-pepper.txt`. The NATS files are never generated on the node.

## Found while testing

- On Git for Windows sh, `pwd -P` prints `/tmp/...` for a directory whose `readlink -f` form is `C:/...`. The containment test compared the two spellings, so every secret file was refused as outside the directory. The fix resolves the secrets directories with `readlink -f` too (commit `0a74c36`).

## Tests

`deploy/test/colo-deploy.test.ts` has a fixture config that declares the eight secrets. It has tests for: each declared secret missing (one test per name, each names the file); an empty file; a symlink escape (skipped where symlinks are refused); a path outside the directory without a symlink (added so that the containment guard runs on Windows without developer mode); mode 644 refused; mode 600 and 400 accepted; the contents never printed; the list passing when every declared file is present; a new secret added to the config being checked with no change to the script (the anti-drift test); a config that declares no secret refused; a missing NATS file naming the trusted-machine step; and the `nats-auth.conf` bind mount.

`deploy/test/colo-admin.test.ts` got the same secrets block in its fixture, because `colo-admin.sh` now runs the same check.

## Deviations from the packet

- `deploy/test/colo-admin.test.ts` was edited beyond the packet's original list: its fixture config needed a `secrets:` block, since `colo-admin.sh` now checks the same files.
- `deploy/compose.secrets.yml` was edited beyond the original list: it gained the redirects for `nats-mind`, `postgres-mcp.txt`, `mcp-token-pepper.txt` and `nats-mcp`, which the services use and which the merged config must declare.
- A containment test without a symlink was added (see Tests). The packet did not ask for it. Without it, the containment guard had no test on a Windows machine without developer mode.

## Revert evidence

Done on the worktree with a backup in the scratchpad. Each check: commit first, change one line, confirm `git diff --stat` shows one changed line, run `deploy/test`, restore from the backup, confirm the diff is empty.

1. **The exists check disabled** (`if [ 1 = 0 ]` in `check_secret`). `deploy/test`: 11 failed, 43 passed, 1 skipped. Every missing-file test fails, including the anti-drift and the NATS tests.
2. **The mode check loosened** (`644` added to the accepted modes). 2 failed: the mode-644 refusal and the never-prints-contents test.
3. **The empty-file check loosened** (`-s` changed to `-e`). 1 failed: the empty-file test.
4. **The containment refusal removed** (the `inside_secrets_dir` die). The symlink test is skipped on this machine (symlinks need developer mode), so the suite passed: 54 passed, 1 skipped. That is the gap. A symlink-free test was added (commit `1ac537b`), and with the refusal removed it fails (1 failed). The symlink test itself was not confirmed to fail on this machine.
5. **The contents printed** (`cat "$real" >&2` before the mode die). 2 failed: the mode-644 refusal and the never-prints-contents test.
6. **The anti-drift test** (the list hard-coded in `check_secrets` as `postgres`, `rcon` and `velocity-forwarding`). The full run: 35 failed across `colo-up.sh`, `colo-rollback.sh`, `colo-admin.sh` and the secrets tests. Re-run with `-t 'requires a secret added'`: that test fails (1 failed), so the anti-drift guard catches it.

## Unverified

- No real docker or node was used. Every compose call in the tests is the fake docker shim. The `docker compose config` output was read on the workstation, with a temp directory set for the secrets variable. Nothing ran on the node.
- The symlink-escape test is skipped on this Windows machine. It runs where developer mode or CI allows symlinks; it was not seen to pass or fail here.
- The `readlink -f` and `stat -c` calls are GNU coreutils behaviour, as on the node (Debian 12). On Windows they come from Git's coreutils.
