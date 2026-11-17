# Node request 03: delete the old staged trees (`src.old*`)

Status: DRAFT, blocked on request 01 (restage and recreate) having passed its section 7 verification, and on the owner saying so. Nothing has been run. Source of the rule: RESUME.md "Held": the `src.old*` trees and stage tarballs stay until `geldar-ch` and keeper are recreated from the new `src`.

Owner approval: yes (irreversible deletion on the node, inside the Geldar data path only).

## 1. What changes

Delete these directories under `/mnt/nvme/geldar-telemetry/`: `src.old`, `src.old-n6d`, `src.old-n7`, `src.old-n8`, `src.old-n10` (names from the README window log and request 01; read the actual list first, there may be others). Stage tarballs (`telemetry-<merge>.tar.gz` and friends) are NOT deleted by this request: the newest two stay as the rollback source for the next restage; older ones are deleted only if the owner names them. `stage/` payload files, secrets, data, queue, `src`: untouched.

## 2. Not touched

Everything outside `/mnt/nvme/geldar-telemetry/src.old*`: other tenants, Paper, Velocity, Caddy, Bodies, Docker objects, the live `src`, `clickhouse`, `keeper`, `query`, `queue`, `secrets`.

## 3. Caps

Disk only (frees space; no CPU or RAM). Sudo scope: none expected (the trees were made by the ssh user); if a path is root-owned, stop and ask (sudo scope is `mkdir`/`chown` inside the telemetry root only).

## 4. Window

Any time after 01 and a day of clean running (so a late-found problem could still roll back to the old trees). Expected outage: none (no container reads these paths after 01).

## 5. Baseline before (read-only)

```
cd /mnt/nvme/geldar-telemetry
ls -ldn src src.old*; du -sh src.old* ; df -h /mnt/nvme
docker ps --format '{{.Names}}' | grep '^geldar-' | while read -r c; do docker inspect -f '{{.Name}}{{println}}{{range .Mounts}}  {{.Source}}{{println}}{{end}}' "$c"; done > stage/mounts-before-delete-<ts>.txt
grep -c 'src\.old' stage/mounts-before-delete-<ts>.txt
```
The last count must be `0`: no running container mounts an old tree. Any hit stops the request (that container was not recreated; go back to 01). Also check that no container has a deleted mount: `docker inspect` of the three recreated containers shows `src` paths only. Also `ls -li` inode check of 01 section 7 step 1 was recorded.

## 6. Steps

1. Print the exact list to delete and get the owner's word on it (names only).
2. For each directory: `rm -rf -- /mnt/nvme/geldar-telemetry/<name>` with the full literal path, never a glob, never a variable that could be empty.
3. `ls -ld /mnt/nvme/geldar-telemetry/*` and `df -h /mnt/nvme`.

## 7. Verify after

`docker ps` unchanged and every `geldar-*` container `healthy` or running as in the baseline; `df` shows the freed size; gateway `13133` returns `200`; no new restart count (`docker inspect -f '{{.RestartCount}}'`); telemetry still flowing (row count higher than at the section 5 baseline of request 01).

## 8. Rollback

None for the deleted files. The recovery path is `git archive <merge>` plus the kept tarballs. That is why the newest two tarballs stay and why the request waits a day after 01. If a container turns out to hold an old inode (it would show as `Exited` or a changed file), recreate that container from `src` as in 01 section 6.

## 9. Open facts

The exact list of old trees and tarballs on the node; whether any is root-owned; whether anything other than compose refers to them (cron, scripts: not known from the repo).
