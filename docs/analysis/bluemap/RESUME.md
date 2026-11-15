# BlueMap campaign (geldar-bluemap) RESUME

Decision block 0310-0319 (0310 used: live chat panel). Updated 2026-11-15 09:55Z.

## State
- LIVE on the public map: chat panel (geldar-chat.json ring written by geldar-core, geldar-chat.js + geldar.css served by bluemap-web; main 186772f5). Bubbles removed. Verified headless on the live URL at 4 sizes (live3-*): no overlap with BlueMap controls, newest line visible, no `ag_`/UUID/markup in the feed.
- Merged PRs: #459 BM-1 plugin, #461 panel+fixes, #485 runbook, #488 self-styling, #489 layout, #491 resume, #494 click-to-follow (hand-copied to node 09:46Z, verified live: follow, stop, drag-cancel, unknown agent, nether-to-overworld switch). Moving agent not yet tested live: check when one walks. Runbook: docs/runbooks/map-chat-panel.md.
- Node facts: compose/* and web files on the node are hand-synced (colo-cd does not refresh them); settings.json is regenerated at each Paper restart (script entry must be re-checked; the script injects its own stylesheet).
- Accepted by owner ruling: all speech public and live; agent first names and place coordinates in speech text stay (24/100 lines have coordinates). Owner FYI list holds the optional scrub.

## In flight
- nothing

## Next (owner order)
1. (done) click-to-follow  2. grave and village markers (ASK geldar-93 first: coordinates become public)  3. freshness indicator (design paragraph to geldar-93 first)  4. day/night following the world clock (BlueMap web already has a manual day/night toggle).
- Follow-ups: BM-7b empty geldar-speech marker set remains in markers.json (harmless; removal runs before maps load); split plugins/bluemap/test/chat-panel.test.ts (~610 lines, soft cap 500); mobile panel max-height smaller if phones complain; verify skin provider (0187) by head file mtime after a join (read-only); render time unmeasured (no render logs).
- Perf: tiles 747M on /mnt/nvme (1.3T free), 1 render thread, full update 1440 min.

## For the owner
- Decision 0197 acceptance (bubbles removed by 0310).
- Coordinates in speech text: keep (default) or scrub.
- Panel covers ~1/3 of a phone screen: fine or smaller?

- Private screenshots page for the owner: https://claude.ai/artifact/DaFgZgrSHRSdm72XvqSw2V

## Open questions
- none blocking
