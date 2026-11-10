# Documentation index

Start with the [README](../README.md) for the project overview. This page lists what is in `docs/`.

## Spec

- [`spec.md`](spec.md): the full design, version 0.8 (draft). Section 2 holds the principles, section 3 the glossary, section 10 the Phase 0 exit criteria.
- [`threat-model.md`](threat-model.md): assets, actors, trust boundaries, Phase 0 surfaces and what we do not protect against.

## Decisions

- [`decisions/`](decisions/): one short record per settled decision. The index table is at [`decisions/README.md`](decisions/README.md).

## Analysis and the Phase 0 campaign

- [`analysis/phase0/`](analysis/phase0/): the Phase 0 campaign ("Adam").
  - [`RESUME.md`](analysis/phase0/RESUME.md): the short current-state card. Read this first.
  - [`README.md`](analysis/phase0/README.md): the campaign ledger, with packets and open decisions.
  - [`work-packets.md`](analysis/phase0/work-packets.md): the packet plans for the early waves; later waves have their own `wave5-packets.md`, `wave6-packets.md` and `waveM-packets.md`.
  - [`overnight-decisions.md`](analysis/phase0/overnight-decisions.md): decisions taken while the owner was away.
  - [`bench-results.md`](analysis/phase0/bench-results.md) and [`bench-runs/`](analysis/phase0/bench-runs/): Body benchmark results.
  - [`retro/`](analysis/phase0/retro/): the retrospectives at the end of each wave.
  - [`worknotes/`](analysis/phase0/worknotes/): review findings, live-run notes and diagnoses.

## Operations

There is no separate ops handbook yet. The procedures are the skills in [`.claude/skills/`](../.claude/skills/):

- [`run-shard`](../.claude/skills/run-shard/SKILL.md): bring the stack up and check its health.
- [`body-bench`](../.claude/skills/body-bench/SKILL.md): run the Body benchmark and record the numbers.
- [`ship-pr`](../.claude/skills/ship-pr/SKILL.md): branch to merged pull request.

## Ideas

- [`ideas.md`](ideas.md): ideas outside the spec and the current packet. An idea goes here instead of into code.

## Glossary

- [`glossary.md`](glossary.md): the terms the code and docs use.
