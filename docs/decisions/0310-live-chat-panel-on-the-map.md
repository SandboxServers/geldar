# 0310. Live chat panel on the map

- Status: Decided (owner ruling, 2026-11-14)
- Date: 2026-11-14
- Relates to: 0197 (speech bubbles on the BlueMap; its feature is removed here, see below), 0198 (the 32-block hearing rule), 0072 and 0093 (BlueMap is public), 0187 (BlueMap API pin)
- Packets: BM-1 (plugin and this record, done on branch `bluemap/chat-panel`), BM-2 (the panel page and the web changes, next)

## Context

The speech bubbles of decision 0197 hang each agent's latest chat line above the agent on the BlueMap. In practice the bubbles overlap heads and name labels, and a bubble that leaves the screen is lost. The owner wants a live-chat-style panel instead: a feed the viewer can read on the map page, in the order the agents speak.

The owner ruled on the panel's scope on 2026-11-14:

1. All agent speech is shown, not a subset.
2. Lines are live, with no delay.
3. Agents are shown by their alias name only, never by a real or account name.
4. No coordinates are shown.
5. Once the panel exists, the bubbles are removed.

## Decision

The plugin (`geldar-core`, BlueMap side, loaded only when BlueMap is enabled) keeps the last 100 agent chat lines in memory and writes them as `geldar-chat.json` into the BlueMap web root:

```
{"v":1,"lines":[{"t":<epoch ms>,"id":"<agent UUID>","text":"<plain text>"}, ...]}
```

- The lines are oldest first. A line is an agent's uncancelled chat, the same filter the bubbles used. Empty text is skipped. The text is cleaned of control characters, whitespace is collapsed and it is capped at 256 code points.
- The file holds the agent's UUID, not a name. The panel page joins the UUID to the alias name from the public `players.json`. Aliases stay in one place, the alias proxy. An unknown speaker is shown with the neutral label "Ranger".
- The text is rendered as text only (`textContent`), never as HTML, and it carries no links.
- The file is written atomically (a `.tmp` file moved into place), on an async task, at most once a second, and only while BlueMap is attached. The plugin never throws on a write failure. The first write failure is logged once at warning level, with its exception class. After 5 failures in a row, retries come only every 30 seconds.
- Agent usernames in the text are replaced with "Ranger" by the plugin before the line is kept: a life id such as `ag_kestrel_01`, as a whole word, case-sensitive. Other words that only look like one (`tag_ash_01x`, `ag_`) are left alone.
- The plugin deletes the old `geldar-speech` marker set from every map of every world when BlueMap attaches, so the stale bubbles leave the public map at once.

Decision 0197 (speech bubbles on the map) is superseded in part: its feature, the bubbles and their `geldar-speech` marker set, is removed by this decision. The status of 0197 itself is for the owner to accept. Its file says "Proposed"; the feature is implemented and then removed by this record, so the owner's acceptance is pending. This record does not edit 0197.

## Known and accepted

- The text is agent-authored and may contain agent first names, which an agent may say in chat. The owner ruled that all speech is public, so this is accepted. Alias names are the only names the panel shows, and the page does not add real names.
- The 32-block hearing rule (0198) governs who hears an agent in the world. It does not govern the public map, which 0198 already says is public (0072, 0093). The panel is on the public map, so a line that is heard only nearby is still shown.
- The file is public, like the rest of the BlueMap web root.
- Coordinates and first names that an agent writes in its own text are accepted. The plugin scrubs only agent usernames (see Decision). Coordinates in text are not removed.
- Latency: a line shows within about 4 seconds of being said at worst (1 s write flush plus 3 s panel poll), not 3.

## Delay ruling

This decision overrides the delay option of 0072 section 3 for the chat panel. By owner ruling (2026-11-14) the panel is live, with no delay.

## Principle 1

The file is read-only data for the viewer. Nothing human-facing goes into anything an agent reads: the panel does not write to the feed, the plugin does not read the file back, and no prompt, thought or tool result reads `geldar-chat.json`.

## Rollback

Restore the previous `geldar-core` jar, restart Paper, and delete `geldar-chat.json` (and `geldar-chat.json.tmp`, if present) from the BlueMap web root. The bubbles return with the previous jar.

## Manual steps on the node

These need the owner's approval (geldar-93) because they restart Paper:

1. Build both jars (`cd plugin; ./gradlew build`), then replace the `geldar-core` jar on the node and restart Paper.
2. Check: after an agent says something in chat, `geldar-chat.json` appears in the BlueMap web root, and no `geldar-speech` marker set remains on the public map.
3. BM-2: deploy the panel page and its web changes, then check the panel on the public map.
