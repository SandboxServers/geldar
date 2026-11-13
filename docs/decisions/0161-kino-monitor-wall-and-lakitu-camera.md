# 0161. Kino redesign: a monitor wall of Lakitu chase cameras

- Status: Accepted (implementer, 2026-11-13; owner review in the PR)
- Date: 2026-11-13
- Spec: section 2 (Principle 1), section 7 (the Glass). Decisions 0075 (Kino), 0100 and 0101 (the feed), 0139 (agents-only entity feed).

## Requirement

Owner feedback on the Kino page, 2026-11-13: "It's supposed to be a Mario 64 like camera tool to watch agents in game. I also envisioned it like the multi view screen from Back to the Future Part II, where you can watch multiple cameras at once. It probably needs a full face-lift and redesign."

The owner asked for this to be planned and built autonomously, with the assumptions written down. This record is that list. Each assumption is the implementer's call. The owner can overturn any of them in review.

## Decision

### 1. The camera: follow becomes a Lakitu chase camera

Before, `follow` kept a fixed offset along the world axes (always north of the agent, whichever way it faced) and picked between five candidate offsets to see past leaves. It never turned with the agent and had no player controls beyond a drag.

Now `follow` behaves like the Lakitu camera in Super Mario 64:

- **Behind the agent.** The camera sits behind the agent's heading, which comes from the agent's own `yaw` in `entity_positions`. When the agent has no entity yet, the heading comes from its movement.
- **Lazy swing.** The camera swings round behind the agent only while the agent is moving, and with lag. An agent turning on the spot or looking around does not whip the camera.
- **Rotate in 45-degree steps** (`Q`/`E`, the arrow keys, or the on-screen buttons), with eased motion, like the C buttons. A drag still turns the camera freely.
- **Three zoom distances** (close, medium, far), stepped with the wheel, `+`/`-`, or the on-screen buttons, like C-up and C-down.
- **Recentre** (`R`, or a double-click) swings the camera back behind the agent.
- **Pushes in at walls.** A ray runs from the agent's eyes out to the wanted position and stops at the first block that stops the camera (A9). Blocks the ray overlaps before it first gets clear of the agent's own eyes are ignored, so an agent pressed into a wall or a trunk does not swallow the camera. The camera snaps in fast and eases back out slowly, so it does not pump. The existing foliage pull-in still moves the chase camera closer when leaves hide the agent. When the way behind is blocked (an agent pressed against a bank or a wall), the camera first tries higher positions, rising straight up from the eyes as far as that is clear and then going out, and eases up to the lowest one that is clear, as Super Mario 64's camera rises over a wall. It comes back down slowly once the wall is gone. Where no height is clear (a one-block tunnel), it stays pushed in.
- **Swoop-in.** When a camera tunes to an agent, it starts high and far and swoops down to the chase position (the Lakitu intro). It is skipped under `prefers-reduced-motion`.

`orbit` keeps its collision-bound circle and gains smoothing and a slow turntable drift after a few idle seconds (off under reduced motion). `free` gains acceleration and easing so it no longer starts and stops dead.

**Assumption A1: the wire modes stay `follow`, `orbit` and `free`.** The Lakitu behaviour lives entirely in the browser. `kino-client.schema.json`, the relay, the audit and the plugin are unchanged. The audit still records the mode by the same name.

**Assumption A2: zoom and rotation are view-only.** They send nothing. Only a mode change or a retune sends `subscribe`, exactly as before. Principle 1 holds by construction: the camera modules still use no network API (test: "the camera sends nothing").

**Assumption A9: every camera mode passes see-through blocks and plants.** Before, any block other than air stopped the camera, including leaves, glass, water, grass and flowers. Under a tree, the orbit camera collapsed onto the agent's head (seen in the preview). The renderer already fades see-through blocks near the camera and on its line to the agent (decision record K13, `fade.ts`). Now a block stops the camera only when it is a full cube or has a box shape (slab, stairs, fence, door) and is not see-through. Unloaded space still stops it, so the camera never leaves the drawn world. Collision remains a viewing constraint only (decision 0075, point 3).

**Assumption A3: no first-person (agent's-eye) view.** That is a different feature (decision 0156 covers the Body's own viewport). It is listed in `docs/ideas.md`.

### 2. The page: a monitor wall

Before: one toolbar with a select box and an "Open pane" button, and panes in an auto-fit grid with plain buttons over the canvas. The keyboard drove every pane at once: pressing `W` in free mode moved all open free cameras.

Now:

- **Monitors.** Each pane is a monitor with a bezel, a channel number (`CH 1` to `CH 4`), the agent's display label, the camera mode and a live light. Its controls (mode, rotate, zoom, recentre, retune, solo and close) appear on hover or focus, and always on touch screens.
- **One active monitor.** Clicking or tapping a monitor, or pressing `1` to `4`, makes it active. The keyboard drives the active monitor only.
- **Layouts.** *Wall* (equal tiles), *Feature* (the active monitor large, the others as a strip beside it, or below it on a phone) and *Solo* (the active monitor alone). Hidden monitors stop rendering but keep their feed.
- **Empty slots show "no signal".** Up to the cap, a free slot is shown as static with a "Tune in" button, so the wall reads as a wall of screens.
- **Channel guide.** A drawer lists the agents the server lets this viewer watch, by label, with a face drawn from the agent's skin when one is served. Choosing one tunes the active monitor; "Watch on a new monitor" fills a free slot.
- **Channel surfing.** `[` and `]` (or the monitor's arrows) step the active monitor to the previous or next agent. The retune waits 400 ms after the last step, so surfing does not run into the server's subscribe rate limit (8 at once, then one per 2 s).
- **Help.** `?` opens a keyboard and touch reference.
- **Tuning in.** A monitor shows static and "Tuning in" until the feed has placed the agent, instead of an empty sky.
- **Phones.** One column. The active monitor's controls dock at the foot of the screen in two rows, so they never cover the agent. Touch targets are 44 px high.
- **Remembered.** The wall (layout, and each monitor's agent and mode) is kept in `localStorage` and restored on the next visit, filtered by the agents the server lists now. Storage failures are ignored.

**Assumption A4: the cap stays at 4 monitors.** It is an owner ruling (decision 0075 amendment, point 4) and the relay enforces it. Back to the Future's wall shows more, but raising the cap is the owner's call. The page reads the cap from one constant.

**Assumption A5: no thought ticker under each monitor.** Showing an agent's latest thought beside its camera would suit the TV look, but it puts location and thought together on one page and is new scope. It is listed in `docs/ideas.md`.

**Assumption A6: the look is a dark control room, from system fonts and CSS only.** There are no images or web fonts (the Kino CSP allows `img-src 'self' data: blob:` and no font source). The static on empty monitors is a CSS gradient. The faint scanlines on monitors are CSS, and both animations stop under `prefers-reduced-motion`. Colours come from tokens on `:root`. Nothing about a monitor's colour is derived from agent data.

**Assumption A7: the styles move to `kino.css`.** Glass's Kino web loader now serves `.css` files from `glass/web/kino/` as well as `.ts` and `.html`. The Kino CSP already allows `style-src 'self'`.

**Assumption A8: the per-pane status line is kept, folded.** The "connected | chunks | entities | atlas" line is how people find a broken pane without devtools (and `tools/kino-shot` reads it). It moves behind an info toggle on each monitor and in the top bar. The text and element ids stay the same. `tools/kino-shot` now drives the channel guide instead of the old select box; its checks and outputs are unchanged.

**Assumption A10: a first visit tunes CH 1 to the first agent the server lists**, so the page shows a picture at once instead of an empty wall. Opening that camera is an ordinary audited subscribe, as clicking "Open pane" was.

### 3. Feed details the camera depends on (found in review)

- **The camera follows the agent's entity, not `target_moved`.** The plugin sends `target_moved` only when the agent enters another chunk; the agent's entity (position and yaw) comes every tick. The page now takes the followed agent's position from its entity, so the chase camera sees the agent walk and swings behind it. The old follow camera jumped once per chunk for the same reason. The preview now sends `target_moved` as the plugin does, so it cannot hide this again.
- **A heading that arrives late still counts.** The first frames often have a position but no entity; the camera's first guess is replaced by the first heading.
- **A retune keeps the old picture until the server confirms it.** The world is swapped when the new agent's `hello` (or `target_moved`) arrives. If the server answers `rate_limited`, the monitor keeps its agent and its label. A retune on a monitor whose connection ended opens a new connection.
- **The foliage pull-in never moves the camera into a solid block.** It counts every block on the line and checked no collision, so after an agent dropped off a bank it could put the camera inside the bank.
- **A monitor frees its scene's GPU memory on every retune** (`KinoScene.dispose`), keeping the texture atlas shared by all monitors.

## Why

- The owner described the intent in two pictures: Lakitu and the Back to the Future Part II wall. The old page met neither. Its camera ignored the agent's heading, and its panes shared one keyboard.
- Keeping the wire protocol, the cap and the server unchanged keeps the security review of Kino (decisions 0075, 0093 and 0139) valid. The change is browser code plus one loader line.

## Consequences

- `camera/follow-pick.ts` (the five-candidate follow framing) is removed. Its job is done by the chase camera and the foliage pull-in. Its tests are replaced by chase-camera tests.
- `main.ts` is split: `panes/pane-view.ts` (one monitor's renderer, feed and camera), `panes/monitor.ts` (the monitor's frame and controls), `panes/wall-layout.ts` (where each monitor goes), `guide.ts` and `keys.ts`.
- A test-only preview, `glass/test/kino-preview/server.ts`, serves the real page with an invented world and three walking agents, so the page can be seen and screenshotted without a shard. `dev.html` is unchanged apart from the new pointer binding.
