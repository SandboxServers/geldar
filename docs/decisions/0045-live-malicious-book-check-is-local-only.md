# 0045. The live malicious-book check is local only; CI proves the deterministic half (D-SC-01)

- Status: Accepted (the owner's decision D-SC-01 of 2026-11-08 as relayed in writing by the Scriptorium orchestrator; filed by the Phase 0 orchestrator; the owner should confirm the text)
- Date: 2026-11-09
- Spec: section 5.15.1 (sovereign players: no API key, subscription login only); decision 0044 (the corpus)

## Decision

The live malicious-book check (a real model reading the hostile corpus) is local only: the owner runs it with their own subscription login and never in CI. No API key is stored in any repo or CI secret, and CI never calls a model (spec 5.15.1).

CI proves the deterministic half only: the corpus text stays under `untrusted_world_text`, the launcher and kit refuse the attack actions, and the live check's pure evaluator turns recorded evidence into a verdict. The owner runs the live check before each release tag.

## Why

A model call in CI would need a credential in CI, which the spec forbids for sovereign players, and its verdict is not deterministic. The deterministic half catches regressions on every change; the live half measures what a model actually does and is a release gate run by a human.

## Consequences

- Release checklist gains one item: the owner's live check result, recorded before the tag.
- The Scriptorium repo owns the evaluator and the runner; this repo only carries the corpus scenarios and the world-side tests (decision 0044).
