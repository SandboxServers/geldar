# Orchestrator log, night of 2026-11-11

The owner asked for autonomous overnight work toward the Phase 1 goal, with decisions logged for later review and no spec edits (deviations go through decision 0073 amendments). The machine restarted for updates during the night, which stopped the previous session after PR #78 was opened. This log starts from there.

Each ruling below is the orchestrator's, not the owner's. Each one says what to check and how to reverse it.

## State at the start

- `origin/main` at `5c129ed` (PR #77). PR #78 (`fix/colo-core-start`, decision 0134) open, CI green, from the stopped session.
- C1 code: C1-00 to C1-09 merged (PRs #49 to #62), followed by the Colo fix PRs #63 to #78 (FX-* worknotes, C1-11a and C1-11b, decisions 0131 to 0134). C1-05b is deferred (0130). C1-10 (node deploy, first ranger, no degradation) is the owner's step on the node.
- C1-01 is partial: three flaky tests still need clock seams (`golem/src/test-control.test.ts`, `golem/test/live/adam-stack.test.ts`, `tools/repo-checks/src/cli.test.ts`), and `lantern-local/src/thinker.ts` (592) and `threshold/mcp-mock/src/server.ts` (565) are over the soft cap.
- `RESUME.md` and `ledger.md` were stale (they still said C1-00 was next). This branch updates them.
- Two empty untracked files, `present.ts` and `wait.ts`, sit in the main checkout's root (dated 2026-11-09). They are not touched; the owner can delete them.

## Rulings

| # | Ruling | Why | To reverse |
|---|---|---|---|
| R1 | Merged PR #78 with no separate review. | CI was green and mergeable. The owner's rule is one review per wave, at the wave end, not per PR. It joins the C1 wave review. | Revert merge `51dc45a`. |
| R2 | Start wave C2 (Doors) now. C1's exit check (first ranger on the node) is the owner's step and does not block desktop work. | plan.md orders C2 after C1. Only the C1 node step is outstanding, and C2's desktop packets don't depend on it. | Stop C2 PRs from merging. |
| R3 | C2 packets merge to `main` one PR per packet, as C1 did (PRs #49 to #62), not through a wave integration branch. | This matches the C1 practice, and the C2 packets touch separate files once C2-00 has merged. | Not applicable. |
| R4 | C2-00 error shapes: 401 for every unauthenticated case with one body; 429 with integer `retryAfter` seconds; 503 for the kill switch. Record 0090 is "Proposed (orchestrator)". | These are the card's own defaults, made concrete so the fan-out packets agree. | Owner edits 0090. |
| R5 | The owner-gated defaults stay as the cards set them. C2-01 invitee issuing ships behind a flag that defaults off, since 0077 is still Proposed. C2-03 ships with the Glass delay at 0, the sovereign filter on, and no agent-board text. C2-04 ships with no Caddy rate-limit module (no new supply-chain dependency), and the gap is recorded in 0094. | These are the safest defaults. Each one waits for an owner question in c2-packets.md section 5.4. | Owner answers 5.4 items 3, 5, 6, 7, 8 and 9. |
| R6 | Owner question 5.4 item 10 (Caddy sites for `glass` and `mcp`) goes to C2-04, which grows from S to M. It writes the `map`, `glass` and `mcp` snippets under `deploy/caddy/`, each with its own kill-switch file. | C2-04 already owns `deploy/caddy/`. Without the two extra sites the public MCP and Glass have no way in. These are template snippets only, with the domain as a placeholder; nothing is reloaded. | Drop the two snippets. |
| R7 | C2-01 splits `threshold/mcp/src/config.ts` (558 lines) in its own first commit before it adds the `public` block. | packet-conventions section 1: a packet that needs a file over 500 lines splits it first. | Not applicable. |
| R8 | C2-02, C2-04, C2-05 and C2-06 start before C2-00 merges. C2-01 and C2-03 wait for it. | The first four read nothing from `contract/`. The header name they share (`x-geldar-client-ip`) is fixed in R4. C2-01 and C2-03 read the C2-00 config keys and error shapes. This keeps at most six agents running at once. | Not applicable. |
| R9 | C2-06 may update `pnpm-lock.yaml` for its new `tools/portscan` importer only, with no new external dependency. | `pnpm-workspace.yaml` already globs `tools/*`, and CI installs with a frozen lockfile, so the importer has to be in the lockfile. The card's "C2-07 adds it" would leave C2-06's PR red. | Not applicable. |
| R10 | C2-01 builds against 0090 while it is still Proposed. 0090 itself says the owner confirms before C2-01 relies on the header rule. | The default is safe: `public.trustedProxies` starts empty, so the header is ignored. Nothing goes public before C2-07, which needs the owner anyway. | Owner changes 0090; C2-01 follows. |
| R11 | Process: a coder that adds a decision record ends with `check:repo` red, because the index row is the ops step's (conventions 7). From now on the ops step adds the row and runs `check` before the PR. Retro item for C2: let the coder add its own row, since one PR per packet makes index conflicts rare. | Seen on C2-00. | Not applicable. |

## Follow-ups queued

- Dependabot alert 1 (medium): `uuid` below 11.1.1, a missing buffer bounds check in v3/v5/v6 when the caller passes a buffer. It comes in transitively through `@azure/msal-node` (uuid 8.3.2) and `yggdrasil` (uuid 10.0.0), the Minecraft auth libraries under mineflayer. Neither passes a buffer, so the risk is low. The fix is a `pnpm-workspace.yaml` override to 11.1.1, if that release is past the two-week floor, plus a full `check`. It is queued as a small packet once a slot is free.

## Owner answers received during the night

- **0077 Accepted (owner, 2026-11-11):** option A. Anonymous visitors get the thought stream and the map, and cameras need an owner or admin login. The interim login is two static hashed role tokens until Entra SSO in Phase 2. Invitee MCP tokens stay as in 0054. Effects: C2-01's invitee-issuing flag can default on once the C2-01 PR lands (a small follow-up, since C2-01 was briefed before the answer); C2-07 and the C2b login packets are no longer blocked by 0077. 0075 point 5 (anonymous or login cameras) is answered by this choice, but 0075's own status is left for the owner, because its other points were "for review".

## More rulings

| # | Ruling | Why | To reverse |
|---|---|---|---|
| R12 | C2-05 is accepted as tests and a record only. The image slimming in the card can't be done, because the MCP runtime imports `@geldar/animus/src/*`, `@geldar/mcp-mock` and `@geldar/repo-checks/src/identity-mode.ts`. Follow-up: move those shared modules into `contract` or a small shared package, then slim the image. | Removing them would break the runtime. The move is a refactor outside C2. | Not applicable. |
| R13 | C2-02 ghost spectator: Velocity can only admit a ghost and block its commands; forcing spectator game mode needs Paper (`plugin/core`), and the Golem registry writer must write `live`. Queued as follow-up packet C2-02b. | Velocity has no game-mode API. | Not applicable. |
| R14 | Shard YAML key names for 0090 are snake_case, in a top-level `public:` block (`trusted_proxies`, `client_ip_header`, `rate_limit.per_minute` and `rate_limit.burst`, `kill_switch`), mapped one to one to 0090's names. Precedence: env, then `public.*`, then the existing `sovereign.mcp` keys as a fallback. | The shard file is snake_case everywhere. Keeping the old keys as a fallback keeps current shard files working. | Rename in 0091. |
| R15 | Public surfaces are rate-limited by default: 60 per minute, burst 20, with a bounded per-client table. This departs from 0090 ("no default"), and 0091 and 0093 record it. | A public endpoint left unlimited because a value was never set is the worse failure. | Owner sets values; owner can lift the defaults. |
| R16 | C2-01 and C2-03 each ran out of context with half their items left. Following the campaign rule (re-slice, don't chain finishers), C2-01 is split into C2-01b (config, kill switch, rate limit) and then C2-01c (negative cache, invitee issuing, 0091). C2-03 is split into C2-03b (size cap, delay, sovereign filter, kill switch, 0093) and C2-03c, which adds test files only and runs in parallel. The Glass sovereign filter also hides receipts, not just thoughts. | Each split is under about 40k tokens. Receipts of a living sovereign agent show what it is doing, just as its thoughts do. | Not applicable. |
