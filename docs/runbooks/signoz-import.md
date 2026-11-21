# SigNoz import: dashboards and alert rules (G1)

`deploy/signoz/import.sh` posts the Geldar dashboards (`deploy/signoz/*-dashboard.json`) and alert rules
(`deploy/signoz/*-alerts-*.json`) to the SigNoz v0.148.1 API on the node, through an SSH tunnel to its loopback port.
Running it again skips a dashboard whose title is already listed (`--replace` deletes it by id and creates it again) and updates a rule whose alert name is listed. Nothing is duplicated.
The script writes nothing outside a temp dir that it removes on exit.

**Verified against the SigNoz v0.148.1 source** (tag `v0.148.1` of `SigNoz/signoz`). The dashboard routes are v2 and the rule routes are v1:

- Dashboards: `GET /api/v2/dashboards` (list), `POST /api/v2/dashboards` (create; a body with `version` and no `schemaVersion`, as the repo files have, is converted from v1 by the server), `DELETE /api/v2/dashboards/<id>`. Source: `pkg/apiserver/signozapiserver/dashboard.go`, `pkg/modules/dashboard/impldashboard/v2_handler.go` (`CreateV2`). The list is `{status, data: {dashboards: [...], total}}`, paged (at most 200 per page; the script reads every page). A dashboard's title is `spec.display.name` and its id is `id`.
- Rules: `GET /api/v1/rules`, `POST /api/v1/rules`, `PUT /api/v1/rules/<id>`, `DELETE /api/v1/rules/<id>` (`pkg/query-service/app/http_handler.go`, lines 363-368). The list is `{status, data: {rules: [...]}}`; a rule's id is `id` and its alert name is `alert` (`pkg/types/ruletypes/api_params.go`, `GettableRules`).

The script reads both lists, and checks that no title or alert name matches twice, before its first write. A dashboard whose title is already listed is skipped and reported; `--replace` deletes it by id and creates it again. `--replace` deletes the dashboard before it POSTs, so if the POST fails the dashboard is missing until the next run recreates it. A rule whose alert name is listed is updated by its id.

**UNVERIFIED** on a live node: that `POST /api/v1/rules` accepts the rule bodies in the alert files; that the v1 dashboard files convert to v2 as intended (the source shows that the title moves to `spec.display.name`; the panels, variables and queries are not checked); the paging on a node with more than 200 dashboards; and the notification channel. The first real run is the check on these. Record what the real responses are here, then fix the script and the test together.

## 1. Prerequisites (owner decides the window)

- A running `geldar-signoz` on the node (`docker inspect -f '{{.State.Health.Status}}' geldar-signoz` prints `healthy`).
- An admin account in SigNoz. Its credentials are held by the owner, never in the repo.
- The notification channel `geldar-owner-channel` (named in the alert files' `preferredChannels`) must exist in SigNoz
  before the real run. The script imports rules, not channels, so a rule that names a missing channel is refused or
  left without a route. Create the channel in the SigNoz UI with that exact name, then run the dry run.
- `bash`, `curl` (7.55 or later, for `-H @file`) and `jq` on the machine that runs the script.
- Every Paper and NeoForge dashboard step needs a fresh owner OK with a window (the gap-plan rule). Run through the ops
  agent in that window.

## 2. Open the tunnel and make the token file

The SigNoz API listens on the node's loopback port 8095 (the port `deploy/telemetry/README.md` uses). Forward it:

```
ssh -N -L 8095:127.0.0.1:8095 <node ssh host alias>
```

Get an admin token. The login takes three keys from the owner's `login.json`: `email`, `password` and `orgId`. The file
lives in the operator temp dir, outside the repo checkout; nothing prints or copies it, and the commands below read `email`
and `orgId` from it into shell variables only. `$API` is the tunnel base URL (`http://127.0.0.1:8095`).

1. `GET /api/v2/sessions/context` needs the query parameters `email` (a valid address) and `ref` (the site URL; the loopback
   tunnel URL is accepted). Without `email` it returns 400 `invalid email`. The answer is `{status, data: {exists, orgs: [{id, name,
   authNSupport}]}}`; the org id is `data.orgs[].id`. This check prints nothing and fails unless the account exists and its
   org id is the `orgId` in `login.json`:
   ```
   EMAIL="$(jq -r '.email' "$OP_TMP/login.json")"
   ORG="$(jq -r '.orgId' "$OP_TMP/login.json")"
   curl -sSf -G --data-urlencode "email=$EMAIL" --data-urlencode "ref=$API" "$API/api/v2/sessions/context" \
     | jq -e --arg o "$ORG" '.data.exists == true and any(.data.orgs[]?; .id == $o)' > /dev/null
   ```
2. `POST /api/v2/sessions/email_password` takes the body `{email, password, orgId}` from `login.json`. Pipe the answer and keep
   only the token; read `data.accessToken` from it:
   ```
   umask 077
   curl -sSf -X POST -H 'Content-Type: application/json' --data-binary "@$OP_TMP/login.json" "$API/api/v2/sessions/email_password" \
     | jq -er '.data.accessToken' | head -n 1 > "$OP_TMP/token.txt"
   ```

Write only the token, on its first line, to a file outside the repo checkout, owner-only (`umask 077`). Never paste the token
into a chat, a log or a command line. Delete `login.json` as soon as the token file exists, and delete the token file when the
import is done. The request `docs/analysis/telemetry/node-requests/07-signoz-import-g1.md` (section 5, step 4) has the same
calls with the header file written without a command-line token.

## 3. Dry run, then the real run

```
deploy/signoz/import.sh --token-file <path outside the repo> --dry-run
deploy/signoz/import.sh --token-file <path outside the repo>
```

The dry run prints one line per file: the PUT or POST it would send. It sends nothing and reads no token. The real run
prints `created`, `skipped` or `replaced` per dashboard, `created` or `updated` per rule, then `done`. Before the real run, list what is there so you can
see the real shapes (this is also the UNVERIFIED check):

```
curl -sS -H @hdr.txt http://127.0.0.1:8095/api/v2/dashboards
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

1. Find the ids: `curl -sS -H @hdr.txt http://127.0.0.1:8095/api/v2/dashboards` and `.../api/v1/rules`, matching the titles
   "Geldar Paper", "Geldar NeoForge" and the alert names in `deploy/signoz/*-alerts-*.json` (`.rules[].alert`).
2. Delete each one: `curl -sS -X DELETE -H @hdr.txt http://127.0.0.1:8095/api/v2/dashboards/<id>` and
   `curl -sS -X DELETE -H @hdr.txt http://127.0.0.1:8095/api/v1/rules/<id>`. The route and method are verified in the source (above).
3. Repeat the list call. No Geldar title or alert name remains.

Rollback needs the owner's OK in the same way the import does.

## 6. Notes

- Metric names in the files are the frozen Ledger names (`plugin/ledger-core` `Names.java`, golem `metrics.ts`). The test
  `tools/repo-checks/src/signoz-import.test.ts` fails if a file reads a name the repo does not emit, or if the script
  carries a URL, token or account literal other than the loopback tunnel end.
- Nothing in the import reads or writes prompt or thought text, and no label names a player or a life (decision 0088).
- The admin token is never printed by the script and never committed.
