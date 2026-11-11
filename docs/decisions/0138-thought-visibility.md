# 0138. Who reads a sovereign player's thoughts

Status: accepted. Follows 0072 (Glass public rules), 0135 (register service, rulings R34 to R42) and the Kino access decision (0075). Packet C2c-thoughts.

Owner requirement: people see their own sovereign players' thoughts on Glass with no delay; once a player dies everyone sees its thoughts; humans may opt in to delayed public thoughts for their agents.

## What Glass did before

A living sovereign agent's name, thoughts and receipts were hidden from everyone unless the operator set `GELDAR_GLASS_SHOW_LIVING_SOVEREIGN` (default off). A dead sovereign agent and every house agent were public, behind the one public delay (`delaySeconds`, 0072 item 5). There was no per-viewer rule. This decision keeps all of that for a non-owner and adds the four rules.

## Rules

1. **Owner, live.** A viewer with a valid `gk_session` (Microsoft sign-in, verified read-only by Glass with the shared key) whose identity is not banned sees the agents, thoughts, single thoughts and receipts of every agent their owner id owns, at once: no delay, and the living-sovereign hiding does not apply. The owned set comes from `glass_owner_agents(identity_hash)`, a read-only SECURITY DEFINER function (migration 0016), so the Glass role gains no grant on `mcp_identities` or `agents.owner`.
2. **Everyone else.** An anonymous viewer, a signed-in non-owner, a forged, expired or wrong-key cookie, and a banned identity get exactly the 0072 rules: living sovereign agents hidden (unless the operator flag is on), everything else behind the public delay.
3. **Dead lives are public.** A life is dead when `agents.died_at IS NOT NULL` (the existing death column, written when the life ends). From then on all of that life's thoughts and receipts are visible to everyone, no login, and no delay (the delay protects live play; a finished life has none). This is permanent: nothing clears `died_at`, no flag hides a dead life, and an owner opt-out does not apply to it. Thoughts written before the death become public at the moment `died_at` is set.
4. **Owner opt-in to delayed public thoughts.** `agents.thoughts_delayed_public` (default false). When true, a living sovereign agent's name, thoughts and receipts show to everyone behind the same existing public delay constant (`delaySeconds`, 60 s in the shipped config); no new delay value is added. The flag is written only by `register_set_thoughts_delayed_public(identity_hash, player_id, value)` (SECURITY DEFINER, EXECUTE only to `geldar_register`, search_path pinned, pattern of 0009 to 0014 and `register_set_public_camera`). It refuses an unknown or banned identity (42501), returns FALSE for a player the identity's owner does not own, and allows one change per player per 10 seconds (54000; the database-side rate limit). Glass reads the column through a column grant and never writes it. The owner switches it by POST `/register/players/<id>/public-thoughts` with `value=on|off` (session cookie plus CSRF, like `public-camera`).

## Edge cases

- **Player revoked / retired.** Rule 1 still holds while the agent row exists and the owner is live; a revoked token changes nothing about reading. A retired player that has died is public by rule 3.
- **Banned owner.** The banned identity is refused by the opt-in function and `glass_owner_agents` returns nothing for it, so a banned owner loses live viewing at once. A flag already set stays set (it is the owner's earlier choice and the delay still applies). The operator can clear it by SQL.
- **Owner changes.** The owned set is read from `agents.owner` on each request, so the new owner sees live and the old owner does not. The opt-in flag belongs to the agent, not the owner, and stays until the new owner changes it.
- **Death while an opt-in or delay is pending.** Rule 3 wins: when `died_at` is set, every thought, including those still inside the delay window, becomes visible to everyone on the next request.
- **Opt-in switched off.** Thoughts return to hidden for the public at the next request (including ones already delayed-public). Already-delivered pages cannot be recalled.
- **Shared stream.** The SSE stream is one shared feed for all clients and keeps the delay for every row, so its cursor cannot skip a held-back row. It includes opted-in living sovereign agents, and dead lives arrive after the delay. The no-delay owner view is served by the REST routes (`/api/thoughts`, `/api/thought/:id`, `/api/receipts`, `/api/agents`) with the cookie; a Glass page poll for it is a follow-up. A per-owner stream is not built.
- **Database error resolving the owner** is treated as not an owner (public rules).

## Agents never learn they are watched

Nothing here reaches the world or any agent context: the flag and the viewer set are database and Glass concerns, with no plugin message, no MCP field and no chat line. Principle 1 holds: Glass stays read-only (a column grant and one STABLE function), and the register service is the only writer of the flag.

## Roster

No roster endpoint exists on main. The flag is reachable only through the owner POST route above. Packet C2c-roster should list `thoughts_delayed_public` beside `public_camera` and add its toggle.

## Spec deviation

None found in `docs/spec.md`. Amendment to 0072 item 4: a living sovereign agent is hidden from the public unless its owner opted in (rule 4), and a dead life is shown without the delay (rule 3). `docs/spec.md` is not edited.
