# The goldar repo review: what to port into Geldar (sanitised)

Reviewed: BangRocket/goldar, one commit 81473eb (2026-11-11), 20 Java files (~4,100 lines), tools.json, glass.html, 2 tests, build/CI files. Compared against a Geldar main snapshot of the same day. Read-only: nothing from goldar was built or run. The clone was a local scratch copy and is not kept.

## Licence and relationship
- MIT-licensed. Our repo is MIT too: compatible. Port IDEAS, not code (Java/NeoForge vs TypeScript/Mineflayer anyway). If a PR transcribes closely (sign wrapping in Tasks.WriteSign.lines, LevelTerrain.digCost formula, Pathfinder cost constants) add the MIT notice (file header or THIRD_PARTY_NOTICES) and credit the goldar repo (BangRocket/goldar, MIT-licensed) in the PR and decision record.
- Goldar is a re-implementation of OUR contract: its tools.json matches our generated mcp-tools (14 tools) up to just before `unstick`; reflex names, priorities, cooldowns and wording are ours (fall_stop 100/20, hazard_escape 90/40, retreat 80/200, fight_or_flee 60/60, eat 30/100, panic_burrow 30/200, blocked_path 20/100).

## How it is built
NeoForge 26.1 mod, Java 25, one JVM. Body = `extends ServerPlayer` with a fake Connection (reflection on Connection.channel); joins via PlayerList.placeNewPlayer; steers via zza/jumping each tick; no network round trip. MCP over plain HTTP (JDK HttpServer), POST only. Pathfinder: A* (40k nodes), 8-dir moves, step-up 1, drop up to 3, swim, ladder, DIG moves; LevelTerrain.digCost = 2 + 4*(hardness*1.5/tool speed), infinite for unbreakable/fluids/hazards/block entities/crafting tables/block under falling block/next to fluid/lava nearby. Leaves cost ~3.2 so a body on a canopy digs down. Walk: stall under 0.03 blocks/50 ticks (2.5 s) drops the path and replans up to 6 times, follows PARTIAL paths. Crafting/furnace/chests are worked by synchronous menu clicks in-process (check every cell covered first, try all unlocked variants, quick-move result, return leftovers, smelting with fuel math). Place tries all 6 faces with useItemOn. Events: one `action`/`action_failed` event per action with readable wording and Plan.why() for intent failures. Tests: PathfinderTest (11), SignTextTest (4) only.

## Features goldar has that we lack (effort S<=2d, M<=1wk, L more)
1. Soft-dig path planning, escapes canopies (S-M). Port the safety rules and cost formula limited to natural soft blocks. Needs a decision (we set canDig=false deliberately).
2. Fast stall-then-replan with partial paths (S). Ours stalls 600 ticks then `blocked` (0063).
3. Per-action outcome events + readable `why()` wording (S-M, contract change under 0033).
4. Smelting (M). We have no furnace support at all.
5. Crafting hardening: ingredient pre-check, all variants, return leftovers, sharper reasons (S logic / M explicit-click grid).
6. give and note (S each). Goldar has a bug: names resolve anywhere in the world; port with our line-of-sight rule.
7. write_book (M). Goldar consumes ingredients directly, no skill/edition stamping (owner decision).
8. propose/vote/laws (M). Goldar's vote works away from the Moot Stone and mechanical laws rewrite credits/reflexes (against our spec): port social laws only.
9. offer/Shrine (L): needs the plugin to consume items (Mineflayer cannot destroy items).
10. build and write_sign (M + S).
11. follow intent (S, same name-lookup bug).
12. Mining lava-adjacent skip (S).
13. Death event + died_at (S): we never write died_at and a death reaches the player as "You took damage." Do not port revive (Principle 1).
14. Goldar Glass shows live agent positions and living players' reasoning after 60 s: DO NOT port (against 0093, 0138).

## Goldar security notes
Plain HTTP on 0.0.0.0 by default; tokens unsalted SHA-256; add/token print the token into the server log; no failed-auth throttle and the open-request count is keyed by player id before auth (anyone knowing an id can push the real mind into 429s); unbounded thread pool; every tool waits up to 15 s on the server thread and A* runs on the main thread; sign text and heard speech are not cleaned; global name resolution; no line-of-sight in perception; session ids ignored; version-fragile reflection hack.

## Where its body is better: architecture or logic?
- Crafting menus, placement: mostly ARCHITECTURE (no desync, no reach/facing refusals).
- goto blocked/stalls, canopy trap, wording: LOGIC we can port.
- Reflexes, rate limits/credits: ours are equal or stronger.

## What we have that goldar lacks
The Record (Postgres, receipts, JetStream), knowledge-boundary perception with line of sight, cleaned text, hardened MCP (HMAC+pepper, expiry, revocation, wrong_player, Origin/Host, owner pools, kill switch, TLS), Glass visibility rules and Kino, the Velocity identity gate/spectators/skins, the headless local-model Mind (animus), unstick/panic_burrow backoff/preconditions/0037 chest clicks, contract codegen with drift checks, mock MCP, bench, CI pinned by SHA, process isolation (a body crash does not take the server down).

## Ranked porting candidates and order
1. Soft-dig path planning (S-M, medium risk: start with leaves/snow/plants). High benefit: canopy trap, "way was blocked".
2. Fast stall-then-replan (S). High benefit.
3. Per-action outcome events + why() (S-M). High benefit.
4. Smelting (M). 5. Crafting hardening (S/M). 6. give/note (S). 7. write_sign + build (S+M). 8. write_book (M). 9. propose/vote social laws only (M). 10. Death event + died_at (S).
After: offer (L), follow, mining lava-skip.
Order: (2+1 together, re-run bench) -> (3+10) -> (6+7) -> (4+5) -> (8+9) -> offer.
Not solved by goldar: session superseded (it ignores session ids; an owner decision could make our supersession gentler); entity paging (goldar has none).

## Owner decisions needed
1 Path planning that digs (reverses canDig=false). 2 The 0063 stall numbers. 3 New event types (0033/0069). 4 write_book without stamping (spec 5.5/5.8/0073). 5 Governance: Moot Stone location, quorum base, votes only at the Moot; mechanical laws to ideas.md. 6 Plugin consuming items for offer (0062/0070). 7 Death lifecycle (spec 5.9), no revive. 8 Gentler session supersession. 9 Any server-side helper or in-process body.

## In-process body: not now
Would take a Paper plugin (not NeoForge) with a version-fragile ServerPlayer subclass via paperweight, the Body API re-implemented in Java behind the same NATS contract, re-implemented perception/reflexes/limits, a replacement for the Velocity gate/life registry/skins, a main-thread tick budget and bench parity runs: L+, doubling maintenance. Gains: reliable menus/placement, less memory, bodies that obey /tick rate (reopens time dilation, ruled out in 0047). Losses: process isolation (0050/0078/0083), comparability across bodies (Principle 7: research shards with local models), the Velocity path, what we built on Mineflayer (0032, 0037, 0038, 0039, the bench), a single language. Recommendation: port the logic first; if crafting/furnaces/offer stay flaky add narrow server-side helpers in Geldar-Core (NATS requests validated against the player's real position and inventory, Mineflayer stays the body; needs a decision record); an in-process body only ever as a research-shard experiment behind the same API, never mixed with Mineflayer bodies in one comparison.

## Limits
Not built/run/tested; shallow clone (history/stability unknown); our line numbers approximate; unverified: mineflayer-pathfinder 2.4.5 break-filter options, Mineflayer 4.39.0 writeBook/signBook/updateSign, whether `open` contents reach MCP players, whether our sign text is cleaned on the Body side; licence reading is not legal advice; effort estimates rough.
