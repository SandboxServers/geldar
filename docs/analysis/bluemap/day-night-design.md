# Day/night on the public map: design note (no code yet)

Date 2026-11-15. Author: geldar-bluemap. Status: for geldar-93 to approve or drop.

## Goal
The public map's lighting follows the world's own time of day, so a viewer sees night on the map when it is night in the shard.

## What the page can do (measured on the live page, BlueMap 5.29)
- `window.bluemap.mapViewer.data.uniforms.sunlightStrength.value` is a number the page script can set. Default 1 (day). The built-in day/night button sets it to 0.25 (observed), and a script write of 0.5 was accepted.
- `ambientLight` is 0.1 and stays. Skylight scales with the uniform; block light (torches, caves) does not, so caves look the same by day and night, as in the game.
- Only the sun uniform changes. The sky colour and the baked tiles do not, so this dims the terrain; it does not draw stars or a dark sky. A `skyColor` uniform exists and can be dimmed the same way if we want a darker background.
- The uniform is an internal of the web app, not documented API. It is pinned by the BlueMap version (5.29). A BlueMap upgrade must re-check it; the script guards every access and does nothing if the field is missing.
- Nether and End have no day cycle: apply only when the shown map id is `overworld`, reset to 1 on a map switch.

## Where the world time comes from
Nothing public carries it today (players.json has positions only). Options:
1. **Recommended: add a `clock` object to geldar-chat.json**, written by the existing ChatFeedWriter: `{"v":1,"clock":{"time":<world.getTime() 0..23999>,"at":<epoch ms>},"lines":[...]}`. The v stays 1 (old scripts ignore unknown keys). The writer must also refresh the file about every 10 s when no chat arrives, so the clock stays live (a tiny file, atomic write as now).
2. A separate geldar-time.json: needs a new Caddy handler and mount on the node (hand-synced compose), more node work for no benefit.
3. No plugin change: impossible; the viewer's wall clock is not the world clock, and day length can change by agent vote (spec: "day length" is a rule agents can change), so the page must not assume 24000 ticks per day.

What it reveals: the time of day. Agents already see the sky, so this tells nobody anything new; it says nothing about agents, watching or the page. Principle 1 untouched (read-only, web only).

## Page behaviour
- Each poll (3 s) stores `time` and the local receive time. Between polls the script advances time at 20 ticks/s of real time and snaps to the new value at the next poll, so a lagging or slowed server is followed within 3 s (the world clock has 20-tick resolution, decision 0038).
- Sun curve (Minecraft: 0 = 06:00 sunrise): full sun from tick 0 to 11800, linear fade to night level 0.25 at 13200, hold, linear rise back to 1 from 22800 to 24000. Night level matches BlueMap's own night button.
- A viewer who presses BlueMap's day/night button takes manual control; auto-follow stops for that page view and the panel shows a small "Follow world time" control to resume. No state is stored.
- If the clock is missing or older than 60 s, do nothing (the viewer keeps whatever lighting they had).

## Cost
- Plugin: ChatFeedWriter gets a clock supplier and a 10 s refresh (about 40 lines) plus tests (a clock field written, refresh without chat, no clock when world missing). One PR.
- Web: about 60 lines in geldar-chat.js and a few CSS lines, plus tests; the file is 556 lines now (hard cap 700), so the day/night code should go in a second web file only if we also add a mount, which we want to avoid; keep it compact or trim other code.
- Node: the geldar-core jar change needs a Paper restart, which needs the owner's approval through geldar-93, then the usual two-file hand copy for the web side. Jar first (older web script ignores the new key), web second. This restart is the main cost.

## Risks
- BlueMap upgrade changes the uniform name: guarded, degrades to normal lighting.
- Tiles are baked with full skylight; at night the terrain just dims. Some viewers may expect a dark sky: optional skyColor dimming, cheap, same uniform path.
- Writer refresh adds a file write every 10 s on the shard disk: negligible.
- A day-length vote changes the cycle; the page follows the world's own number, so nothing to change.

## Decision for geldar-93
Approve option 1 (plugin clock in geldar-chat.json plus page script), including a Paper restart window, or drop day/night. Nothing here is built.
