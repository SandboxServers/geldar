# Runbook: the NeoForge shard MCP behind the shared Caddy (nf-mcp)

Owner: the operator on the Colo node. Approvals: geldar-69. Scope: the Caddy site `mcp.neoforge.<domain>` for the NeoForge
shard's MCP, its kill switch, and the one restart that applies them. Nothing else on the node changes.

## Check this first

- **On the Colo node `caddy reload` FAILS.** The shared Caddy (container `board-proxy`) has its admin API OFF (owner ruling R39).
  geldar-69 believed reload works; `deploy/caddy/README.md` ("Reload procedure") says it does not. The apply step below is
  therefore a restart, not a reload.
- **The apply is one restart of `board-proxy`.** It interrupts EVERY site behind it (map, glass, mcp, the agents' ingest) for an
  estimated 5 to 15 seconds. **Needs the owner's approval through geldar-69 before the restart.** Do not run Step 7 without it.
- **Reload as an alternative is UNVERIFIED.** `docker exec board-proxy caddy reload` may work with the admin API off, or may fail.
  Test it only with a validation first (Step 3 pattern), never on the live site as the first try. Do not write it into the
  apply step as if it were known to work.
- **Bare `install` now includes nf-mcp.** After this change `colo-public.sh install` with no site names makes all four sites live,
  so it needs `GELDAR_NF_MCP_UPSTREAM` too. Use `install nf-mcp` (named) for this change.
- **DNS first.** The owner creates the `mcp.neoforge` record (a CNAME to `<edge-target>`, the same target as the `mcp` record: look
  it up at packet time). Caddy cannot issue the certificate until the record resolves. Do Step 0 before the apply.

Placeholders: `<domain>` (the project domain), `<edge-target>`, `<node-loopback-port>` (the NeoForge MCP's loopback port), `<player-id>`,
`<stage-dir>`, `<backup-dir>`, `<time>`. Real values live on the node only, never in this repo or in a pasted log.

## Step 0: DNS (owner)

The owner creates `mcp.neoforge.<domain>` as a CNAME to `<edge-target>`.

Check (read-only, from the workstation):

```bash
dig +short CNAME mcp.neoforge.<domain>
```

Expected: `<edge-target>.` (the same answer as `dig +short CNAME mcp.<domain>`). If it is empty, stop: wait for the owner.

## Step 1: stage the new files

Copy the two files and the validator change to a stage directory on the node. The repo checkout is the source; the node is
never built from a branch.

```bash
mkdir -p <stage-dir>
cp deploy/caddy/nf-mcp.caddy deploy/caddy/nf-mcp-off.caddy <stage-dir>/
ls -l <stage-dir>
```

Expected: `nf-mcp.caddy` and `nf-mcp-off.caddy`, both non-empty (about 1 KiB and 0.4 KiB). Rollback: `rm -r <stage-dir>` (nothing
is installed yet).

## Step 2: baseline (read-only, before anything changes)

Record the status of every existing public URL, so that Step 6 can compare status for status. One request per site:

```bash
for u in https://map.<domain>/ https://glass.<domain>/ https://mcp.<domain>/p/<player-id>; do
  printf '%s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "$u")"
done | tee <backup-dir>/baseline.txt
```

Expected: three lines, each with the status the site gave yesterday (write them down: a 401 on the MCP path without a token is
normal). Also record the rcon player count, with the read-only `list` verb (rcon, not a write):

```text
list
```

Expected: `There are 23 of a max of <max> players online` on the autonomous shard. If the count is not 23, stop and tell the owner
before the restart: the count is the agents' check that Caddy restarts did not drop them.

Rollback: none needed (read-only).

## Step 3: throwaway validation of the combined config (no change to the live site)

Validate the live Caddyfile with the new file in it, in a throwaway container from the same Caddy image, using the real
Caddyfile and a copy of the staged file set. `caddy validate` reads the file; it does not load it.

```bash
docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

This checks the current config only. To check the combined config, put the staged `nf-mcp.caddy` next to the installed sites in
a copy and validate that copy with the same image as the container:

```bash
docker run --rm -v <stage-dir>:/etc/caddy:ro <caddy-image> caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Use the image digest the node's Caddy runs (`docker inspect -f '{{.Image}}' board-proxy`). The `<stage-dir>` Caddyfile needs the
`import` line and the placeholder values from the node env file; it is validated, never started.

Expected: `Valid configuration`. Any other output: stop, do not install. Rollback: none (nothing changed).

## Step 4: diff against the installed copy

```bash
diff -u /config/geldar/nf-mcp.caddy <stage-dir>/nf-mcp.caddy || true
```

Expected on the first install: `No such file` for the installed copy, which is correct. On a later change: only the intended lines.
Read the diff before the next step.

## Step 5: back up the installed copy

```bash
mkdir -p <backup-dir>
sudo cp -p /config/geldar/nf-mcp.caddy <backup-dir>/ 2>/dev/null || true
sudo cp -p /etc/caddy/Caddyfile <backup-dir>/Caddyfile
ls -l <backup-dir>
```

Expected: `Caddyfile` in the backup dir (and `nf-mcp.caddy` when it existed). The `colo-public.sh install` step also writes
`<file>.bak-geldar-<time>` itself. Rollback: `sudo cp -p <backup-dir>/Caddyfile /etc/caddy/Caddyfile`.

## Step 6: in-place write (the install)

Set `GELDAR_NF_MCP_UPSTREAM=127.0.0.1:<node-loopback-port>` in the node env file (`GELDAR_PUBLIC_ENV`), which the operator edits. It
is set there and not in this repo. The NeoForge MCP stays bound to the node loopback; Caddy reaches it at that address.

Then install the one site, in restart mode, WITHOUT the restart flag (the script validates and prints the restart note only):

```bash
GELDAR_PUBLIC_APPLY=restart deploy/colo-public.sh install nf-mcp
```

Expected: `colo-public: files installed and validated; RESTART board-proxy once to apply (docker restart board-proxy)`. The other sites
keep their state. A failed validate restores the Caddyfile and the previous site files byte for byte. Rollback: the script's
`remove` restores the Caddyfile and removes the nf-mcp import, or `GELDAR_PUBLIC_APPLY=restart deploy/colo-public.sh off nf-mcp`
switches the site to its kill switch (still needs Step 7 to apply).

## Step 7: apply (the restart; needs the owner's approval through geldar-69 before the restart)

This interrupts every site behind the shared Caddy for an estimated 5 to 15 seconds. Do it only with the owner's approval recorded in
geldar-69, and at the time the owner names.

```bash
docker restart board-proxy
docker ps --filter name=board-proxy --format '{{.Names}} {{.Status}}'
```

Expected: `board-proxy Up <seconds> seconds`, within 30 seconds. If it does not come up, restore the backup
(`sudo cp -p <backup-dir>/Caddyfile /etc/caddy/Caddyfile`, then `docker restart board-proxy` again) and tell the owner.

## Step 8: read-only checks after the apply

1. The existing sites answer as in the baseline (Step 2). Same statuses, status for status:

   ```bash
   for u in https://map.<domain>/ https://glass.<domain>/ https://mcp.<domain>/p/<player-id>; do
     printf '%s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "$u")"
   done
   ```

2. The Colo agents still answer: rcon `list`, expected `There are 23 of a max of <max> players online`.

3. No new auth refusals. In SigNoz, open the query on the metric `mcp.auth_refused` (look it up by that metric name) and compare
   the last 15 minutes with the same window before the restart. Expected: no increase. An increase is a stop: roll back (Step 9).

4. The new site, read-only:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://mcp.neoforge.<domain>/
   curl -s -o /dev/null -w '%{http_code}\n' -X PUT https://mcp.neoforge.<domain>/p/<player-id>
   curl -s -o /dev/null -w '%{http_code}\n' https://mcp.neoforge.<domain>/p/ag-turbored-01
   ```

   Expected: `404` on `/`, `405` on `PUT`, and `401` (or the MCP's own refusal) on `/p/ag-turbored-01` without a token. Any `200`
   on the MCP path without a token is a stop: roll back at once.

## Step 9: rollback

The kill switch, which is the rollback for the site itself:

```bash
GELDAR_PUBLIC_APPLY=restart deploy/colo-public.sh off nf-mcp
docker restart board-proxy   # needs the owner's approval through geldar-69, as Step 7
```

Expected after the restart: `mcp.neoforge.<domain>` answers `503` with `{"error":{"code":"unavailable","message":"Service unavailable"}}`,
and the other sites match the baseline. To remove the site altogether, restore the backup Caddyfile (Step 5) and restart once more.
Never restart Caddy for any other reason.

## Record

Write the baseline, the apply time, the owner's approval reference and the Step 8 results in the geldar-69 thread. Do not paste
hostnames, tokens or IP addresses into it.
