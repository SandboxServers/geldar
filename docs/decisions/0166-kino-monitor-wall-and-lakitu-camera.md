# 0166. Kino redesign: a monitor wall of Lakitu chase cameras

- Status: Proposed (implementer; owner rules A4, A9, A10)
- Date: 2026-11-13
- Spec: section 2 (Principle 1), section 5.13 (the Observatory) and the names table in section 2a (the Glass). Decisions 0075 (Kino), 0100 and 0101 (the feed), 0139 (agents-only entity feed).

## Requirement

Owner feedback on the Kino page, 2026-11-13: "It's supposed to be a Mario 64 like camera tool to watch agents in game. I also envisioned it like the multi view screen from Back to the Future Part II, where you can watch multiple cameras at once. It probably needs a full face-lift and redesign."

The owner asked for this to be planned and built autonomously, with the assumptions written down. This record is that list. Each assumption is the implementer's call until the owner rules. A4, A9 and A10 change or lean on an owner requirement, so they are marked **owner call** and this record stays Proposed until the owner rules on them.

## Decision

### 1. The camera: follow becomes a Lakitu chase camera

Before, `follow` kept a fixed offset along the world axes (always north of the agent, whichever way it faced) and picked between five candidate offsets to see past leaves. It never turned with the agent and had no player controls beyond a drag.

Now `follow` behaves like the Lakitu camera in Super Mario 64:

- **Behind the agent.** The camera sits behind the agent's heading, which comes from the agent's own `yaw` in `entity_positions`. When the agent has no entity yet, the heading comes from its movement.
- **Lazy swing.** The camera swings round behind the agent only while the agent is moving, and with lag. An agent turning on the spot or looking around does not whip the camera.
- **Rotate in 45-degree steps** (`Q`/`E`, the arrow keys, or the on-screen buttons), with eased motion, like the C buttons. A drag still turns the camera freely. In free-fly, "rotate right" turns the view to the right.
- **Three zoom distances** (close, medium, far), stepped with the wheel, `+`/`-`, or the on-screen buttons, like C-up and C-down.
- **Recentre** (`R`, or a double-click) swings the camera round behind the agent's current heading, also when the agent turned while standing still.
- **Pushes in at walls.** A ray runs from the agent's eyes out to the wanted position and stops at the first block that stops the camera (A9). Blocks the ray overlaps before it first gets clear of the agent's own eyes are ignored, so an agent pressed into a wall or a trunk does not swallow the camera. The camera snaps in fast and eases back out slowly, so it does not pump. The existing foliage pull-in still moves the chase camera closer when leaves hide the agent, but never into a solid block. When the way behind is blocked (an agent pressed against a bank or a wall), the camera first tries higher positions, rising straight up from the eyes as far as that is clear and then going out, and eases up to the lowest one that is clear, as Super Mario 64's camera rises over a wall. It comes back down slowly once the wall is gone. Where no height is clear (a one-block tunnel), it stays pushed in.
- **Swoop-in.** When a camera tunes to an agent, it starts high and far and swoops down to the chase position (the Lakitu intro). The swoop follows the same collision ray, so under a roof or in a cave it stops at the ceiling instead of showing the inside of the ground. It is skipped under `prefers-reduced-motion`.

`orbit` keeps its collision-bound circle and gains smoothing and a slow turntable drift after a few idle seconds (off under reduced motion). `free` gains acceleration and easing so it no longer starts and stops dead. A switch to orbit starts the circle where the camera is (its distance from the agent becomes the radius); a switch to free-fly keeps the view's direction.

**Assumption A1: the wire modes stay `follow`, `orbit` and `free`.** The Lakitu behaviour lives entirely in the browser. `kino-client.schema.json`, the relay, the audit and the plugin are unchanged. The audit still records the mode by the same name.

**Assumption A2: zoom and rotation are view-only.** They send nothing. Only a mode change or a retune sends `subscribe`, exactly as before. Principle 1 holds by construction: the camera modules still use no network API (test: "the camera sends nothing").

**Assumption A9 (owner call): every camera mode passes see-through blocks and plants.** Decision 0075 point 3 makes the camera collision-bound (an owner requirement), and before this change any block other than air stopped it, including leaves, glass, water, grass and flowers. Under a tree, the orbit camera collapsed onto the agent's head (seen in the preview). The renderer already fades see-through blocks near the camera and on its line to the agent (`fade.ts`, from packet card `phase1/k13-kino-view`). With this change a block stops the camera only when it is a full cube or has a box shape (slab, stairs, fence, door) and is not see-through. Unloaded space still stops it, so the camera never leaves the drawn world. The camera can therefore enter a closed room through a glass window. Collision remains a viewing constraint only (decision 0075, point 3). If the owner accepts A9, this record amends decision 0075 point 3 for see-through blocks and plants (the 0075 row in the index says so). If not, `blocksCamera` in `camera/collision.ts` goes back to "anything but air", and the chase camera keeps everything else.

**Assumption A3: no first-person (agent's-eye) view.** That is a different feature, and nobody has asked for it.

### 2. The page: a monitor wall

Before: one toolbar with a select box and an "Open pane" button, and panes in an auto-fit grid with plain buttons over the canvas. The keyboard drove every pane at once: pressing `W` in free mode moved all open free cameras, and `1`/`2`/`3` set the camera mode of every pane.

Now:

- **Monitors.** Each pane is a monitor with a bezel, a channel number (`CH 1` to `CH 4`), the agent's display label, the camera mode and a live light. Its controls (mode, rotate, zoom, recentre, retune, solo and close) appear on hover or focus, and always on touch screens.
- **One active monitor.** Clicking or tapping a monitor, or pressing `1` to `4`, makes it active. The keyboard drives the active monitor only. The mode keys are now `C` (cycle) and the monitor's buttons. A held key's auto-repeat never repeats a command (holding `X` does not close every monitor), and a focused button keeps its own `Space` and `Enter`.
- **Layouts.** *Wall* (equal tiles), *Feature* (the active monitor large, the others as a strip beside it, or below it on a phone) and *Solo* (the active monitor alone). Hidden monitors stop rendering but keep their feed (see "Load" below).
- **Empty slots show "no signal".** Up to the cap, a free slot is shown as static with a "Tune in" button, so the wall reads as a wall of screens. "Tune in" fills that slot with a new monitor; it never retunes the active one.
- **Channel guide.** A drawer lists the agents the server lets this viewer watch, by label, with a face drawn from the agent's skin when one is served. Faces are fetched the first time the guide opens, not at page load. Choosing one tunes the active monitor; "Watch on a new monitor" fills a free slot.
- **Channel surfing.** `[` and `]` (or the monitor's arrows) step the active monitor to the previous or next agent. A run of steps sends one subscribe, 400 ms after the last step.
- **Help.** `?` opens a keyboard and touch reference.
- **Tuning in.** A monitor shows static and "Tuning in to <agent>" until the server names that agent (its `hello`), instead of an empty sky or a label that already changed. After 10 s without an answer it says the agent may be offline and keeps waiting.
- **Refusals.** A subscribe the relay refuses is shown on the monitor. A refused first subscribe (`rate_limited`) and a feed ended by `pane_cap_reached`, a dropped connection or an unavailable feed show a notice with a "Try again" button. A refused retune keeps the agent the server is really sending, and says so. Ends that need the owner, a sign-in or a reload (`kill_switch`, `target_not_permitted`, `session_ended`) show their text with no button.
- **Phones.** One column. The active monitor's controls dock at the foot of the screen in two rows, so they never cover the agent. Touch targets are 44 px high.
- **Remembered.** The wall (layout, and each monitor's agent and mode) is kept in `localStorage` and restored on the next visit, filtered by the agents the server lists now. Storage failures are ignored. The saved wall belongs to the browser profile, not to a login: whoever uses that profile gets the same wall back (still only the agents the server lets them watch). A wall the viewer emptied stays empty on the next visit.
- **Graphics.** Closing a monitor gives its WebGL context back at once (`forceContextLoss`); with four monitors the page holds four contexts. A monitor whose context the browser drops stops drawing, says so, and draws again when the browser restores it.

**The subscribe rate limit.** The relay keeps two token buckets per viewer session (decision 0075; `glass/src/kino/relay.ts`): one for a change of agent and one for a change of mode on the same agent, each a burst of 8 then one per 2 s. They are shared by every monitor, tab and reload of that viewer. The page keeps its own copy of both buckets (`panes/subscribe-gate.ts`): every subscribe waits there until the copy allows it, and a monitor's newer request replaces its waiting one. So surfing, mode changes and a restored wall stay under the limit as far as this page can tell. Another tab or a quick reload spends the same server buckets without this page knowing, so a refusal can still come; it is handled as above. A restored wall opens its first monitor at once and the others one per 2 s, so a reload does not spend the burst.

**The pane cap is per viewer session at the relay, not per page.** Two tabs of the same viewer share the 4 panes; the second tab's extra monitors end with `pane_cap_reached` and offer Try again.

**Assumption A4 (owner call): the cap stays at 4 monitors.** It is an owner ruling (decision 0075 amendment, point 4) and the relay enforces it. Back to the Future's wall shows more, but raising the cap is the owner's call. The page reads the cap from one constant.

**Assumption A5: no thought ticker under each monitor.** Showing an agent's latest thought beside its camera would suit the TV look, but it puts location and thought together on one page and is new scope. It is listed in `docs/ideas.md`.

**Assumption A6: the look is a dark control room, from system fonts and CSS only.** There are no web fonts (the Kino CSP has no font source) and no image files of the page's own. The static on monitors is a `data:` SVG noise filter in `kino.css`, and the guide draws each agent's face from its skin PNG (served same-origin under `/kino/skins/`) on a canvas. The CSP allows both (`img-src 'self' data: blob:`). The faint scanlines on monitors are CSS. The static and scanline animations stop under `prefers-reduced-motion`. Colours come from tokens on `:root`. Nothing about a monitor's colour is derived from agent data.

**Assumption A7: the styles move to `kino.css`.** Glass's Kino web loader now serves `.css` files from `glass/web/kino/` as well as `.ts` and `.html`. The Kino CSP is `style-src 'self' 'unsafe-inline'`, which already allows a same-origin stylesheet.

**Assumption A8: the per-pane status line is kept, folded.** The "connected | chunks | entities | atlas" line is how people find a broken pane without devtools (and `tools/kino-shot` reads it). It moves behind an info toggle on each monitor and in the top bar. The text and element ids stay the same. When the texture atlas fails, the top bar unfolds it so the error is seen. `tools/kino-shot` now drives the channel guide instead of the old select box; its checks and outputs are unchanged. With `--agent` it starts from an empty saved wall, so a run sends one subscribe, and it picks the agent by id (or exact label), never by part of a label.

**Assumption A10 (owner call): a first visit tunes CH 1 to the first agent the server lists**, so the page shows a picture at once instead of an empty wall. A first visit is one with no saved wall in the browser. Each such page load opens a pane: it writes an audit row (`pane_opened`, kept 90 days) and makes the plugin read that agent's surroundings (a `start` on NATS when nobody else watches it). Anonymous viewers count against the global anonymous ceiling of 40 panes (decision 0075 amendment), so idle anonymous tabs, or a crawler that runs scripts, could fill it. Options for the owner: keep it; tune CH 1 by itself for signed-in viewers only; or never, so CH 1 waits for a click on "Tune in".

### 3. Feed details the camera depends on (found in review)

- **The camera follows the agent's entity, not `target_moved`.** The plugin sends `target_moved` only when the agent enters another chunk; the agent's entity (position and yaw) comes every tick. The page takes the followed agent's position from the entity in the current `entity_positions` message (not from the merged store, which keeps an entity for up to 30 s and would put back an old position), so the chase camera sees the agent walk and swings behind it. The old follow camera jumped once per chunk for the same reason. The preview sends `target_moved` as the plugin does, so it cannot hide this again.
- **A heading that arrives late still counts.** The first frames often have a position but no entity; the camera's first guess is replaced by the first heading.
- **The picture follows what the server says it is sending.** A `hello` (or `target_moved`) naming another agent starts a fresh world for that agent, so two agents' worlds never mix, whatever order retunes and replies arrive in. A retune keeps the old picture until then. `rate_limited` does not say which subscribe it refuses; the page takes it as the waiting retune, and a wrong guess heals itself when the server names the agent it is sending. A retune on a monitor whose connection ended opens a new connection.
- **A monitor frees its scene's GPU memory on every retune** (`KinoScene.dispose`), keeping the texture atlas shared by all monitors.

### 4. Load (owner call, not measured)

Up to four live panes per viewer: four websockets, four WebGL renderers, and for each watched agent the plugin's reads. **Not measured** on a shard or on the node: this change does not alter what one pane costs the plugin, but the wall makes four panes the normal case rather than the exception. Decision 0075 amendment point 4 says measure first; the proposed budget is added tick time under 1 ms at the 95th percentile with four panes (`docs/analysis/phase1/packets/c2b-packets.md`, card 01 step 8). That measurement should be run before this is the default page on the node.

Hidden monitors (Solo, the Feature strip) keep their feed and keep meshing what arrives. They do not unsubscribe, because an unsubscribe and a resubscribe each time the layout changes would spend the relay's subscribe bucket (three subscribes for one Solo to Wall flip, so the limit is hit in three flips), write a `pane_closed` and a `pane_opened` audit row each time, and restart the picture with the swoop. The owner may prefer otherwise; the options are to unsubscribe hidden monitors after a grace period, or to cap a Solo wall at the one visible monitor.

## Why

- The owner described the intent in two pictures: Lakitu and the Back to the Future Part II wall. The old page met neither. Its camera ignored the agent's heading, and its panes shared one keyboard.
- Keeping the wire protocol, the cap and the server unchanged keeps the security review of Kino (decisions 0075, 0093 and 0139) valid. The change is browser code plus one loader line.

## Consequences

- `camera/follow-pick.ts` (the five-candidate follow framing) is removed. Its job is done by the chase camera and the foliage pull-in. Its tests are replaced by chase-camera tests.
- `main.ts` is split: `panes/pane-view.ts` (one monitor's renderer, feed and camera), `panes/monitor.ts` (the monitor's frame and controls), `panes/wall-layout.ts` (where each monitor goes), `panes/subscribe-gate.ts` (the page's copy of the rate limit), `guide.ts` and `keys.ts`. What `main.ts` still decides (routing a key, what a page load opens) is in `keys.ts` (`routeKey`) and `panes/saved.ts` (`startupPlan`), so the untested wiring is wiring only.
- A test-only preview, `glass/test/kino-preview/server.ts`, serves the real page with an invented world and three walking agents, so the page can be seen and screenshotted without a shard. `dev.html` is unchanged apart from the new pointer binding.
- **Later: a camera-aware region message.** Sending a pane only what its camera can see would need a new client message (the camera's position or view), so its own `kino-client.schema.json` change and its own rate bucket, against that schema's rule that the client sends no coordinates. The chase swoop (which starts high and far), hidden monitors and A9's "unloaded space stops the camera" would have to be reconciled with it then. No code change for it now.
