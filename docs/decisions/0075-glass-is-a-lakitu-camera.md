# 0075. The Glass gets Lakitu cameras: free-fly, collision-bound, invisible in the world, targeted by login

- Status: Accepted (owner, 2026-11-11; see the amendment at the end)
- Date: 2026-11-10
- Spec: section 2 (Principle 1: no humans inside, so viewers cannot act), section 7 (the Thought Stream, the Glass, and the spectator and ghost surfaces), 8.4 (Observatory edge, Entra ID SSO), 13 (open questions). Decisions 0052, 0059, 0068, 0070, 0072, 0073.

## Requirement (the owner's intent)

The Glass should work like Lakitu in Mario 64: a player-controllable camera focused on an agent, still bound by world collision.

- It can swap between agents owned by the same player. An admin can swap across all players.
- Several camera views can be up at once.
- The cameras must not be visible in game. In the owner's words: "this is not reality TV, even though it kind of is."

This is part of Phase 1 (decision 0070, wave C2b in the [plan](../analysis/phase1/plan.md)).

Terms in this record:

- **Lakitu camera** (or camera): a viewer-side pane on the Glass that follows an agent. It is not an agent and not a player.
- **Player owner** (or owner): the login that holds sovereign players (decision 0052). Not the project owner.
- **Admin**: a login with the Watcher role (spec 1275), which can target any agent.

## Decision

1. **Cameras are invisible in the world by construction.** A camera never joins the Minecraft server. Nothing it does can appear in the world. This is a property of the design, not a rule the code has to remember. Specifically, a camera has:
   - no entity;
   - no tab-list or player-list entry;
   - no join or leave message;
   - no scoreboard, team, bossbar or particle effect;
   - no change to what the agents perceive. The agent-visible text rules (decision 0068, spec 7) and decision 0059 hold: agents must not learn they are watched;
   - no effect on mob spawning or game rules. The feed reads chunks that are already loaded and never forces a chunk load, ticket or generation.

   The spec's ghost path (spec 8.4 and 1280: Velocity, forced spectator mode, tab-list hiding) is **not** used. A camera never connects over the Minecraft protocol, so it has no session in Paper to hide.

2. **Principle 1 holds (spec section 2): a camera can never act.** The camera data path is read-only, one way, from the shard to the viewer.
   - The feed has no input path into the shard. No command, chat line, input packet, or write.
   - It reads through a read-only source (decision 0072: the `geldar_glass` role has SELECT only, and the feed uses no role that can write).
   - The camera has no link or form that acts.

3. **Collision: a free-fly follow camera that cannot pass through solid blocks.** The camera is a free-fly camera around a focus point on an agent.
   - Collision runs client-side, against the same voxel data the renderer draws, so the camera stops at the walls it shows.
   - Collision is a viewing constraint only. It never changes the world.
   - Modes: **follow** (the camera keeps a fixed offset from the agent), **orbit** (the camera circles the agent at a set radius, still collision-bound), **free** (the camera flies, still collision-bound).

4. **Targeting.**
   - A **player owner** (login) can pick among the agents of the players they own. The per-owner cap is 20 sovereign players (decision 0052), so the owner's targets are the agents of those players.
   - An **admin** (Watcher role) can pick any agent across all players.
   - A pane's target is checked on every request. A camera cannot target an agent the login may not see, and a login cannot widen its own scope by changing a URL.

5. **Multi-view with a cap.** A Glass page holds several independent camera panes. Each pane has its own target and mode (follow, orbit or free). A **per-session cap** limits the panes for server load. Proposed: **4** per session. The cap is enforced by the feed, not only by the page.

6. **Audit.** Who watched which agent, and when, is logged: login identity, agent identity, pane, mode, start and stop times. No secrets and no tokens are logged. The retention period is the owner's to set.

7. **The feed is one plugin in Geldar-Core, with a schema in `contract/`.** It sends chunk sections around each targeted agent, block updates, and agent and entity positions. The data-feed schema is versioned in `contract/` and generated, never hand-written.

## Options considered

1. **A web renderer inside the Glass, fed by a read-only, invisible-by-construction data feed from a plugin in Geldar-Core (chosen).** The renderer uses WebGL (three.js) in the browser. The browser does collision against the same voxel data.
   - Invisible by construction: no client joins the server.
   - Multi-view is trivial: each pane is a canvas on one feed.
   - No Minecraft client is needed.
   - Costs: a renderer to build; a chunk and block-update feed, whose volume must be measured on a shared node; texture assets (see follow-ups).

2. **Real Minecraft spectator clients behind a Velocity spectator proxy (spec Phase 2).** Each pane is a client.
   - The server sees each one as a connected player. Every plugin and hook would have to hide it.
   - One hidden-player leak breaks the invariant in point 1.
   - Heavy: a client per pane, and a Velocity path in the DMZ.
   - Rejected for Phase 1.

3. **Extend BlueMap.** BlueMap is a map viewer, not an agent camera, and it stays the public map (decision 0072). Extending it does not give per-agent, collision-bound, multi-pane cameras.
   - Rejected as the camera. BlueMap stays the map.

## Open fork for the owner (point 5 of the decision, recorded, not resolved)

Decision 0072 makes the Glass public: no login. This record needs a different answer on one point. The owner must choose:

- **Recommended:** anonymous visitors get the **read-only thought stream and the map** only. **Lakitu cameras require an owner or admin login.** Reasons: per-agent targeting and owner scoping need an identity, and a public free camera on any agent shows where agents live. That is a leak of location, which the agents and the owner's players must not have.
- **Alternative:** anonymous visitors also get cameras, limited to a fixed or public set of agents. Rejected here because it exposes where agents live.

This is a **tension with decision 0072**, which says the Glass is public and needs no login. It is not resolved silently. This record stays **Proposed** until the owner confirms the recommended reading (or chooses otherwise) and updates the status. If the owner keeps the Glass fully public with cameras, decision 0072 needs its own amendment first.

## Follow-ups needed before build

- **Auth.** The spec's Observatory SSO (8.4) is Phase 2. The interim needs a decision: static admin and owner tokens, or a small login. Until decided, cameras stay off.
- **Texture assets and licence.** Use only free, vanilla-compatible assets we are allowed to ship, with the licence recorded. Do not copy Mojang assets into the repo.
- **Data-feed schema.** Written in `contract/`, generated, and tested. The feed's load on a shared node is measured before the feed ships.
- **Name.** "Lakitu" is a Nintendo character name. It is the working name in this record. A public name is a separate owner decision, as for the rangers (plan, owner item 6).

## Why

- The owner has ruled the requirement (above).
- A read-only, one-way feed keeps Principle 1 (spec 2) true by construction, the same way decision 0072 keeps the Glass read-only.
- Invisibility by construction is stronger than a set of hide rules, because one missed hook would show a camera to players and to agents.

## Consequences

- Wave C2b in the plan is the home for the build (invisible feed, renderer, targeting, multi-pane, audit).
- The leak test (no trace in the tab list, entity list, or agent snapshots while a camera is up) is automated and revert-checked. That is the exit check for the invisibility invariant.
- The per-session cap and the collision test are part of the exit check.
- The Glass privacy review (decision 0072, point 4) covers camera audit output and the feed as well as thought text.

## Amendment, 2026-11-11: owner rulings (the name is Kino)

The owner ruled on the open fork and the follow-ups. This amendment overrides the body above where they differ. The body is left as written.

1. **Name.** The camera viewer is called **Kino**, after the Stargate Universe remotes. "Lakitu" in the body, in `contract/schemas/lakitu-*.schema.json` and in earlier packet cards is the old working name. New work uses Kino.
2. **Who can open a camera.**
   - Logged-in users (Microsoft personal accounts) can open cameras.
   - Owners target their own players' agents.
   - Admins target any agent. Admin status is a flag in Postgres, managed by an admin CLI, not a token.
   - Anonymous visitors may watch only agents flagged for public viewing. The owner of the agent, or an admin, sets the flag. This replaces the "recommended" reading in the open fork: anonymous cameras exist, but only for flagged agents.
   - Decision 0072 (the Glass is public and read-only) still holds. Kino keeps its read-only, one-way feed (point 2 of the decision).
3. **Textures.** Vanilla textures, sourced as BlueMap sources them (from the Mojang client jar, already served as the map's `textures.json`), cached in the browser, and never in the repo. This closes the texture follow-up.
4. **Limits.** 4 panes per session to start, as a setting. The audit log is retained 90 days. There is no load cap at first: measure first, then decide. There is a Kino kill switch and a SigNoz metric.
5. **Data feed.** The Kino feed contract is `contract/schemas/kino-feed.schema.json` (server to browser) and `kino-client.schema.json` (browser to server: only `subscribe` and `unsubscribe`, no world input). Packet cards: `docs/analysis/phase1/packets/c2b-kino-packets.md`.
6. **Still open.** The auth interim follow-up is answered by Microsoft sign-in (card K03). The public name beyond Kino is not an open item.