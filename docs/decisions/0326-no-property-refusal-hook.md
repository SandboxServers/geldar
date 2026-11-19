# 0326. No property-refusal hook: mining stays free

- Status: Accepted (operator ruling, 2026-11-18) for the no-build ruling. The OD-2 to OD-4 answers below are approved only for the case that OD-1 is revisited; they are not in force.
- Date: 2026-11-18
- Spec: section 2 (Principle 5). `docs/spec.md` is not edited.
- Related: 0164 (**not amended by this record**), 0165 (block ownership); D-CS-02 in [decisions-before-packets.md](../analysis/character-sheet/decisions-before-packets.md); OD-1 to OD-4 and cards S9-01 to S9-04 in [work-packets-sheet-w9-w12.md](../analysis/harness/work-packets-sheet-w9-w12.md)

## Context

OD-1 asked whether a life's own `law` trait may refuse a deliberate `mine` or `withdraw` on a cell another life placed, which would amend 0164 (deliberate mining stays free). The cards planned decision 0283 for that hook. OD-2 to OD-4 were its wording, the meaning of "starving" and the rolls-off rule.

## Decision

1. **OD-1: no.** A life's traits do not refuse a deliberate `mine` or `withdraw`. Mining stays free, as 0164 has it.
2. **The W9 refusal hook is not built.** S9-01 (refusal reason and key), S9-02 (the hook), S9-03 (its binding behind `morality_hooks`) and S9-04 (the W9 close for the hook) are not dispatched. W9 closes as merged inactive: nothing of the hook is in the code, and `morality_hooks` stays a tolerated, ignored key.
3. **This record does not amend 0164.** 0164's text and meaning are unchanged.
4. **Decision 0283 is not written.** The number planned for the hook record is released; it is not used as an Accepted record for this ruling.
5. **If OD-1 is ever revisited**, these answers are approved for that case:
   - OD-2: the agent-visible sentence is "you decided against taking what is someone else's";
   - OD-3: starving is hunger at or below 6 and no edible food carried;
   - OD-4: with `rolls: false` the hook fails open (never refuses).

## Consequences

- S9-00 (erasure gate, 0323) is not part of the hook and stays in W9 as a live card.
- HC-41 (reflection facts never carry hidden truth) is not part of the hook; it stays blocked on HC-32.
- Principle 5 needs no new reading: misbehaviour such as taking another's blocks stays data.
- Revisiting OD-1 needs a new record that amends 0164 explicitly; this one does not.
