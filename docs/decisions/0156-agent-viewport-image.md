# 0156. Agent viewport image: the Body renders its own first-person view to a PNG

- Status: Proposed (spike result; owner decides)
- Date: 2026-11-12
- Spec: Principle 1 and the knowledge boundary (5.2); related 0075 (Glass is a Lakitu camera), 0139 (Kino feed lists agents only), 0154 (perception rules)
- Number: 0156 is the next free number after 0155; it is not in a packet block of the Phase 1 registry, so the orchestrator confirms it.
- Spike: `tools/viewport-spike/` on branch `phase1/viewport-spike`

## Context

Claude-driven agents can read images. A first-person picture of what the Body sees (eye position, facing) may help them with spatial tasks that text perception does handle poorly (is that a gap or a wall, where is the tree). It must show only what the Body could see (0154: "what a player could see"), and nothing about being watched (0093, 0138, 0139).

## Options measured

| Option | Native code | Image cost | Verdict |
|---|---|---|---|
| A. prismarine-viewer headless (node-canvas-webgl) | canvas + gl | needs xvfb/Mesa; the project is stale, needs textures assets | no |
| B. Kino three.js mesher + headless-gl | `gl` 8.1.6 (prebuilt binary, install script) | measured in the real base image: `/usr` 223 MB to 435 MB (+212 MB for xvfb, xauth, Mesa DRI, libgl), +40 MB `node_modules`; the GL context only exists under `xvfb-run` (without X it returns null) | works, heavy, breaks `--ignore-scripts`, a second process (Xvfb) per container |
| B2. Kino page in headless Chromium (Playwright, as `tools/kino-shot`) | Chromium (~400 MB) | far larger, needs the BlueMap texture feed | no for the Body |
| C. CPU voxel raycaster in TypeScript (this spike) | none | +0 MB, `node:zlib` only | recommended |

C reads the same `VoxelWorld` the Kino client meshes from (fixtures are real `chunk_section` messages), uses Kino's face shading and fog constants, and marches one ray per pixel (DDA).

## Measurements (320x180, node 22.23.2, this desktop and the pinned `node:22.23.2-trixie-slim` image in Docker, 256 MB memory cap)

- Render plus PNG encode, median of 6: pit scene 40 to 45 ms, open terrain 63 to 131 ms (Docker numbers within 5% of the host).
- Memory: RSS 67 MB (host) to 87 MB (Docker) for the whole process including the Node runtime and 64x64 blocks of fixture world; heap 12 to 15 MB.
- PNG size: 16 KB (blank wall) to 38 KB (terrain); base64 in the MCP message 21 to 51 KB.
- Token estimate: about width x height / 750 = 77 image tokens at 320x180 (the usual Claude image formula); 640x360 would be about 307.
- Output is byte-identical between host and Docker (deterministic; there is no GPU or driver in the path).
- Not verified: a live mineflayer bot (the shard was not started in a spike); a real-texture version; Mesa headless-gl rendering a frame (only context creation was shown).

## What the spike does and does not do

Works: eye position and yaw/pitch to a PNG; enclosed sandstone pit with one gap (zombie visible through the gap), a creeper behind the wall (invisible), rolling terrain with trees, water and fog, the loaded-world edge (renders as sky). Four vitest cases: an entity behind a wall changes no pixel (this test fails when the depth test is removed; checked), an entity in the open does, unloaded space is sky only, PNG validity.

Does not: textures (flat colours with per-texel noise; production reads the atlas average colours from the Kino texture feed, or a small baked table), non-cube shapes (slabs, stairs and plants are cubes or skipped), light levels and night, rain, the held item, the player's own arm, mob models beyond one box per mob, animation.

## Knowledge boundary (how the render stays honest)

1. Input is only the Body's loaded blocks (`bot.blockAt` through a `StateReader`; an unloaded cell ends the ray, drawn as sky). No server data, no other chunk.
2. A ray ends at the first opaque cell. There is no depth-less pass, so no x-ray. Pixels behind a wall cannot depend on what is behind it (tested).
3. Entities come from the Body's own perception list, the same set as the text perception (0154 point 7: in sight), and are depth-tested per pixel. Distant entities are subject to the same range cut. Mobs only are drawn by type; no player names, no name tags, no health bars.
4. The image is pixels only: no text, coordinates, compass, minimap, crosshair, chat, spectators or Lakitu cameras. Nothing in it can reveal being watched; the Glass and Kino feeds are never read by the renderer (0139).
5. Same eye height and fov as the client (1.62 m, 70 degrees vertical), so it shows no more than a player would see. Range cap 96 blocks, inside the loaded view distance.

## Proposed rules

- Tool: `see` (one tool, optional `yaw` and `pitch` offsets limited to the head's real range; default is where the Body looks now). Free, like `reach` (0154 point 7), but rate-limited: at most 1 image per 5 s per agent and 30 per hour. Budgets are suspended, so the limit is the cost control; if budgets return, meter it at the size of the image tokens, not as an action.
- Size: 320x180 default, 640x360 maximum, PNG only, hard cap 256 KB per image; a render that exceeds the cap is re-rendered at the default size.
- Return shape: MCP `CallToolResult.content` holds one `{ type: 'image', data: <base64>, mimeType: 'image/png' }` item (MCP SDK 1.32.2, the version `threshold/mcp` pins) plus one `{ type: 'text' }` item with a fixed caption ("what you see, from your eyes"); clients that cannot read images get the caption only. Image items are not stored in the thought log (store size and hash, not pixels).
- Failure: a typed reason, never `internal`: `view_unavailable` with `detail` one of `renderer_disabled`, `chunks_not_loaded` (the eye cell is unloaded), `rate_limited`, `render_failed`. The text perception is unaffected.
- Where it runs: inside the Body process, in a `worker_thread` (a 50 to 130 ms CPU burst must not block the 20 Hz tick). No sidecar: it would need the world state copied out. No change to the image: no apt package, no native module, no change to the Dockerfile.

## Consequences

- Positive: no GPU, no Xvfb, no Chromium, no install script, the image does not grow, runs identically on Windows dev and Linux CI, deterministic output (it can be a golden-file test).
- Negative: the picture is blockier and less pretty than a real client; plants and mob models are rough. Agents may be misled by missing detail; the caption says it is an approximation.
- Risk: an image path is a new way to leak. Every addition (a light level, a name tag) needs its own review against 0154. Images are only for agents whose Thinker can read them; the Body never sends them to others.

## Recommendation: go, with the smallest packet list

1. VP-1: promote the renderer to `golem/src/viewport/` (render, png, colours, tests, golden hash), colours from a baked table of the common blocks.
2. VP-2: the Body reader adapter (`bot.blockAt` + eye + yaw/pitch + entities in sight, same filter as perception) and the worker thread.
3. VP-3: the contract (`see` tool, `view_unavailable` reasons, rate limit) and the threshold MCP image content.
4. VP-4: texture colours from the Kino atlas average colours, non-cube shapes, light level (only after VP-1 to 3 are proven useful).
