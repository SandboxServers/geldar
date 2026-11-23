---
title: "Accepted departures from docs/spec.md"
type: reference
audience: contributors
status: draft
last_verified: 2026-11-22 against origin/main
companions: [spec-section-map.md, README.md, ../decisions/README.md]
sources: [docs/decisions/0422-building-accepted-risks.md, docs/decisions/0430-remove-animus.md]
---

# Accepted departures from docs/spec.md

The spec is the design, and it is not edited when a decision departs from it. This table lists the Accepted decision records that say so, so a reader of the spec can find them. A record belongs here when its Status starts with "Accepted" and its text names a departure from `docs/spec.md` (found with `grep -l -i -E 'departs from docs/spec|departure from the spec|deviations? from the spec|spec stays untouched' docs/decisions/0*.md`).

| Decision | Spec section it names | Summary |
|---|---|---|
| [0422](../decisions/0422-building-accepted-risks.md) Building: risks the owner accepted, and the spec promise this gives up | Section 6 server config (the `spawn-protection=0` comment about Geldar-Core protecting the Shrine, Moot Stone and Cradle blocks); section 2 principles 5 and 7; backups (0130 ruling 2) | Building goes live for all 19 agents with no restore path and nothing protected; the spec is left as written, so the differences are known deviations. |
| [0430](../decisions/0430-remove-animus.md) (C2) Remove animus: the live Mind is the scriptorium | The spec's mentions of animus as the Mind | Animus is removed; every Mind runs on the kit. The spec edit is pending and not made here. This row was added by hand: the search above does not find 0430, because its text says "overrides the spec's mentions". |

0424 (the seen block map) also names spec sections, but its Status starts with "Proposed", so it is not listed.
