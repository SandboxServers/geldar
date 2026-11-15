# BlueMap campaign (geldar-bluemap) RESUME

Decision block 0310-0319 (0310 used: live chat panel). Updated 2026-11-15 14:00Z.

## State
- LIVE on the public map: chat panel (geldar-chat.json written by geldar-core; geldar-chat.js, geldar-sky.js, geldar.css served by bluemap-web). Bubbles removed.
- Click-to-follow (#494). Freshness dot (BM-12, #496): Live/Delayed/Offline, "still Nm", "last line Ns ago".
- Day/night follows the world clock: BM-13 plugin (#500) writes `clock` into geldar-chat.json; BM-14 page (#501) sets sun lighting from it. Paper restarted 12:34Z with the new jar.
- Time-of-day dial: BM-15 (#508), geldar-sky.js + gs- CSS, merged d850ec15, live on node 13:27Z, own mount and Caddy handler.
- Merged PRs: #459, #461, #485, #488, #489, #491, #494, #496, #497, #500, #501, #508.

## Live-verified on the public page (2026-11-15)
- Dusk fade: sun 1 to 0.25 over world time 11800 to 13200. Dawn: 22800 to 24000, back to 1.
- BlueMap's night button is a manual override; "Follow world time" resumes. Nether switch and back: sun and auto mode unaffected.
- Dial at 1280x800, 768x1024, 400x800 (phone), 1920x1080: no overlap with chat panel, control bar or zoom buttons.
- A headless sun jump came only from Edge throttling background timers, not a page bug. Use --disable-background-timer-throttling for long headless samples.

## Not yet verified live
- Following a moving agent; a still label resetting when an agent moves.
- Delayed/Offline dot states (unit-tested only).
- Sun and settings.json after the NEXT Paper/BlueMap restart: settings.json is regenerated; re-check scripts is ["assets/geldar-chat.js","assets/geldar-sky.js"], styles ["assets/geldar.css"].

## Node facts
- compose/* and web files are hand-synced (colo-cd does not refresh them).
- bluemap-web is recreated alone, never the shared Caddy. A replaced single-file bind mount keeps the old inode.
- plugins/bluemap/web/geldar-chat.js is exactly 700 lines (hard cap). The next web feature goes in a new file (geldar-sky.js was the first split); each new file needs a read-only mount, a Caddyfile handler, a hand copy, a bluemap-web recreate and a settings.json scripts re-check.

## In flight
- nothing

## Next (owner order)
- HELD: grave and village markers. Coordinates would become public; needs owner and geldar-93 go.
- Follow-ups: BM-7b empty geldar-speech marker set in markers.json (harmless); split plugins/bluemap/test/chat-panel.test.ts (~637 lines, soft cap 500); read-only skin-provider check (0187); render time unmeasured (tiles 747M, 1 render thread, full update 1440 min).
- Optional, only if the owner asks: bigger or fancier dial; smaller phone chat panel.
- Not ours: docs/spec.md and decision 0199 wording about bubbles.

## For the owner
- Decision 0197 acceptance (bubbles removed by 0310).
- Speech: all lines public and live; agent first names and coordinates stay (24/100 lines have coordinates). Keep or scrub.
- Phone panel size: fine or smaller? Dial size and look: small now; say if you want it bigger or fancier.
- Private screenshots page: https://claude.ai/artifact/DaFgZgrSHRSdm72XvqSw2V (share when you want to see it).

## Open questions
- none blocking
