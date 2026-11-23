# 0431. Corrections to 0391, 0392 and 0393; release tags are made by the bot

- Status: Accepted (co-owner)
- Date: 2026-11-22
- Spec: no spec section; decision-only.
- Related: 0391, 0392, 0393

## Decision

1. 0391, 0392 and 0393 were the co-owner's rulings; their "owner" or "operator" attribution is wrong. Read their "Accepted (owner)" and "the owner ruled" as the co-owner.
2. 0392 item 3 is superseded: the kill switch is `docs/runbooks/kill-switch-programs.md` (#916). The branch behind #880 alone is not a kill switch.
3. 0393 item 5 is superseded: the co-owner ruled on 2026-11-22 that the agents' identity creates `kit-v*` and `geldar-v*` tags.

## Why

The three records named the wrong role for who ruled, and 0392 and 0393 each fixed a step that the work since has replaced. A record is never rewritten (see the decisions README), so this record says which parts to read differently. 0391, 0392 and 0393 are not edited.

## Consequences

- A reader of 0391 to 0393 applies this record first. The glossary has a Co-owner row that says who that is.
- Tags `kit-v*` and `geldar-v*` may be created by the agents' identity. The rulesets that stop a tag being moved or deleted are a separate step.
