---
name: reference_headless_media_2026_11_13
description: Taking screenshots, video and GIFs of the WebGL Kino page on the Linux dev box without a GPU
---

Verified 2026-11-13 on the Linux dev box (no GPU, no system ffmpeg, Node 24, no PowerShell) while redesigning Kino (decision 0161).

- **Playwright from `tools/kino-shot`** (1.64.1) works for any script: import `tools/kino-shot/node_modules/playwright/index.mjs` by absolute path from a scratch script; `pnpm --filter @geldar/kino-shot browsers` downloads Chromium and Playwright's own ffmpeg into `~/.cache/ms-playwright`.
- **WebGL needs SwiftShader** (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`). It renders correctly but slowly: with three or four Kino monitors it runs at a frame or two per second, so timed animations that advance per frame (the chase camera's swoop, clamped to 0.1 s per frame) take several seconds longer than in a real browser. Wait longer before a screenshot; it is not a page bug.
- **`<option>` elements are never "visible"** to Playwright: wait with `{ state: 'attached' }`.
- **Playwright's ffmpeg is minimal**: VP9 WebM and PNG only, no `fps` or `scale` filter. Seek frames with `-ss <t> -frames:v 1`, or sample with the output option `-r 4`.
- **GIFs**: `uv run --no-project --python 3.12 --with pillow==11.3.0 python -I make_gif.py`. Pillow has no wheel for the default Python 3.15 and the box lacks zlib headers to build one. Animated TV static and dithered leaves do not compress: crop to one monitor, 480 to 560 px wide, 2 frames a second and 64 colours to stay near 4 MB.
- **`pkill -f <pattern>` can kill the calling shell** when the pattern appears in its own command line; kill background servers by a saved PID instead.
