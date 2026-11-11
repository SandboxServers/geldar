# FX-SECRETS worknote: owner-only shard secrets on Linux, and the NATS check before `up colo`

Branch `fix/c1-linux-secrets`. A fix packet from the C1 boundary review of the colo stack. It touches `geldar.ps1` (the secrets functions and the `up` action only), `tools/repo-checks/src/shard-secrets.test.ts` (new) and this note.

## Findings and what changed

- **(A) Linux secret files were world-readable.** `Set-OwnerOnlyAcl` returned at once off Windows, so `shard secrets` left `postgres.txt`, `rcon.txt` and `velocity-forwarding.txt` at the umask default (0644 under umask 022). Now, off Windows: the `compose/secrets` directory is `chmod 700`; each secret file is created empty, set to `600` through `Restrict-OwnerOnly`, and only then written. The mode is read back (`[IO.File]::GetUnixFileMode`) after the chmod and after the write, and a mismatch throws. A failed chmod throws too, so the command stops. The stream is disposed in a `finally` even when the chmod throws. Windows keeps the icacls path and its best-effort warning.
- **(B) `shard up colo` failed in docker on a fresh checkout.** `compose/colo.yml` declares `nats-body` as a file secret, and only `shard nats-auth colo` writes `nats-body.txt`. `Assert-ColoNatsSecrets` runs first in the `up` action (before the plugin check, before any docker call). It throws when `compose/secrets/nats-body.txt` is missing or empty, and names the file and the command: `./geldar.ps1 shard nats-auth colo`. It does not generate a partial set. The other `nats-*` files (`nats-mind.txt` and the rest) belong to the `nats-auth.yml` overlay, which `shard up colo` does not merge, so the check does not require them. A test keeps the check's list equal to the `nats-*` file secrets that `colo.yml` declares.
- **(C) One owner-only function.** `Set-OwnerOnlyAcl` on Linux and macOS now calls `Restrict-OwnerOnly`, which is the only place that runs `chmod 600`. `Restrict-OwnerOnly` itself is unchanged, so `shard nats-auth` behaves as before. The Windows branch of `Set-OwnerOnlyAcl` is unchanged and still best effort, so it keeps its own icacls call. The two icacls calls differ on purpose: one warns and continues, the other throws.
- **(D) uid note (plausible, not proven).** The Compose services run as uid 1000 (the `USER` in their images). A `0600` secret owned by a different host uid is unreadable inside the container when it is bind-mounted. Two options, neither implemented:
  1. Deploy group: keep `0640` with the group set to a group the container's uid belongs to, and add `group_add` to the service.
  2. Owner change: `chown` the secret files to uid 1000.

  Nothing here proves a need. See the TODO below.

## Tests

`tools/repo-checks/src/shard-secrets.test.ts` runs the real generator under pwsh in a temp copy (the repo's `compose/secrets/` is never written).

- Static: the owner-only helpers and the colo check are defined; `Set-OwnerOnlyAcl` delegates to `Restrict-OwnerOnly` off Windows; the `up` action runs `Assert-ColoNatsSecrets` before `Assert-PluginJar`; the check lists every `nats-*` file that `colo.yml` declares.
- `shard secrets colo` writes the three files (all platforms): 32 URL-safe characters each.
- Off Windows only: the directory is `0700` and each file `0600`; a second run changes no value and keeps the modes; a world-readable `rcon.txt` (0644) left by an older run is tightened to `0600` with its value kept.
- `shard up colo` fails before docker when `nats-body.txt` is missing, and when it is empty, and names the file and the command; it writes no secret on the way; with the file present it gets past the check (it stops later at the missing plugin jar).

On Windows the mode tests are skipped, and the other tests run. CI (Linux) runs all of them.

## TODO for C1-10

- Verify on the node that the container's uid (1000) can read the `0600` secrets through the bind mounts, with the host owner the deploy user. If it cannot, pick option 1 or option 2 above and add a test for it.

## Revert evidence

Done on the working tree with a backup in the scratchpad, not with a commit first, so the branch keeps the single commit the packet asks for. Each check: back up the file, change one line, confirm `git diff --stat`, run the test, restore from the backup, confirm the diff is back to the packet's change.

- **1. The `up colo` check removed** (the call line in the `up` action). Windows vitest: `Tests 3 failed | 7 passed | 2 skipped` (the static order test, and the two behaviour tests for a missing and an empty `nats-body.txt`). Restored; identical hash.
- **2. The chmod 600 of `Set-OwnerOnlyAcl` replaced by `return`** (the original Linux bug, in the new code). WSL repro: the run stops at the post-write read-back with `postgres.txt has mode 644, not 600`. Restored; identical hash. The Linux vitest mode tests fail the same way in CI.
- **3. The directory chmod 700 changed to 755.** WSL repro: `compose/secrets has mode 755, not 700`. Restored; identical hash.

Not run: a mutation of the NATS name list (the static list test covers it, but it was not reverted here).

## What CI must prove

- The mode tests on Linux: `0700` for the directory, `0600` for each file, after the first run, after a second run, and for a file left at `0644`.
- The Linux run of the early check and the other `shard up colo` cases in the new test file (the Windows run covers them too).
- The compose config checks still exit 0 (colo, phase0; no compose file changed).

## Unverified

- The Linux mode assertions were checked here through a repro under WSL pwsh (7.6, ext filesystem in the home directory, uid 1000, umask 022), not through the vitest run, since WSL has no node or pnpm. The repro loaded the real function text from `geldar.ps1` by its AST.
- Read access inside the container (item D) is not checked.
- The chmod-failure throw is checked by reading the code (`Restrict-OwnerOnly` throws, `Set-OwnerOnlyAcl` returns only after it), not by a test; making chmod fail reliably on Linux needs a filesystem that refuses modes.
- CI `typescript` failed on PR #63, also on Windows: the owner-only test in `geldar-script.test.ts` pinned `Set-OwnerOnlyAcl $path` directly before `try {`. The fix moved that call into the write's `try`, so the file was still restricted before the write, but the stale pattern failed.
- Fix: the test now checks by index that the file is created, that the owner-only call sits in the write's `try` before `$stream.Write(`, and that moving or removing the call fails it. It no longer pins the line layout.
