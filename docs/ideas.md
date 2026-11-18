---
title: Ideas
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 3f07a4be
companions: [spec.md, README.md, decisions/README.md, analysis/docs-library/RESUME.md]
sources: [docs/spec.md, docs/decisions]
---

# Ideas

Where scope creep goes. An idea that isn't in [the spec](spec.md) or the current packet is written down here instead of being built. Each idea is a line or a short paragraph: what, why it might matter, and which phase could take it. Ideas move into the spec (and then into a packet) by a deliberate decision, never by being half-built in a PR.

| Idea | Why it might matter | Earliest phase |
|---|---|---|
| Kino thought ticker: the agent's latest public thought as a caption strip under its monitor. | Fits the Back to the Future II wall of screens, but puts location and thought on one page; needs a privacy look under decision 0138. Left out of decision 0166 (assumption A5). | Phase 1 (Kino) |
| Kino with more than 4 monitors (a 3x3 wall). | The Back to the Future II wall shows more screens; the cap of 4 is an owner ruling (decision 0075) enforced by the relay, and the feed load has to be measured first. | After the Kino load budget |
| Maven mirror or caching proxy for CI runners. | Maven Central HTTP 429s keep failing the plugin and neoforge jobs (main push run 44209178309 on 2026-11-17/18, earlier merge-queue ejections); the retry-once step in ci.yml is a mitigation. A mirror or proxy is a larger infrastructure change; the owner approves PRs, not infrastructure, so it is parked. | Unscheduled (needs an owner decision) |
| Absorption ray: unconfirmed hypothesis that endpoints exactly on a block boundary read the touching cells in one direction only (MH-2 review F-B). No asymmetry was found in 640,000 probed pairs (MH-2 verification); the guarantee is stated for interior endpoints only. | If the hypothesis holds, a /tp to whole-number coordinates puts an eye on a boundary, and floor() then favours the cell above, so the muffled tier can differ by direction. Confirm before any fix; fix only if /tp to integer coordinates matters for muffled hearing. | Phase 1 (MH-2 follow-up) |
