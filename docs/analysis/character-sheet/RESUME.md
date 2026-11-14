# Character sheet campaign resume

Read this, then README.md, integration-plan.md and the upcoming wave in work-packets.md.
Status: owner requested full-brief planning; behavioral rulings remain proposed; no dispatch.
Baseline inspected: 8eac28ba (PR #329), 2026-11-13.
Source reviewed: animus-character-sheet-brief.md supplied by the owner.
The source is a proposal, not an accepted extension of the spec.

Plan: eleven phases, W0-W12; 62 candidates AN-00..AN-61 (one optional tooling slot).
All brief proposals are scheduled, including morality, programs, lineage and drift.
Most implementation packets target 50-70k working tokens; small unblockers stay smaller.
No product code, prompts, schemas, shared campaign files or live services changed.
No worktrees created; current checkout was detached and initially clean.

Next: walk through decisions-before-packets.md; planning scope is already authorized.
Settle behavioral D-CS choices before writing the dependent executable cards.
Technical contracts to freeze are listed in integration-plan.md.
Then expand W0/W1 into executable cards with exact files, fixtures and commands.
Reserve ADR/migration/prompt numbers against current registry and active branches first.
0173-0179 and SQL 0024-0033 belong to C7; thought v6/v7 are reserved elsewhere.
Do not edit docs/spec.md; accepted ADRs amend it (decision 0073).

W1 foundations; W2 Body/XP; W3 heuristic core; W4 checks/attention/prose.
W5 evidence; W6 theory of mind; W7 explore/farm/patrol; W8 complete evidence and XP.
W9 morality/reflection; W10 lineage; W11 drift; W12 measurement and final rollout.
AN-33..36 are in W12; former later ids AN-37..43 are now scheduled, not deferred.
Birth/Cradle and Thinker remain tracked C4 dependencies; no unverified completion claim.
Colo Mind activation still depends on a verified Thinker path (0134).
Sheet values and experiment bars need approval before their activation/run gates.
Optional Codex adapter proposal is in codex-adapters.md; nothing installed.
Review policy: current AGENTS requires each packet reviewed; older skills say wave-only.
Resolve that conflict explicitly in AN-00; do not silently weaken current AGENTS.
