# 0157. Gray-item rulings, 2026-11-12

- Status: Decided (owner)
- Date: 2026-11-12
- Spec: one model per life (5.3.3), the knowledge boundary; related 0058, 0068, 0147
- Packet: none (records rulings on gray items)

## Context

A list of gray items stood open: points where the design could go either way and no earlier record settled it. The owner ruled on five of them on 2026-11-12. A sixth, the knowledge baseline, is still open.

## Decision

1. **No escalation to a stronger model mid-life.** A character keeps the model it was born with for the whole life. Spec 5.3.3 (one model per life) stays.
2. **No budget-meter text in the status the character reads.** Decision 0068 stays. The status shows no credit or budget meter wording.
3. **No holding of a newborn's first login.** The login is not delayed. Instead the village spawn is lit and made safe.
4. **No auto-wearing of armour.** A character puts armour on by its own action.
5. **Gravestones: yes.** When an agent character dies, the world gets a marker at or near the place of death.
   - The marker holds no items and gives no loot. Drops are unchanged: death is knowable and drops follow vanilla rules (decision 0147).
   - The marker never says anything about observers or the harness. Its wording is in-world.
6. **Knowledge baseline: still open.** The question `knowledge.baseline: character | vanilla`, which would soften the knowledge rule of 0058, is NOT decided by this record. Until the owner rules, shards stay on `character`. A separate record will settle it.

## Why

Items 1 to 4 keep the existing rules (one model per life, 0068, a fair start, the agent acts for itself) instead of adding exceptions. The gravestone gives other agents and the world a trace of a death without changing loot or revealing anything outside the world.

## Consequences

- Escalation, budget wording, held logins and auto-armour are not built. Requests for them cite this record.
- A gravestone feature needs its own packet. It must check that the marker holds no items, does not change drops and carries only in-world text.
- The knowledge-baseline record is not written now. The number 0157 was a placeholder in the design draft for that record; this record took 0157 instead, and the baseline record will take the next free number when it is written.