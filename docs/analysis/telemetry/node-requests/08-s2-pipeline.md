# S2 pipeline: the geldar_monitor role (copy for ops)

Full brief: `docs/analysis/telemetry/node-requests/08-monitors-g2.md` section 9. Needs its own owner OK and window.

Run ONCE, from `/mnt/nvme/geldar-telemetry`, never traced (`set -x` off). Only after S1 (the secret file, 48 characters)
and S3a (the tree from the merge of this PR in a fresh `src.new-g2`). Precheck, read-only: `sudo -n stat -c '%s' /mnt/nvme/geldar-telemetry/pg-secrets/otel-pg.txt`
must print `48`.

```
{ printf '\\set otel_pg_password '"'"; sudo -n cat /mnt/nvme/geldar-telemetry/pg-secrets/otel-pg.txt; printf '%s\n' "'"; cat /mnt/nvme/geldar-telemetry/src.new-g2/deploy/telemetry/postgres-monitor.sql; } | docker exec -i geldar-colo-postgres-1 psql -q -v ON_ERROR_STOP=1 -U geldar -d geldar
```

Rules:
- The password is never on a command line, in a log or in operator output. No `PGPASSWORD`. Never add `psql -a`, `-e`, `-b` or `-L`.
- A failed or partial run: regenerate the password (R1, then S1) and stop. Never reuse it.

Verification, the only queries after S2:
```
docker exec geldar-colo-postgres-1 psql -U geldar -d geldar -At -c "select rolname,rolcanlogin,rolsuper from pg_roles where rolname='geldar_monitor'"
```
must print `geldar_monitor|t|f`.
```
docker exec geldar-colo-postgres-1 psql -U geldar -d geldar -At -c "select roleid::regrole from pg_auth_members where member='geldar_monitor'::regrole"
```
must print exactly `pg_read_all_stats`.

Rollback (S2), then R1 (`sudo rm -f` the secret file, then `sudo rmdir` its directory, after R4):
```
docker exec -i geldar-colo-postgres-1 psql -U geldar -d geldar -c "REVOKE CONNECT ON DATABASE geldar FROM geldar_monitor" -c "DROP ROLE geldar_monitor"
```
