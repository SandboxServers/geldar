# SigNoz import: dashboards and alert rules (G1)

`deploy/signoz/import.sh` posts the Geldar dashboards (`deploy/signoz/*-dashboard.json`) and alert rules
(`deploy/signoz/*-alerts-*.json`) to the SigNoz v0.148.1 API on the node, through an SSH tunnel to its loopback port.
Running it again updates what is there: a dashboard is matched by title, a rule by alert name, and nothing is duplicated.
The script writes nothing outside a temp dir that it removes on exit.

**UNVERIFIED.** This repo verifies the SigNoz login route and the TTL route (`deploy/telemetry/README.md`, retention
section). It does not verify the dashboard and rule routes, their request bodies or their list shapes. The script uses:

- `GET /api/v1/dashboards` and `POST /api/v1/dashboards`, `PUT /api/v1/dashboards/<id>`, dashboard id at `.data[].id`,
  title at `.data[].data.title`;
- `GET /api/v1/rules` and `POST /api/v1/rules`, `PUT /api/v1/rules/<id>`, rule id at `.data.rules[].id` (or `.data[].id`),
  alert name at `.alert`.

These come from SigNoz source knowledge, not from this repo. The first run is the verification: run the dry run, then
read the list output (step 3) before the real run. If a list call returns a different shape, the script fails on the jq
step and sends nothing more. Record what the real shapes are here, then fix the script and the test together.

## 1. Prerequisites (owner decides the window)

- A running `geldar-signoz` on the node (`docker inspect -f '{{.State.Health.Status}}' geldar-signoz` prints `healthy`).
- An admin account in SigNoz. Its credentials are held by the owner, never in the repo.
- `bash`, `curl` (7.55 or later, for `-H @file`) and `jq` on the machine that runs the script.
- Every Paper and NeoForge dashboard step needs a fresh owner OK with a window (the gap-plan rule). Run through the ops
  agent in that window.

## 2. Open the tunnel and make the token file

The SigNoz API listens on the node's loopback port 8095 (the port `deploy/telemetry/README.md` uses). Forward it:

```
ssh -N -L 8095:127.0.0.1:8095 <node ssh host alias>
```

Get an admin token the way the retention runbook does (`deploy/telemetry/README.md`, "Retention window", step 3): `GET
/api/v2/sessions/context` for the org id, then `POST /api/v2/sessions/email_password` with `email`, `password` and
`orgId`. Read `data.accessToken` from the answer. That route is verified in the repo (round 9, local run). Write only the
token, on its first line, to a file outside the repo checkout, owner-only (`umask 077`). Never paste the token into a
chat, a log or a command line. Delete the file when the import is done.

## 3. Dry run, then the real run

```
deploy/signoz/import.sh --token-file <path outside the repo> --dry-run
deploy/signoz/import.sh --token-file <path outside the repo>
```

The dry run prints one line per file: the PUT or POST it would send. It sends nothing and reads no token. The real run
prints `created` or `updated` per dashboard and per rule, then `done`. Before the real run, list what is there so you can
see the real shapes (this is also the UNVERIFIED check):

```
curl -sS -H @hdr.txt http://127.0.0.1:8095/api/v1/dashboards
curl -sS -H @hdr.txt http://127.0.0.1:8095/api/v1/rules
```

`hdr.txt` is a header file with `Authorization: Bearer <token>` written in the same private way; do not put the token in
argv.

The script's `--url` flag only accepts `http://127.0.0.1:<port>`. The token file must not sit under the repo checkout;
the script refuses one that does.

## 4. Check that the dashboards show data

1. Open the SigNoz UI through the tunnel (or the owner's usual route) and open "Geldar Paper" and "Geldar NeoForge".
2. Each panel with a live metric (for example `geldar_tps`, `geldar_tick_lag_ms`, `geldar_players_online`) shows points
   for the last hour while the shard runs. A panel with no points on a stopped shard is expected; a panel that is empty
   while the shard runs is a finding.
3. Open the alert rules list. Each Geldar rule appears once, with a state (inactive is normal).

No panel acts in the world. The dashboards read metrics only.

## 5. Rollback (delete by title)

Rollback removes what the import created. It does not restore an earlier version of an updated dashboard or rule (keep
a copy of the list output from step 3 for that).

1. Find the ids: `curl -sS -H @hdr.txt http://127.0.0.1:8095/api/v1/dashboards` and `.../api/v1/rules`, matching the titles
   "Geldar Paper", "Geldar NeoForge" and the alert names in `deploy/signoz/*-alerts-*.json` (`.rules[].alert`).
2. Delete each one: `curl -sS -X DELETE -H @hdr.txt http://127.0.0.1:8095/api/v1/dashboards/<id>` and
   `curl -sS -X DELETE -H @hdr.txt http://127.0.0.1:8095/api/v1/rules/<id>`. **UNVERIFIED** route and method.
3. Repeat the list call. No Geldar title or alert name remains.

Rollback needs the owner's OK in the same way the import does.

## 6. Notes

- Metric names in the files are the frozen Ledger names (`plugin/ledger-core` `Names.java`, golem `metrics.ts`). The test
  `tools/repo-checks/src/signoz-import.test.ts` fails if a file reads a name the repo does not emit, or if the script
  carries a URL, token or account literal other than the loopback tunnel end.
- Nothing in the import reads or writes prompt or thought text, and no label names a player or a life (decision 0088).
- The admin token is never printed by the script and never committed.
