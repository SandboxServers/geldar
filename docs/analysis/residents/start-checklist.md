# Start checklist for a held resident

Used for Leonardo first (owner approval and geldar-93's go needed), then for each held resident when its Body verb is on main. Ids and aliases:

| Resident | id | life | alias | Skin file | Waiting for |
|---|---|---|---|---|---|
| Leonardo | ag-leonardo-01 | ag_leonardo_01 | Leonardo | leonardo_a.png | owner yes (spend) and a live placement test of lever, door, piston |
| Tamsin | ag-tamsin-01 | ag_tamsin_01 | Tamsin | tamsin_a.png | build plans verb |
| John Henry | ag-henry-01 | ag_henry_01 | John Henry | henry_a.png | anvil and repair |
| Marguerite | ag-marguerite-01 | ag_marguerite_01 | Marguerite | marguerite_a.png | brewing |
| Walton | ag-walton-01 | ag_walton_01 | Izaak | walton_a.png | rod |
| Ottoline | ag-ottoline-01 | ag_ottoline_01 | Ottoline | ottoline_a.png | write_book, enchanting, trading |

Persona folders: `docs/analysis/residents/personas/<id>/memory/` (identity.md, goals.md), on main.

## Steps (as run for Lewis, Clark, Chapman and MacDonald)

1. Owner approval of the resident and its skin (unlisted upload), and the cap: the owner's account is at 13 of 15 players, the cap needs about 20 for all six.
2. geldar-residents asks scriptorium-orchestrator for the public repo SandboxServers/player-<name> (the owner's yes must be given in scriptorium's own session).
3. geldar-worldops (with geldar-93's go): roster-add, player record, bare token file at the owner's config folder named <id>.token, public camera and delayed public thoughts on, Glass alias, shard config PR (colo.yaml and colo-mind.yaml), skin upload and import, whitelist, Glass restart.
4. scriptorium builds the host (`geldar-play new`) once the token exists, reports ready.
5. worldops starts the Body (player-start), health check; geldar-93 gives the go for the Mind; scriptorium starts it.
6. geldar-residents tells geldar-behavior the Body and Mind times and updates log.md.
