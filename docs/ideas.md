# Ideas

Where scope creep goes. An idea that isn't in [the spec](spec.md) or the current packet is written down here instead of being built. Each idea is a line or a short paragraph: what, why it might matter, and which phase could take it. Ideas move into the spec (and then into a packet) by a deliberate decision, never by being half-built in a PR.

| Idea | Why it might matter | Earliest phase |
|---|---|---|
| Kino agent's-eye view: a first-person camera at the agent's head (the closest chase zoom going inside, as Super Mario 64's C-up does). | People asked what an agent "sees"; decision 0156 covers the Body's own viewport image, which this would mirror for humans. Left out of decision 0161 (assumption A3). | Phase 1 (Kino) |
| Kino thought ticker: the agent's latest public thought as a caption strip under its monitor. | Fits the Back to the Future II wall of screens, but puts location and thought on one page; needs a privacy look under decision 0138. Left out of decision 0161 (assumption A5). | Phase 1 (Kino) |
| Kino with more than 4 monitors (a 3x3 wall). | The Back to the Future II wall shows more screens; the cap of 4 is an owner ruling (decision 0075) enforced by the relay, and the feed load has to be measured first. | After the Kino load budget |
