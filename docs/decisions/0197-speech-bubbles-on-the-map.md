# 0197: Speech bubbles on the BlueMap

- Status: Proposed
- Date: 2026-11-14
- Relates to: 0187 (the BlueMap API pin and the geldar-core BlueMap setup), 0072 and 0093 (BlueMap is public)
- Packet: speech-bubbles (phase 1)

## Context

An agent's chat line is already public: it appears in the world's chat, where anyone on the server can read it. The public map shows every agent's live position (`live-player-markers: true`, `plugins/bluemap/config/plugin.conf`), but nothing on the map says what an agent just said. A bubble above the agent on the map makes the map readable without adding a new channel for speech.

Thoughts are different. They are the agent's private reasoning and are not chat, so they do not reach the map.

## Decision

- An agent's chat line is shown as a speech bubble above the agent, on the public BlueMap only. Nothing is shown in game: the chat is already visible there, and the bubble adds nothing in game.
- The bubble is escaped plain text. Control, format and line or paragraph separator characters become spaces; whitespace runs collapse to one space; every `<`, `>`, `&`, `"` and `'` is HTML-escaped. The bubble carries inline styles only. No agent text is ever sent to the map as markup.
- Limits: at most 140 code points, the last three of which are `...` when the line is cut. Each bubble lives 12 seconds (`BubbleBook.LIFETIME_MILLIS`, expired at exactly 12000 ms). One bubble per agent: a new line replaces the agent's bubble and restarts its clock. The expiry sweep runs once a second on the server thread.
- Thoughts do not change. They stay off the map and out of the chat.
- The feature is on only when BlueMap is enabled. Without it, nothing is registered and the log says so.
- The bubbles are a dynamic BlueMap marker set with id `geldar-speech`, one per world. It is not in `plugins/bluemap/config/maps/*.conf`, which keep `marker-sets: { }` (no static markers).

## Marker refresh caveat

BlueMap's web app re-reads live markers on its own interval. The repo's BlueMap config has no key for that interval. The settings it does have are `full-update-interval: 1440` and `region-file-check-interval: 5` (`plugins/bluemap/config/core.conf`); both concern tile re-rendering, not markers. So a bubble shorter than the web app's marker refresh may never show. The 12-second lifetime is a choice, not a measured value. This is unverified until a live check on the node shows a bubble; if it does not show, the lifetime is the first thing to revisit.

## New compile-only dependency: flow-math 1.0.3

- `com.flowpowered:flow-math:1.0.3` is needed for BlueMap's `HtmlMarker`, whose constructor takes flow-math's `Vector3d`. The BlueMap API 2.8.2 artifact does not carry it on the compile classpath, and its transitive resolution failed on the lockfile and checksums.
- Pinned exactly in `plugin/gradle/libs.versions.toml`. The artifact is from 2016, far older than two weeks. It is served by Maven Central, which the build already consults; no repository is added.
- `compileOnly` only. The server provides it through BlueMap at runtime. `tasks.jar` packs `runtimeClasspath`, which does not carry `compileOnly`, so the plugin jar does not bundle it.
- The lockfile (`plugin/core/gradle.lockfile`) and the checksums (`plugin/gradle/verification-metadata.xml`) list only the new entries. `bluemap-api` keeps `isTransitive = false`.

## Consequences

- The speech code runs on the server thread and does not throw; a failure is logged once at fine level.
- Turning the feature off is a runbook step (`plugins/bluemap/README.md`, "Speech bubbles").
- Live check owed: a bubble shows on the map for its 12 seconds, and the escaped text is shown as plain text.
- Not yet accepted. The owner accepts or changes this record.
