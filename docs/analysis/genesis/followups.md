# Genesis follow-ups

Known follow-ups from the GE packets that are not yet in a card's scope. Each bullet names the file and the fix. Paths are the files the packet touched; check the file before editing. Ledger state is in [packets.md](packets.md); the start-here note is [RESUME.md](RESUME.md).

## GE-02c (NeoForge extra-mods fetch, #852)

- **SIGTERM leaves the temp file.** File: `deploy/nf-fetch-extra-mods.sh`. The script traps only EXIT. Fix: trap `INT TERM HUP` as well, so an interrupted fetch removes its temp file.
- **Untested guards.** File: `deploy/test/nf-fetch-extra-mods.test.ts`. Add tests for: the URL must end with the jar name; the field count of a pin line; a duplicate pin is refused; the unchanged check must compare the digest (it currently ignores it); the chmod of the fetched jar. Each test must fail when its guard is removed.
- **Symlinked jar slot is replaced.** File: `deploy/nf-fetch-extra-mods.sh`. An existing symlink at the jar slot is overwritten. Fix: refuse a symlinked slot instead of replacing it, and test that the refusal happens.
- **Host path variable is not connected.** Files: `compose/neoforge/neoforge-entrypoint.sh` and `compose/nf-live-mod-*.yml`. Nothing connects the fetched jar to the entrypoint's host path variable (`NF_EXTRA_<NAME>_JAR_HOST`). Fix: belongs to GE-11 (the NeoForge shard in the environment definition); no change in GE-02.

## GE-02f (deterministic NeoForge bundle tar, #844)

- **Umask comment is wrong.** File: `deploy/scratch/bundle-tar-lib.sh` (the comment in the tar function). The comment says umask 022 and 002 give the same bytes; umask 077 would not. Fix: reword the comment to name exactly the umasks that give the same bytes, and add a test for 077 if one is missing.

## GE-01b (plugin jar placement, #854)

- **Renames after a failed second rename.** File: `deploy/genesis/place-plugin-jars.sh`. When the second rename fails after the first has moved, the first rename is not undone. The script header documents this. Fix: undo the first move on the second's failure, with a test that fails without it, or keep the documented limit and say so in GE-01w2.
- **`mv -T` is GNU-only.** File: `deploy/genesis/place-plugin-jars.sh`. Fix: replace `mv -T` with a form that works on the node's userland, or state the GNU requirement in the script header and the bootstrap.

## GE-01c (held, branch `phase1/gn-ge-01c`, a03c9f9d)

- **Restart plan lines are ignored.** File: `deploy/colo-cd.sh`. `colo-cd.sh` ignores `restart` plan lines, so the restart server is not visible to operators; the manual line is. Fix: print the restart plan lines when the next change to `colo-cd.sh` lands (GE-03 owns `colo-cd`).
- **Docs say plugin changes are "needs manual".** Files: `deploy/README.md`, `docs/architecture/deployment-topology-colo.md`, `docs/operations/node-facts.md`, `docs/reference/deploy-scripts.md`, `docs/runbooks/colo-deploy.md`. Fix: update all five when GE-01w2 lands, in the same PR.

## CI and tooling

- **Maven Central transients.** Files: the plugin and NeoForge CI jobs in `.github/workflows/`. Maven Central returns 429 and "Could not find" errors. Fix: add a dependency cache or a mirror.
- **Glass integration test is flaky in the merge queue.** File: `glass/test/glass.it.test.ts` (line 431). Fix: owned by whoever owns glass; not a genesis change.

## Process

- **Remove a review worktree's node_modules junction first.** File: none (process rule; carried in [RESUME.md](RESUME.md)). Remove the junction with `cmd /c rmdir` before removing the worktree. Never `git worktree remove --force`: it destroyed `node_modules/.bin` once (2026-11-21).

## Closed, no action

- The Docker pool check and the bootstrap items are already merged. No action.
