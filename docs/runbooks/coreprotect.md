# Runbook: CoreProtect (block owner records)

CoreProtect records block changes in the Paper world so that a block's owner can be found later. Its jar is pinned, verified and mounted read-only like BlueMap and Chunky. Its data directory is not a repo path and not a mount.

## The jar

- Project: CoreProtect Community Edition, source https://github.com/PlayPro/CoreProtect (PlayPro). Modrinth project `Lu3KuzdV`.
- Version 24.1, file `CoreProtect-CE-24.1.jar`, published 2026-09-24. Game versions include 26.1.2 (the Paper pin).
- Licence: Artistic License 2.0 (`Artistic-2.0`). The repo keeps no separate third-party notice file, so this runbook carries the notice: CoreProtect CE, copyright PlayPro, Artistic License 2.0.
- The pin is `plugins/coreprotect/coreprotect.lock.json`: the URL, size, sha256 and sha512 of the jar.

## How the jar is verified

`deploy/colo-up.sh` calls `fetch_coreprotect` (deploy/common.sh) after the BlueMap and Chunky fetches. It downloads the lock's URL, checks the sha256 against the lock, and stops the deploy on a mismatch; nothing is installed. A dry run (`DEPLOY_DRY_RUN=1`) verifies and keeps nothing. On a real run the verified jar is stored at `state/coreprotect/coreprotect.jar`, and Compose binds it read-only to `/plugins/coreprotect.jar` in the Paper service.

To check the jar by hand, on the node, after the fetch:

```sh
sha256sum "$GELDAR_STATE_DIR/coreprotect/coreprotect.jar"   # must equal the sha256 in the lock
```

The lock also records a sha512. The deploy checks only the sha256; compare the sha512 by hand if you want the second digest.

## First start: set the config by hand

The plugin writes its config into the writable Paper volume at `plugins/CoreProtect/` on first start. The jar is read-only, but the config is not: the plugin rewrites it, so it is not mounted. After the first start, from the Paper console or the config file, turn off:

- chat recording,
- command recording,
- session recording,
- container transaction recording,
- error reporting,
- update checks.

Confirm each setting name against the config the plugin wrote; this runbook does not list the YAML keys. Do not commit the config file.

## Checks

- A sha256 mismatch stops the deploy, and nothing is installed.
- `/plugins/coreprotect.jar` is a read-only mount. A change to the jar needs a new lock entry, not a file edit on the host.
- A version bump needs a new lock file and a `release-dates.json` entry for `modrinth:Lu3KuzdV@<version>`. The lock test fails until both match.
