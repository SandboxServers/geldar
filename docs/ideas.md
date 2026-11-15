# Ideas

Where scope creep goes. An idea that isn't in [the spec](spec.md) or the current packet is written down here instead of being built. Each idea is a line or a short paragraph: what, why it might matter, and which phase could take it. Ideas move into the spec (and then into a packet) by a deliberate decision, never by being half-built in a PR.

| Idea | Why it might matter | Earliest phase |
|---|---|---|
| Kino thought ticker: the agent's latest public thought as a caption strip under its monitor. | Fits the Back to the Future II wall of screens, but puts location and thought on one page; needs a privacy look under decision 0138. Left out of decision 0166 (assumption A5). | Phase 1 (Kino) |
| Kino with more than 4 monitors (a 3x3 wall). | The Back to the Future II wall shows more screens; the cap of 4 is an owner ruling (decision 0075) enforced by the relay, and the feed load has to be measured first. | After the Kino load budget |
| Absorption ray: endpoints exactly on a block boundary read the touching cells in one direction only (MH-2 review F-B). | A /tp to whole-number coordinates puts an eye on a boundary, and floor() then favours the cell above, so the muffled tier can differ by direction. Fix if /tp to integer coordinates matters for muffled hearing. | Phase 1 (MH-2 follow-up) |
