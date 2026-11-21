# World operations: resume card

Campaign: world operations (session geldar-worldops, decision block 0250-0259; 0250 is the skin upload visibility and export decision). Owner of live Colo shard operations and measurement. Docs and tools only in the repo.

**Rules**
- Node work goes through ops agents. Node reads default to read-only.
- Admin verbs only with geldar-93's go and the node env exported (`GELDAR_COLO_ROOT=/mnt/nvme/geldar-colo/src` and the rest), run from that dir, never from a `/var/lib/geldar-deploy` work dir.
- Check `docker ps | wc -l` before and after. Never stop, remove or recreate containers except for explicit tasks.
- Never print tokens or keys.
- Owner's private config folder: only write `<id>.token` files and signed skin JSON (owner's standing permissions). Never read or list it.

**Done 2026-11-14/15**
- After-counts for deploys through 03:20Z: memory addenda 20-32 in the change-windows memory file.
- Live checks: speech bubble expiry inconclusive (BlueMap write lag up to ~25 s); proximity not testable from node data; ownership counters verified (#396).
- Grave backfill duplicated 91 graves. geldar-93's coder is fixing idempotence. Do NOT rerun the backfill.
- edit_sign facts from the throwaway shard (10/11 at 1fce4f89; update accepted for 1-8 blocks; honeycomb waxes without an editor). Outputs in a local results folder; shard torn down.
- Runbooks merged: signcheck-shard (#374 #376 #422), nats-auth-inplace (#397 #417 #419), node-only-config (#418).
- players-cli: unlisted default and JSON export (#407, decision 0250). Owner cap raised 9 -> 15.
- Residents: Lewis and Clark live since 01:22Z; Chapman and MacDonald Bodies up 03:41Z and 03:44Z (Minds by scriptorium).
- Glass restarted 01:23:40Z and 03:40:29Z.

**Open**
1. Wait-delta (decision 0221) for ONE agent, ag_trini_01, via the MCP env. Discovery by an ops agent is in progress. Then: back up the env file, set the flag, restart ONLY MCP once, verify the env and a Trini wait result, report the UTC time to geldar-93, geldar-economy and geldar-behavior. Rollback: remove the variable, restart MCP.
2. After-counts for the use verb enable (deploys 02:56:31Z and 03:01:31Z) and USE_MESSAGE; wording change deploy pending from geldar-ops. hazard_escape log lines (oxygen fields) still unseen.
3. Dependabot: hono 4.13.14 -> 4.13.16 and @hono/node-server 2.1.5 -> 2.1.6, together. Eligible 2026-11-16 after 10:22Z (pnpm-workspace.yaml overrides). Check main's lockfile first.
4. Keep docs/runbooks/merge-queue.md accurate: queue is on; no deploy windows; colo-deploy follows colo-images; docs-only merges do not deploy.
5. The NATS in-place batch (sheet state deny, hearing deny, supervisor/register/helper users) waits for geldar-93's go and PR #415.
6. The Glass aliases Meriwether, William, Johnny and MacDonald are live.

**Parked for the owner**
- MineSkin visibility of the Lewis, Clark, Chapman and MacDonald uploads is unconfirmed through the API (dashboard check needed).
- Old deploy work dirs under /var/lib/geldar-deploy/work are never pruned, and each holds about 4,400 inodes (the 2026-11-20 deploy failures were inode exhaustion). `deploy/genesis/prune-deploy-work.sh` is the tool: dry run first, then `--apply` with the owner's word. Not installed or run by the repo; `deploy/colo-status.sh` warns at 80% inodes.

**Traps**
- Ops agents run from stale worktrees: read runbooks with `git show origin/main:<path>`.
- Desktop is short of memory: no full test suites, no pnpm install.
- The pwsh -File wrapper leaks vitest filters: run vitest directly from Git Bash.
- Empty GELDAR_NATS_URL (defined, empty) turns the life registry off; unset defaults to 127.0.0.1:4222.
