# Genesis resume

Read this first, then [README.md](README.md) and [plan.md](plan.md). Card states are in the Ledger at the top of [packets.md](packets.md). Follow-ups: [followups.md](followups.md). Keep this under 40 lines; rewrite at each wave boundary.

## Where it is (2026-11-21, checked against origin/main 2aa29c3a)

- Merged: G0 and G1 except the workflow packets (GE-01w2, GE-02w1 to GE-02w4 not started; GE-01w1 partly merged: GE-01w1a #860 reproducible plugin jars and manifest from-lock, GE-01w1d #861 real plugin jar lock and digest-only verifier; GE-01w1b and GE-01w1c are not named in the repo, so the rest of GE-01w1 is unverified); G2-01, G2-04, G2-06; G3-01, G3-02, G3-04; GE-01a, GE-01b, GE-02a, GE-02b, GE-02c, GE-02e, GE-02f.
- Held: GE-01c (branch `phase1/gn-ge-01c`, a03c9f9d, not pushed; geldar-69 holds it until after the next deploy). GE-02d waits for GE-02w1.
- Exit criterion ([0240](../../decisions/0240-genesis-exit-is-the-scorched-earth-drill.md)): the scorched-earth drill. Delete every Geldar-owned host, VM, volume, container, network, secret, DNS record, Entra app and runner; keep only GitHub and the owner's bootstrap credential; regenerate from pipelines; verify and the smoke suite pass; a ranger can join.
- Decisions: [0240](../../decisions/0240-genesis-exit-is-the-scorched-earth-drill.md); [0241](../../decisions/0241-genesis-bootstrap-scope-cut.md) (bootstrap scope cut, GE-04b added); [0242](../../decisions/0242-genesis-includes-neoforge.md) (genesis includes NeoForge, GE-11 added); [0243](../../decisions/0243-genesis-drill-preserves-world-files.md) (drill preserves world files, burns the rest).
- The node source tree is a hand-synced snapshot; NeoForge mod folders are hand-staged; the velocity-identity jar was hand-swapped on 2026-11-18 (GE-01 replaces it).

## Open for the owner

- Decided (0243): world files preserved, everything else burned. Open: which database-resident data, if any, must survive the burn.
- The skins source.
- G2-04 and G2-05 Environments and Entra runs, and the G2-06 DNS run: owner's tenant.
- The backup credential (write-only, G5-01).
- Approval of each workflow PR (GE-01w1, GE-01w2, GE-02w1 to GE-02w4).

## Next actions, in order

1. Workflow packets GE-01w1 and GE-02w1 to GE-02w4 after the owner's approval; GE-01w2 last, after GE-04b and the channel.
2. GE-01c after geldar-69's say; GE-04b.
3. GE-06 backup and restore design.
4. G2-03, owned by geldar-registration.
5. G2-02, G2-05 and G3-03.
6. G2 to G4 with GE-03 to GE-05; GE-07; G5 to G7 and GE-09 (the drill).

## Rules for queueing

- Repo-only PRs queue themselves.
- A PR touching deploy-run scripts or a colo-images path goes to geldar-69 first; tell geldar-93 for every deploy-path PR. Workflow PRs say "touches .github/workflows" in the title or body.
- Nothing reaches the live node outside geldar-93's deploy window. No queueing during a deploy window.
- No overnight step touches the node or Azure; overnight work is repo and docs only (2026-11-18).
- No force, no rebase.
- Remove a worktree's node_modules junction with `cmd /c rmdir` first; never `git worktree remove --force` (see [followups.md](followups.md)).
- colo-cd must ignore unknown manifest keys (G1-04); tell geldar-93 before queueing it.
- Production is never rebuilt in place; the workflow changes only through owner-approved PRs.
- No secrets, account names or addresses in the repo.
