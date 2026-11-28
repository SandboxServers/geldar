# GX-NATS: NATS rows for the sheet life subjects

Card: `docs/analysis/harness/work-packets-sheet-w9-w12.md`, section GX-NATS. Depends on AN-28c (merged, #817).

## What changed in the rows

- `eventsink` Pub gains `geldar.$s.life.*.sheet` (one life's sheet subject). The `geldar.$s.` prefix is assumed, as for every other subject in the table. The subject name is not defined in the repo yet: confirm it against the publisher's card before merge.
- `body` PubDeny gains `geldar.$s.life.>`. `paper` PubDeny gains `geldar.$s.life.>`. Both already publish `geldar.$s.>`; the deny is what keeps them off the life subtree. `eventsink` is the only publisher.
- `body` keeps `geldar.$s.provenance.>` in both PubDeny and Sub (AN-28c). This card does not remove or narrow either.
- `supervisor`, `register` and `helper` are unchanged. No password file is created by this card.

## Path

`geldar.ps1` is not on the colo-images path filter in `.github/workflows/colo-images.yml`. Merging it alone does not rebuild the images or restart the Bodies.

## Ops run: apply the regenerated NATS config to the Colo (separate from this card)

This run is not part of GX-NATS. It runs only when the operator says so. The procedure is the runbook [docs/runbooks/nats-auth-inplace.md](../../../runbooks/nats-auth-inplace.md), "Procedure", steps 0 to 7. Follow the runbook; the list below names the steps this change depends on and does not replace the runbook.

Owner go: given 2026-11-28 by relay. The runbook requires an owner go recorded before step 0. This note records only that go; it does not record a window or any other approval.

- **Staging (runbook steps 0 and 2).** Use `GELDAR_SECRETS_DIR` as the runbook says and check it first. Create the staging directory with `install -d -m 0700 "$HOME/nats-stage"`, outside `secrets/`. Write the staged conf from the merged `geldar.ps1` with `umask 077`, so it is mode 600. Passwords are copied from the existing `secrets/nats-<user>.txt` files by a script; never echo or type them. This change adds no user, so no password file is created.
- **Why never `mv`.** The live file is a single-file read-only bind mount into the NATS container. The bind follows the inode, so a `mv` over the live file leaves the container on the old file. Write in place with `cat staged > live` (runbook step 4), which keeps the inode and the mode.
- **Mode.** The live file is mode 600 before and after the write (`stat -c '%a %i'`). The backup is `umask 077` and `chmod 0600`.
- **Validate (runbook step 3).** Run `nats-server -t -c` on the staged file with the pinned image (`docker run --rm --entrypoint nats-server`, the staged file mounted read-only). Expect `is valid`. Anything else stops the change.
- **Monitor line.** The `http:` line must be identical in the live and staged files (`grep -n 'http:'` on both). A changed monitor host cannot be reloaded.
- **Diff (runbook step 3).** Redact passwords before any diff: `sed -E 's/password[^,}]*/password=REDACTED/g'` on both files, then `diff`. The diff must show exactly two added lines: the `geldar.<s>.life.*.sheet` publish on `eventsink`, and the `geldar.<s>.life.>` PubDeny on `body` and on `paper`. Any other line stops the change. Delete the redacted copies afterwards.
- **Backup and sha256 before apply (runbook step 1).** Copy the live file to `nats-auth.conf.bak-<UTC stamp>` and run `sha256sum` on the live file and the backup. They must match. Record both values.
- **Apply (runbook step 4).** `cat staged > live`, then `sha256sum` on the live file must equal the staged file.
- **Reload (runbook step 5).** `docker kill -s HUP geldar-colo-nats-1`, then `docker logs --since 2m geldar-colo-nats-1`. The log must show `Reloaded: authorization users`, `Reloaded: accounts` and `Reloaded server configuration`. A missing line stops the change and goes to rollback.
- **Connection count.** Count before the apply and after the reload with the runbook's method, not `/connz`: `docker exec geldar-colo-nats-1 wget -qO- http://127.0.0.1:8222/varz | grep -o '"connections": *[0-9]*'`. The runbook reads `connections` from `/varz`, so this note's earlier `/connz` wording is replaced by it. Record both numbers. Expect the same count, apart from Bodies that reconnect during the reload.
- **Per-role check (runbook step 6).** Use each role's own client, never the admin account. `eventsink` publishes `geldar.<s>.life.<id>.sheet` and is not refused. `body` and `paper` publishing the same subject are refused and logged as `Permissions Violation`. `body`, `mcp` and `eventsink` are still connected, and no new dead letter appears in their logs.
- **Rollback (runbook step 7).** Use it if a `Reloaded` line is missing, a role is refused where it must not be, or the connection count does not return. Run `cat backup > live`, then `sha256sum` on the live file must equal the backup value from the step above. Then HUP the container and repeat the `Reloaded` check and the connection count. The count must return to the value recorded before the apply. Keep the backup for a day.

Do not touch Paper or the node in this run beyond the conf and the NATS reload.

## Checks

- `./geldar.ps1 pnpm test tools/repo-checks/src/nats-auth`: the new colo tests (eventsink, body, paper, the provenance pair, and the supervisor, register and helper rows) and the existing generator and table tests.
- `vitest run test/nats-auth.it.test.ts` from `threshold/mcp`: the live table. Its two ungated tests (no bare wildcard subject, and the rendered config quotes no bare `*` token; both exempt `geldar.<s>.life.*.sheet` as they exempt `kino.*.feed`) run without the live node. The live cases are gated and run on ops.
- `./geldar.ps1 pnpm check:repo`
- `git diff --check`

The live table in `threshold/mcp/test/nats-auth.it.test.ts` mirrors the same three rows. Ops runs its live cases.
