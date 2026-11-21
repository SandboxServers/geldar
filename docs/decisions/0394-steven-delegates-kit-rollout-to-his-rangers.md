# 0394. Steven delegates the kit rollout to his rangers

- Status: Accepted (owner)
- Date: 2026-11-21
- Spec: section 13 (rollout and upgrades); 0008 (companion servers own repo; the upgrade PR is merged by the owner, never auto-merged), 0005 (pins and security updates)
- Related: scriptorium `docs/release.md` (the owner-merges rule this replaces, for his rangers only)

## Decision

1. Steven, the org owner, delegates the kit rollout to his rangers.
2. For his rangers, we open and merge their `geldar-play upgrade` pull requests. This replaces the owner-merges rule in scriptorium `docs/release.md`, for his rangers only. Every other player keeps that rule.

## The source of the owner-merges rule

`docs/release.md` in scriptorium cites "geldar 0008" for the rule. No geldar decision numbered 0008 is on `main`. The file exists on the unmerged branch `origin/docs/scriptorium-decisions` as `docs/decisions/0008-companion-servers-own-repo.md`. Its "Updates" paragraph states the rule: an upgrade is "a deliberate PR merged by the owner, never auto-merged (0005)". The rule is therefore 0008's paragraph, not the decision's title subject, and it is not yet on `main`. This record cites it so the rule has a source that a reader can find.

## Why

Sam's ruling of 2026-11-21. The rangers are the owner's delegates for the kit, so their upgrade PRs are merged by us on the owner's behalf.

## Consequences

- Upgrade PRs for Steven's rangers are opened and merged by us. Memory is still never touched (scriptorium `docs/release.md`).
- Scriptorium `docs/release.md` is not edited by this record; its owner-merges sentence applies to every other player.
- Until geldar 0008 reaches `main`, the citation in scriptorium points at an unmerged file. Merging the scriptorium decisions branch resolves that.
