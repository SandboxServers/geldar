# Node request 07: import the Geldar dashboards and alert rules into SigNoz (G1)

Status: DRAFT for the owner and the orchestrator geldar-69. Nothing here has been run. Nothing in this request runs on the node
except read-only checks; the import itself is API calls made from the operator's machine through the SSH tunnel.
Format: the step layout of `docs/analysis/telemetry/node-requests/01-gateway-restage-and-clickhouse-recreate.md`.
Facts come from `docs/runbooks/signoz-import.md` and `deploy/signoz/import.sh`, and from the SigNoz v0.148.1 source for the routes and list shapes (section 13 gives the paths; what is still UNVERIFIED is listed there too). Labels: **UNVERIFIED** = not checked
against the repo or the node; `[UNV]` marks one command or fact inside a step that has no repo source.
No URL, address, token, password or account name is written in this file. Placeholders: `<node ssh host alias>`,
`<OP_TMP>` (the operator temp directory, section 2), `<SCRATCH>` (the export directory, section 2), `<merge>` (the commit that holds `deploy/signoz/`, `3821a376...` at the time of writing), `<ts>` (UTC timestamp).

Owner approval needed: yes. Each step below needs a fresh direct owner OK with a window from the orchestrator geldar-69
before it runs. Any step that is not named in that OK does not run.

## Rules for the operator

1. Every compose or deploy-script command carries `GELDAR_SERVICE_UID=1001` (under sudo write `sudo env GELDAR_SERVICE_UID=1001 ...`).
2. Any compose command on the node carries the explicit deploy environment from the colo env files and always `up -d --no-deps <service>`.
3. Prove that the render matches the RUNNING container before restarting anything (docker compose config diff against docker inspect of the running container).
4. NOTHING may be written outside the named paths (list them explicitly in each document: the stage directory, the secrets file, a temp dir that is removed).
5. No scratch files outside the named paths.
6. Never run anything that stops, removes or recreates containers or networks other than the one named.
7. No secrets, account names or IPs in the document.
8. Each step needs a fresh direct owner OK with a window from the orchestrator geldar-69 before it runs.
9. `--replace` stays off unless the orchestrator says so.

This request runs no compose command. Rule 1 still applies to the import script, which is a deploy script (`deploy/signoz/import.sh`).

## 1. What changes

1. SigNoz (`geldar-signoz`, version v0.148.1 per `docs/runbooks/signoz-import.md`) gets two dashboards: "Geldar Paper" (`deploy/signoz/paper-dashboard.json`)
   and "Geldar NeoForge" (`deploy/signoz/neoforge-dashboard.json`). A dashboard is matched by its title.
2. SigNoz gets the alert rules of four files: `paper-alerts-capacity.json`, `paper-alerts-server.json`,
   `neoforge-alerts-capacity.json`, `neoforge-alerts-server.json`. A rule is matched by its alert name (`.rules[].alert`).
   Every rule names the notification channel `geldar-owner-channel` in `preferredChannels`.
3. Running the import again skips a dashboard whose title is already listed (unless `--replace` is given, which deletes it by id and creates it again) and updates a rule whose alert name is listed. It does not duplicate (runbook).
4. **Step A (this request): dashboards only.** `import.sh --dashboards-only` imports item 1 and nothing else. It makes no call to any `/api/v1/rules` route and reads no channel; it prints that the alert rules were skipped.
5. **HELD: items 2 and 3 (the alert rules).** No notification channel exists in SigNoz today, so `geldar-owner-channel` is missing and a full run would stop on the rules step. The rules are a later request, run without the flag, after the owner creates the channel (section 6) and gives a separate OK for the rules step.

Nothing else changes: no container is started, stopped, recreated or restarted; no compose file, no config and no data directory is touched.

## 2. Named paths (the only places anything is written)

Operator machine (outside the repo checkout; the import script refuses a token file inside it):

- `<OP_TMP>`: one new, empty directory created at the start and removed at the end (section 10). It holds only:
  `login.json` (the login body, written by the owner, deleted after the token is written), `token.txt` (the token, first line only),
  `hdr.txt` (the `Authorization` header line for the list calls), and the list copies `dashboards-before.json`,
  `rules-before.json`, `dashboards-after.json`, `rules-after.json`.

  The `login.json` keys used are `email`, `password` and `orgId` (the org id is `data.orgs[].id` from the context call, section 5 step 4).
  The file lives only in `<OP_TMP>`, outside the repo checkout. It is never printed, echoed or copied; the commands in this request read
  `email` and `orgId` from it into shell variables only.

- `<SCRATCH>`: one new, empty directory outside the repo checkout, created before the export (section 5 step 5) and removed at the end
  (section 10). It holds only the export of `deploy/signoz/` from the merge commit: `import.sh` and the six JSON files. Nothing else is written into it.

Repo checkout: read only. The export is made with `git archive`, which reads the commit; nothing is written to the checkout and no commit is checked out.

Node: nothing is written. The node receives read-only verbs only (section 5, step 4 and section 8).

## 3. Blast radius

- SigNoz metadata only: two dashboard rows and the rule rows for the four files. The brief says these live in SigNoz's own
  ClickHouse database. **UNVERIFIED**: where v0.148.1 stores dashboards and rules.
- No telemetry data is written. The dashboards and rules read metrics; they do not act in the world (runbook section 4).
- No restart of `geldar-signoz`, `geldar-signoz-otelcol`, `geldar-ch`, `geldar-gateway`, Paper, NeoForge, any Body, Mind or other tenant.
- No effect on Paper or Body ticks. The API calls are small; the load they put on SigNoz is **UNVERIFIED** (not measured).
- Rules that fire send to `geldar-owner-channel`. Its target is the owner's and is never written here. A rule that is `firing` on
  import would send a real notification; the owner decides whether to import while the shard runs (section 11, decision 3).

## 4. Caps and window

- No cap changes (no container is changed).
- Window: owner-chosen, 30 minutes reserved, given by geldar-69 with the step OK. No Paper, NeoForge or Body restart in the same window.
- The notification channel (section 5) is created in the same window or before it.

## 5. Pre-checks (read-only)

1. Node, read-only. The output goes to `<OP_TMP>` on the operator machine, not onto the node:
   ```
   docker inspect -f '{{.State.Health.Status}} {{.RestartCount}} {{.Config.Image}}' geldar-signoz   # [UNV] expect healthy, restarts 0, image of v0.148.1
   docker ps --format '{{.Names}} {{.Status}}'                                                       # save the list
   ```
2. Operator machine: `command -v jq curl` prints two paths (the script needs `jq` and `curl`). On the Windows desktop, run the script from Git Bash, not WSL: a bare `bash` in PowerShell resolves to WSL, which does not see the desktop's `jq` or `curl`. From PowerShell, use the explicit path `& 'C:\Program Files\Git\bin\bash.exe' <script path> ...`. Run the check in that same bash, the one that will run the script, before the run: `& 'C:\Program Files\Git\bin\bash.exe' -c 'command -v jq curl'` must print two paths. The notification channel is not checked in this step: the alert import is HELD (section 6).
3. Open the SSH tunnel to the SigNoz API port named in `docs/runbooks/signoz-import.md` section 2, in its own terminal, and keep it open:
   `ssh -N -L <local port>:<loopback host>:<API port> <node ssh host alias>`, where the loopback host is the node's own loopback
   (**UNVERIFIED** for this host). Set `API` to the local end of the tunnel in the form that `import.sh --url` accepts (the runbook gives the form). Not written here.
4. Token. Get it the way the runbook says (its section 2). The owner types the account values into `<OP_TMP>/login.json` (keys `email`,
   `password`, `orgId`); nothing is printed, and the file is deleted once the token is written. `API` is the tunnel base URL (step 3).
   - Check the account and the org id with `GET /api/v2/sessions/context`. It needs the query parameters `email` (a valid address, read from
     `login.json`) and `ref` (the site URL; the loopback tunnel URL is accepted). Without `email` it returns 400 `invalid email`. The answer is
     `{status, data: {exists, orgs: [{id, name, authNSupport}]}}`. The check below prints nothing and stops the step unless the account exists
     and its org id is the `orgId` in `login.json`:
     ```
     EMAIL="$(jq -r '.email' <OP_TMP>/login.json)"
     ORG="$(jq -r '.orgId' <OP_TMP>/login.json)"
     curl -sSf -G --data-urlencode "email=$EMAIL" --data-urlencode "ref=$API" "$API/api/v2/sessions/context" \
       | jq -e --arg o "$ORG" '.data.exists == true and any(.data.orgs[]?; .id == $o)' > /dev/null
     ```
   - Log in with `POST /api/v2/sessions/email_password`, body `{email, password, orgId}` from `<OP_TMP>/login.json`. Pipe the answer and
     keep only the token; the answer is not saved:
     ```
     umask 077
     curl -sSf -X POST -H 'Content-Type: application/json' --data-binary @<OP_TMP>/login.json "$API/api/v2/sessions/email_password" \
       | jq -er '.data.accessToken' | head -n 1 > <OP_TMP>/token.txt
     test -s <OP_TMP>/token.txt
     ```
   - Write `Authorization: Bearer <token>` to `<OP_TMP>/hdr.txt` without putting the token in a command line:
     ```
     { printf 'Authorization: Bearer '; tr -d '\r\n' < <OP_TMP>/token.txt; printf '\n'; } > <OP_TMP>/hdr.txt
     ```
     Then delete `<OP_TMP>/login.json`. Never put the token in a command line or a chat.
5. Export the deploy directory from the merge commit into `<SCRATCH>`. Nobody checks out a commit. `<merge>` is `3821a376ddbcdefa0e0a05cd55765f522d25fc28`,
   the newest commit on `origin/main` that changes `deploy/signoz/import.sh` (`git -C <repo> log --format=%H -1 origin/main -- deploy/signoz/import.sh`
   gives it). Run this on the operator machine, from any directory:
   ```
   mkdir -m 700 <SCRATCH>
   git -C <repo> archive --format=tar -o <SCRATCH>/signoz.tar <merge> deploy/signoz
   tar -x -f <SCRATCH>/signoz.tar -C <SCRATCH>
   ```
   The archive is written to a file first and never piped into `tar`, so a failed export is not half-read. `signoz.tar` stays inside `<SCRATCH>` and is removed with it.
   `ls <SCRATCH>/deploy/signoz` must list `import.sh` and the six JSON files (two dashboards, four alert files). Any other file stops the step.

Stop if `geldar-signoz` is not `healthy`, its restart count is not 0, or `command -v jq curl` does not print two paths.

## 6. Notification channel prerequisite: alert import HELD (owner decides the window)

- **Status: no notification channel exists in SigNoz today.** `geldar-owner-channel` is missing. The alert import (section 7 step 6) is HELD until the owner creates it. Step A (dashboards only, section 7 steps 1-4) does not need it.
- The four alert files name `geldar-owner-channel` in `preferredChannels`. The import script imports rules, not channels. A rule that names a
  missing channel is refused or has no route (runbook section 1).
- Create the channel in the SigNoz UI with exactly that name. **UNVERIFIED**: its type and receiver settings. The receiver target is the
  owner's and is entered by the owner in the UI; it is never written in this file, the repo or a log.
- Check it exists in the UI (read-only) before section 7 step 6 (the rules step).

## 7. Dry run, list output, then the real run

Run from the export in `<SCRATCH>/deploy/signoz` (section 5 step 5), on the operator machine. The script finds its files next to itself, so
the export is all it needs; the token file in `<OP_TMP>` is outside `<SCRATCH>`, so the script accepts it.

1. Dry run, dashboards only (sends nothing and reads no token; the flag keeps it off every rules and channel route):
   ```
   $env:GELDAR_SERVICE_UID = '1001'; & 'C:\Program Files\Git\bin\bash.exe' <SCRATCH>/deploy/signoz/import.sh --dry-run --dashboards-only
   ```
   Expect one `dry-run:` line per dashboard file (2), the line `alert rules skipped (--dashboards-only): 4 alert file(s) not imported ...`, and the line `dry run against ...: nothing will be sent`.
   Any other output stops the step.
2. List the dashboards now (the list call is the UNVERIFIED shape check; no rules list is read in this step):
   ```
   curl -sS -H @<OP_TMP>/hdr.txt "$API/api/v2/dashboards" > <OP_TMP>/dashboards-before.json
   ```
   `$API` is the tunnel base URL (step 5.3). Routes and list shapes: verified in the SigNoz v0.148.1 source (section 13); the live shapes are still read here.
3. Read the shape before the real run. Record the answers in the report (not in the repo):
   - dashboards: top-level keys; `.data.dashboards` is an array; each item has `.id` and `.spec.display.name`; how many items have the titles
     "Geldar Paper" or "Geldar NeoForge" (`jq -r '.data.dashboards[]?.spec.display.name'`).
   - If the list call returns another shape, or is an error, stop. The script stops before its first write (it reads the list first). The fix is a
     new packet that changes the script and its test together (runbook section 1), not this request.
4. The real run, dashboards only, only after the owner OK for this step:
   ```
   $env:GELDAR_SERVICE_UID = '1001'; & 'C:\Program Files\Git\bin\bash.exe' <SCRATCH>/deploy/signoz/import.sh --token-file <OP_TMP>/token.txt --dashboards-only
   ```
   Expect `created` or `skipped` per dashboard (`skipped` when the title is already listed), the line `alert rules skipped (--dashboards-only): 4 alert file(s) ...`, then `done: 2 dashboard file(s), 0 alert file(s)`. Any `error` line stops the step; do not re-run it blindly.
5. The dashboards are verified in section 8 (steps 1, 3, 6). The alert rules are not touched by this step.
6. **Alert rules: HELD, a later request.** Only after the owner has created `geldar-owner-channel` (section 6) and the owner gives a separate OK for the rules step:
   dry run without the flag (`<SCRATCH>/deploy/signoz/import.sh --dry-run`), then list the rules (`curl -sS -H @<OP_TMP>/hdr.txt "$API/api/v1/rules" > <OP_TMP>/rules-before.json`), then the real run without the flag (`GELDAR_SERVICE_UID=1001 <SCRATCH>/deploy/signoz/import.sh --token-file <OP_TMP>/token.txt`). Expect `created` or `updated` per rule, then `done: 2 dashboard file(s), 4 alert file(s)`. Sections 8 steps 2 and 4 apply to this step, and its rules rows must be recorded in its own report.

## 8. Verification (after the real run)

1. Dashboard list after the run (`dashboards-after.json`): "Geldar Paper" and "Geldar NeoForge" each appear exactly once.
   The script refuses to update when a title appears twice, so a second match is a finding. (Rules list after the run, `rules-after.json`, only in the rules step, section 7 step 6.)
2. (Rules step only.) Each alert name in the four alert files appears exactly once in `rules-after.json`. The names come from the files:
   `jq -r '.rules[].alert' <SCRATCH>/deploy/signoz/*-alerts-*.json`.
3. In the SigNoz UI, through the tunnel, open "Geldar Paper" and "Geldar NeoForge". While the shard runs, panels with a live metric
   (for example `geldar_tps`, `geldar_tick_lag_ms`, `geldar_players_online`, runbook section 4) show points for the last hour.
   A panel empty on a stopped shard is expected; a panel empty while the shard runs is a finding.
4. (Rules step only.) The rules list shows each Geldar rule once with a state. `inactive` is normal. A `firing` rule is reported to the owner at once.
5. (Rules step only.) Second run, only if the owner OK covers it: `<SCRATCH>/deploy/signoz/import.sh --token-file <OP_TMP>/token.txt` prints `skipped` lines for the dashboards and `updated` lines for the rules, and
   no `created` line, and the lists keep the same counts. (This shows idempotence; it writes the same content again.)
6. Node, read-only: `docker ps --format '{{.Names}} {{.Status}}'` equals the list saved in section 5. The start times of
   `geldar-signoz`, `geldar-signoz-otelcol`, `geldar-ch`, `geldar-ch-keeper`, `geldar-gateway` and the Paper and NeoForge containers are
   unchanged. [UNV: the inspect format; use `docker inspect -f '{{.Name}} {{.State.StartedAt}}'`.]

Any failed check stops the step, and the owner is told the check number.

## 9. Rollback (delete by title and alert name)

Rollback removes what the import created. It does not restore an earlier version of an updated dashboard or rule, unless the
pre-run copy is put back (step 3 below). Rollback needs the owner's OK in the same way.

1. From `dashboards-before.json` and `rules-before.json` (and the after copies), list the ids of the items that were NOT there before the import:
   the titles "Geldar Paper" and "Geldar NeoForge", and the alert names of the four files, found in the after copies but not the before copies.
2. Delete each of those created items: `curl -sS -X DELETE -H @<OP_TMP>/hdr.txt "$API/api/v2/dashboards/<id>"` and
   `curl -sS -X DELETE -H @<OP_TMP>/hdr.txt "$API/api/v1/rules/<id>"`. Route and method verified in the source (section 13).
3. Dashboards: the default run never changes an existing dashboard (it skips a listed title). `--replace` deletes one by id and creates it again, and the v2 list row holds only the id, the name and the display title (no panels), so a replaced dashboard cannot be restored from `dashboards-before.json`; the repo JSON is the source for a new import. For a rule that was UPDATED (it was in the before copy): put back its body from the before copy with `PUT /api/v1/rules/<id>`. **UNVERIFIED**: whether the rule list row carries the whole rule body (`GettableRule` embeds `PostableRule`, so it is expected to; check the copy).
4. List again. No created title or alert name remains; updated ones show the before content.
5. Rules deleted by this rollback lose their history in SigNoz. That is an owner decision (section 11).

## 10. Clean up

- Remove `<OP_TMP>` with all its files (`Remove-Item -Recurse -Force` or `rm -rf` on that one directory only), once the report is written.
- Remove `login.json` as soon as `token.txt` exists (step 4 of section 5).
- Remove `<SCRATCH>` (the export of `deploy/signoz/`) with `rm -rf` on that one directory, once the report is written.
- Close the tunnel.
- The token is not revoked by this step. **UNVERIFIED**: whether a token can be revoked through the API; the owner decides.

## 11. Must not touch

- Every container on the node (section 8 step 6), the SigNoz data directory, ClickHouse data and users, the SigNoz collector and its config.
- The notification channels other than `geldar-owner-channel`, and the alert rules of other tenants.
- Paper, NeoForge, Velocity, Body and Mind containers and their config. Nothing in this request restarts them.
- The repo: no file is edited. `docs/analysis/telemetry/RESUME.md` is not touched by this request.

## 12. Owner decisions

1. Go or no-go, and the window (geldar-69 gives the OK).
2. The notification channel: its type and receiver, entered by the owner in the UI.
3. Import while the shard runs (rules may fire at once) or while it is stopped (panels empty; rules inactive).
4. Accept the UNVERIFIED routes and list shapes for this run (the first real run is the check on them).
5. Whether a rollback may delete rules and so their history.

## 13. Verified and UNVERIFIED

Verified in the SigNoz v0.148.1 source (`gh api repos/SigNoz/signoz/contents/<path>?ref=v0.148.1`; the paths are relative to the repo root):

- Login: `GET /api/v2/sessions/context` reads the query parameters `email` (a valid address) and `ref` (the site URL), and answers
  `{status, data: {exists, orgs: [{id, name, authNSupport}]}}` (`pkg/modules/session/implsession/handler.go`, `GetSessionContext`;
  `pkg/types/authtypes/session.go`). `POST /api/v2/sessions/email_password` reads the body fields `email`, `password` and `orgId`
  (`pkg/types/authtypes/email_password.go`, `PostableEmailPasswordSession`). Without `email` the context call returns 400 `invalid email`.
- Rule routes: GET and POST `/api/v1/rules`, GET, PUT, DELETE and PATCH `/api/v1/rules/{id}`. `pkg/query-service/app/http_handler.go` lines 363-368 (`RegisterRoutes`).
- Rule list: `listRules` answers with `aH.Respond(w, rules)`, which writes `{status, data}` (`writeHttpResponse`, same file). `ListRuleStates` returns `GettableRules` (`pkg/query-service/rules/manager.go`, line 853), so `data` is `{rules: [...]}`; each `GettableRule` has `id` and embeds `PostableRule`, whose name field is `json:"alert"` (`pkg/types/ruletypes/api_params.go`, lines 643-660).
- Dashboard routes are v2: GET and POST `/api/v2/dashboards`, GET, PUT, PATCH and DELETE `/api/v2/dashboards/{id}` (`pkg/apiserver/signozapiserver/dashboard.go`). That the v1 dashboard routes are gone is the finding the brief records; this session did not re-read the v1 routes.
- Dashboard list: `ListV2` answers `{status, data: {dashboards, total, tags, reservedKeywords}}` (`pkg/modules/dashboard/impldashboard/v2_handler.go` line 143 and `pkg/types/dashboardtypes/list_v2.go`, `ListableDashboardV2`). Default page 20, capped at 200. Each row has `id` (`pkg/types/identity.go`, `Identifiable`), `name` (the DNS-1123 name, not the title) and `spec.display.name` (the title, `Display` in `pkg/types/dashboardtypes/perses_replicas.go`).
- Create: `CreateV2` (`v2_handler.go` lines 23-80) converts a body with `version` and no `schemaVersion` from v1 (`ConvertV1ToV2`), then answers 201 with `{status, data}` (`render.Success`, `pkg/http/render/render.go`). The v1 title becomes `spec.display.name` (`pkg/types/dashboardtypes/perses_v1_to_v2.go`, line 65, clipped to the display-name limit).

**UNVERIFIED** (still open after the source check):

- That `POST /api/v1/rules` accepts the rule bodies in the four alert files. The script sends each `.rules[]` object unchanged; the server's validation was not read.
- That the v1 dashboard files (`version: v4`, no `schemaVersion`) convert to v2 as intended. Only the title mapping is read here; panels, variables and queries are not checked.
- The paging on a node with more than 200 dashboards (the test uses a fake two-page list).
- The notification channel `geldar-owner-channel`: its type, its receiver settings, and whether `POST /api/v1/rules` accepts the `preferredChannels` field.
- Where SigNoz v0.148.1 stores dashboards and rules.
- The `--replace` path and the rule `PUT` on a live node.
- `--replace` deletes the dashboard before it POSTs. If the POST fails, the dashboard is missing until the next run recreates it (`docs/runbooks/signoz-import.md`).
- Whether a token can be revoked through the API, the `docker inspect` format strings, and the tunnel form (carried over from sections 5 and 10).
 (the orchestrator records it; this request edits no repo file)

UTC start and end; the dry-run output; the shapes found in section 7 step 3; the import output lines; the result of each check in section 8;
the rule and dashboard count before and after; whether the second run was done; the rollback used, if any; and the node's container list
before and after (names and start times only).
