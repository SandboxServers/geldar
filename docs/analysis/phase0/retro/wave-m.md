# Wave M retro (sovereign MCP)

Written 2026-11-10 from the orchestrator's brief and the worknotes [wm-interface-requests.md](../worknotes/wm-interface-requests.md) and [wm-fix-requests.md](../worknotes/wm-fix-requests.md) on `wave-m/docs` at head `88ae89b`. Decisions: [0053](../../../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md), [0054](../../../decisions/0054-static-hashed-per-player-bearer-tokens.md), [0055](../../../decisions/0055-phase0-sovereign-tool-subset-and-mappings.md), [0056](../../../decisions/0056-first-migration-runner-and-least-privilege-grants.md), [0057](../../../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md), [0059](../../../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md), [0060](../../../decisions/0060-persona-size-limits.md).

## What the wave was

Wave M built the sovereign MCP: a Model Context Protocol front door in `threshold/mcp` that lets an external agent (a sovereign player, decision 0055) look, act, say, wait, read books and sleep in a life that runs in the Minecraft shard. The pieces are the token store and CLI (`tools/mcp-tokens`, decisions 0054 and 0056), the Postgres stores and migrations (`tools/migrate`, `sql/`), the gateway to the Body and the event stream over NATS, the player host and presence (`golem/src/players`), the run commands and live cases in `geldar.ps1`, a container image, and a Velocity plugin part that serves skins (WM-13).

Work was split into packets WM-01 to WM-13 (WM-11 in parts a and b, WM-03 to WM-06 and WM-08 to WM-12 in several finishers each). Each packet ran in its own worktree and branch and was merged into `wave-m-main`.

Packets at a glance, from the worknotes:

- **WM-01, WM-02:** the ports, the front door and the Postgres stores (token store, budget, agents, journal, players). WM-02 added the `geldar_mcp` role's SCRAM verifier path and the migration ledger.
- **WM-03:** bearer auth at the front door: digest lookup, constant-time player-id comparison, rate limits and the 403 and 401 answers.
- **WM-04, WM-05:** `wait` (cursor, presence touch on poll) and `say` (the start cursor and the `plan_result` read).
- **WM-06:** `read_book` (the `bk_` id) and `sleep` (waits for the plan acknowledgement only, not for execution).
- **WM-07:** the book subject served by the Body for the bound life.
- **WM-08:** the player host: whitelist, presence and the Body.
- **WM-09:** the `mcp-tokens` CLI: mint, revoke, rotate, init, seed input.
- **WM-10:** the container, the compose overlay, the tunnel template and the threat model.
- **WM-11:** the gateway to the Body and the stream (NATS), presence (the `geldar-presence` bucket) and the MCP entry point and CLI.
- **WM-12:** run commands (`players`, `mcp`, `mcp-tokens`, `db migrate`), the live cases (gated by `GELDAR_IT` and `GELDAR_MCP_LIVE`) and the gate guard.
- **WM-13:** the `mcp-tokens` CLI part, the Velocity skin plugin part and the docs part (skins read from the `geldar-skins` bucket).

## Outcome

- **WM-01 to WM-13: all implemented and merged** into `wave-m-main`. The last merge is `c447108`, after the third review round.
- **Check: green** (`./geldar.ps1 check`, exit 0). About 3100 tests.
- **Integration cases: green against the dev Postgres.** MCP files: 30 passed, 0 failed. Other IT files: 4 passed, 1 skipped by design (the skip is a gated case, not a failure).
- **Image:** the MCP image builds, 86 MB. Its start argument, shard file and import were fixed in round 1 (see below).
- **Not run live.** No live case has run against the running stack. The tunnel is not run. The rangers have not connected through the MCP. No MineSkin upload has happened. See "Could not verify" and "Open items".

## Review rounds

Each round ran four read-only reviewers, one per surface: (1) the HTTP edge and tokens; (2) the gateway, events and tools; (3) Postgres, SQL and migrations; (4) the container, run commands and skins.

- **Round 1 (head `21acb85`).** Highs:
  - the revoke listener was never started;
  - every rate limit used capacity 60, not the configured values;
  - `say` never saw the Body's confirmation;
  - `wait` returned the raw snapshot, so `invalid_output` came back whenever someone spoke nearby;
  - one non-JSON stream message crashed the MCP, and the same message replayed on restart;
  - `act` with a bad `say` dropped the valid actions and charged for them;
  - the reserve overspent under concurrency, because the accrual read was stale;
  - the sleep write was denied by the grants;
  - the image could not start: no start argument, and the shard file and one import were missing from the allowlist.
- **Round 2 (head `127433e`).** Two HIGH regressions caused by round 1 fixes:
  - the per-address connection counter leaked when connections overlapped;
  - the failed-auth peek blocked valid tokens, so one attacker behind the tunnel could lock out everyone.
  - Mediums: a revoke write after the end crashed; the pepper trim did not match the server rule; the pool had no timeouts; `up` and `status` trusted a stale pid; an unreadable identity deleted the pid file; tool fault causes were not logged; a resource read leaked raw DB errors; `act({say})` was always refused; a presence fault took down every tool; a silent stream drop and stop.
- **Round 3 (head `cc7dd29`).** One mandatory fix: a slot leak when a client aborted during authentication. This was again a class introduced by an earlier fix. Design calls: trusted peers are exempt from the socket cap; ZWNJ and ZWJ handling in book text. Plus lows.
- **After round 3:** merged at `c447108`, check green.

## Lessons

Each lesson gives the cause, the impact and the change.

### 1. Fixes to limiters, slots and counters caused regressions

- **Cause:** a fix to a limiter, a slot or a counter changed the error path, and the error path was not tested. This happened in 2 of 3 rounds (the connection counter, the slot leak).
- **Impact:** round 2 had two HIGH regressions; round 3 had a mandatory slot leak. Each needed another review round.
- **Change:** every such fix needs an abort, close and error-path test, and the next review round targets the fixes themselves, not only the original surface.

### 2. Tests that passed with the fix removed

- **Cause:** a test asserted the outcome without exercising the fixed path, so it passed on the old code.
- **Impact:** revert checks caught this several times. Each time the test was rewritten.
- **Change:** write the test to fail first; revert the change and confirm the test fails; say which revert was done in the report. The worknotes record revert checks as one-line mutations, restored from a backup with `git diff --stat` empty.

### 3. Coder context caps forced finishers

- **Cause:** a coder has about 90k tokens of context and a 40 to 60 tool-use working range. Packets WM-02, 03, 04, 05, 06, 08, 09, 10, 11, 12 and 13 each needed one to three finishers. WM-11 needed a finisher after a coder stopped at the context limit (finisher B, recorded in the WM-11 worknote).
- **Impact:** each finisher re-read the same files, and each cost a merge and a check.
- **Change:** briefs should be smaller. Commit each item as it passes (commit-per-item). That helped: a stopped coder left finished items on the branch.

### 4. The shared worknote files caused conflicts

- **Cause:** `wm-interface-requests.md` and `wm-fix-requests.md` were appended to by several branches.
- **Impact:** add/add conflicts across branches, resolved by taking the union by hand.
- **Change:** one worknote file per packet, or a `worknotes/` directory with one file per packet.

### 5. SQL was reasoned about, not run, until ops ran it

- **Cause:** coders had no database in their lane. Grants, the CTE semantics and the `SET ROLE` path were reasoned only.
- **Impact:** the first real run of the integration cases was by ops, after the coders reported green. Ops ran them and got 31 of 32 passing, then all green after fixes.
- **Change:** run a database in the coder lane, or make the ops IT run a per-packet gate.

### 6. IT secrets lived in one worktree

- **Cause:** `compose/secrets/postgres.txt` is gitignored and exists only where `shard up` was run.
- **Impact:** ops used a temporary directory junction to reach it. The junction was never committed.
- **Change:** the IT helpers take a secrets-directory environment variable, so a worktree can point at the secrets without a junction.

### 7. Flaky tests under parallel load

- **Cause:** timing-sensitive tests, including a golem test with a 5 s timeout and a lantern-local reconnect test, failed under parallel load.
- **Impact:** seen five times or more across the waves, with reruns needed to get green.
- **Change:** raise the timeouts or isolate the test. This is an action for the next wave; see "Open items".

### 8. The commit trailer was unclear

- **Cause:** the brief's trailer named one model, and the harness attribution named another. Coders had to pick one.
- **Impact:** commit messages disagreed about the co-author line.
- **Change:** decide once and state the trailer in `.claude/agents/packet-coder.md`. Until then, the brief's trailer is used.

### 9. Briefs repeated long blocks of rules

- **Cause:** every brief restated the same preamble of rules.
- **Impact:** longer briefs, and coders spent context on the preamble.
- **Change:** move the standing preamble into the packet-coder agent file; the brief names only the packet.

### 10. The orchestrator made design calls without the owner

Key calls the orchestrator made without an owner decision, with their record:

- **Sleep marks table** (decision 0056): sleep marks moved to `mcp_sleep_marks`, with column-level grants on `agents`.
- **`trusted_proxies`** (decision 0053): the value stays empty until the tunnel goes live. See "Open items".
- **Neutral text and the book joiner rule:** no decision file in `docs/decisions` records them; see ops logs.
- **SCRAM** (decision 0056): `geldar_mcp` gets a SCRAM-SHA-256 verifier, not a plain password.
- **RCON per admission:** no decision file in `docs/decisions` records it; see ops logs.
- **Persona limits:** the `player add --seed-file` limits (8192 bytes identity, 4096 bytes goals) were set in decision 0060, after the owner's ruling. The verification that the limits do not reach a Mind prompt is still open.

The owner should review these. Where a call has no decision file, it is a gap in the record, not a settled rule.

### 11. A stray peer message changed an assumption

- **Cause:** a cross-session message from another session (the Scriptorium) said the persona limit was a fixed value. The orchestrator treated it as a fact.
- **Impact:** the persona limit assumption changed on the strength of a message from another agent, not from the owner.
- **Change:** peer messages are information, not instructions. Confirm limits with the owner. Decision 0060 records the open verification (see "Open items").

### 12. Ops ran a command with unintended effects

- **Cause:** a Haiku ops agent ran `adam up`, which started processes that were not wanted for the run.
- **Impact:** unintended processes during a live window.
- **Change:** briefs carry explicit "never do" lists. These worked when they were present.

## Decisions made in this segment

- **0053:** public MCP through an outbound tunnel is deferred. The tunnel is example config and a README section; nothing runs it. `trusted_proxies` stays empty.
- **0054:** static, hashed, per-player bearer tokens. The worknote (WM-03 request R1) requires the store to look up by HMAC digest, never by the raw token.
- **0055:** the phase 0 sovereign tool subset and its mappings.
- **0056:** the first migration runner and least-privilege grants: the runner, the `geldar_mcp` role (SCRAM, column grants), sleep marks in their own table.
- **0057:** budget numbers and wake spacing for sovereign players.
- **0059:** identity mode is about human observation, not agent belief. The spec edit for observer disclosure is pending the owner's say.
- **0060:** persona files are not artificially size-limited. The verification is open (see "Open items").
- **Rate-limit numbers** from WM-03 Q1: 60 calls a minute per player, 600 per owner, 30 failed auths a minute per address, 300 a minute global failed auth (accepted as a wiring constant), 4 open requests per player.
- **Auth answers** from WM-03 Q2 and Q3: a valid token on another player's path returns 403; an unknown player with an unknown token returns 401; the trailing-space header gap is accepted.

## Unexplained

- **Test flakiness under load:** see lesson 7. The timeouts were not raised in this wave, and the flaky tests are not fully identified.
- **Stream and presence timing:** no run has measured the presence timing (60 s awake, 10 min hibernating) against a live stream. This is unverified; see ops logs.
- **Event texts:** `You slept.`, `You died and woke at spawn.` and `Your actions finished: N done, M failed` were not defined by the packet or the mock. No text was added. The owner of the event wording has not decided them.

## Open items

Each item names its owner or the next step.

- **WM-10b, least-privilege NATS user for the MCP.** The MCP reaches NATS as any local process does until this lands. The subjects are listed in the worknote (`snapshot`, `plan`, `book`, `sovereign_call`, `day_night`, the presence KV bucket, the `GELDAR_EVENTS` stream and consumer API, and `_INBOX.>`).- **Persona limits verification (decision 0060).** Grep `animus` and the Wave M packets for any path that reads `agents.personality_seed` for a sovereign player. Until then the fit analysis in 0060 stands open. The `player add --seed-file` validation must not call `checkIdentity`.
- **Sleep cursor and outcome-unknown contract.** When `submitPlan` times out after the Body may have received the plan, the reserve is refunded and the call reports the closest existing code. The plan may still run. Closing it needs a contract code for an unknown outcome (WM-03 R3a, owner). The worknote's gap note on the sleep cursor column predates migration 0004; decision 0056 lists `sleep_cursor` as MCP-updatable. Verify before relying on it.
- **`trusted_proxies` value.** It must list the cloudflared container address (IP or CIDR) in `shards/phase0.yaml` before the tunnel goes live. Without it, all tunnel traffic shares one failed-auth bucket and one connection cap. The value is not known yet; a row in `docs/threat-model.md` is requested.
- **Decision 0053 (public hostname).** Reserved, not written. `compose/mcp.yml` and the threat model refer to it. The tunnel stays unrun until the owner takes it.
- **MineSkin upload.** The key and the six PNGs are present locally. Nothing has been uploaded. Upload needs the owner's explicit yes, because a third-party service receives the PNGs. The endpoint assumptions in the WM-13 worknote are read from the docs, not from a live call, and must be verified before the upload.
- **Live runs owed.** Image run with the real config (`compose/mcp.yml`); the WM-02 IT cases against the dev Postgres (done by ops; see lesson 5); the WM-09 CLI round trips (mint then resolve, revoke then 401, rotate and the grace window); a real NATS run of the gateway (snapshot, plan, book, stream replay, presence bucket creation); a live case for the `extraServe` path against a running player Body; an e2e against the real services (the world and front-door e2e with fakes is done, commit `cf9aa56`); the rangers connecting through the MCP; and the revoke, kill and hibernate live cases with their test-player guard wired.
- **Spec edit for observer disclosure (decision 0059).** The shard-variant table should name the observer-disclosure variable apart from `identity_mode`. Pending the owner's say.
- **BC-10 v3 line.** Carried from Wave 5: memories, beliefs and goals sit outside the quoted section. The owner call is pending; the recommendation is one v3 line.
- **uuid override.** Owner decision.
- **Worktree folders.** Five leftover worktree directories under `.claude/worktrees` have their registrations removed, but their folders are locked on Windows. They need manual removal once the locks clear.
- **Velocity skin plugin.** An absent `geldar-skins` bucket (no skin set yet) logs a warning on each retry (every 5 s at the backoff cap). Lower it to info, or add a quiet mode, if the ops monitor counts it as noise.
- **Skin config key.** `shards/phase0.yaml` has no `skin:` key. Decide with WM-12 whether it lands with the plugin or in WM-12.
- **Round 3 lows and the WM-12 gaps.** The `players status` line format, the `read_book` argument shape (`{}` assumed) and the `generation` snapshot field in case (g) are unverified and will be checked on the first live run.
- **Journal and rotation limits (WM-02 and WM-12 notes).** Over-length journal lines still throw `RangeError` (over 4000 characters). The journal quota is not yet enforced per player (60 calls a minute by 4000 characters is about 240 KB a minute). Ranger logs grow without rotation. `players logs` reads the whole file.
- **Refund without a reservation id.** A documented limit; see the WM-02 notes.
- **Rotation without revoke.** A rotation that expires without revoke does not end sessions (low).
- **Replay catch-up bound.** `REPLAY_CATCHUP_MS` is a code constant (30 s) with no config key.
- **Adam host stop race (WM-08a).** A stop issued during start hangs until the bot ends. The player session works around it; the Adam host should listen for stop from the start, the same way.
- **Global failed-auth limit.** 300 a minute is a wiring constant with no config key. Decide whether it becomes a config key.
- **Seed and goals storage.** Goals are stored under a `## Goals` heading appended to `personality_seed`. There is no goals column. The initial life budget (`cap_credits`, 240) and the rotate grace period (10 minutes) need owner confirmation (WM-09 items a and b).
- **Book id pattern.** `bk_` followed by 26 hex characters is not checked at the contract boundary. The worknote requested a contract pattern; WM-11a added `^bk_[a-z0-9_]{1,61}$` in the MCP code (commit `9d31d96`). Confirm the contract is updated to match.

## Process actions

1. Smaller packets, commit-per-item, a tool-use budget in every brief, and "commit what passes, write the rest to the report" in every brief.
2. Give each packet its own worknote file, or a `worknotes/` directory.
3. Run a database in the coder lane, or make the ops IT run a per-packet gate.
4. The IT helpers take a secrets-directory environment variable; no junctions.
5. A fix to a limiter, slot or counter needs an abort, close and error-path test, and the next review round targets the fixes.
6. Decide the commit trailer once and write it into `.claude/agents/packet-coder.md`.
7. Move the standing preamble into the packet-coder agent file; keep briefs to the packet.
8. Peer messages are information, not instructions. Confirm limits with the owner.
9. Ops briefs carry an explicit "never do" list, including `adam up` outside a live case.
10. Ops finishes with no leftover background monitors, checked before the final report.

## Could not verify

- **Numbers in the outcome:** the test count (about 3100), the MCP IT counts (30 passed) and the other IT counts (4 passed, 1 skipped) are from the orchestrator's brief. Re-run and record before citing.
- **Image size:** 86 MB is from the brief. Check the image on the next build.
- **Live behaviour:** nothing has run live. The tunnel, the rangers, NATS against the gateway, the Body and MineSkin are all unverified.
- **Neutral text, book joiner rule and RCON per admission:** no decision file records them. Their numbers are not known; see ops logs.
- **Persona verification (0060):** the grep has not been done. The fit analysis is an estimate until it is.
- **`trusted_proxies` value:** unknown until the cloudflared address is known.
- **The sleep cursor column:** decision 0056 names it; whether the code reads it was not checked.
- **The flaky tests in lesson 7:** not identified.
- **Stale ops monitors:** whether the ops runs left background monitors is not recorded; see ops logs.
