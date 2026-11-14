# MH-7 owner summary: spec amendment for muffled hearing

Proposed for approval. Source: decision 0199 and card MH-7. Only docs/spec.md changes, three lines. No numeric absorption, margin or penalty value is hard-coded; they are marked tunable and not measured (the MH-8a bench sets them).

- spec.md line 381 (5.2 perception, earshot). Before: "entities within line of sight or earshot;". After: same, plus "(earshot is the speech rule of 5.8: words within 32 effective blocks, a words-free muffled notice beyond that)".
- spec.md line 666 (5.8 speech). Before: say() reaches agents within 32 blocks, a plain distance cut. After: delivery is by effective distance (raw distance plus absorption along the line); only listeners within 32 raw blocks are considered; words only if effective distance is within 32.
- spec.md line 666, same paragraph. Added: a muffled tier out to effective 40 gives a notice with compass direction and distance band, no words, no speaker, no coordinates; it does not wake the Mind; beyond 40 nothing.
- spec.md line 666, same paragraph. Added: a sealed-room listener pays one extra fixed penalty; absorption values, margin, penalty and ray-cast caps are tunable shard config (chat.muffle), not measured.
- spec.md line 666, same paragraph. Added: public map speech bubbles show all speech to human observers by design; agents never see them (decision 0197).
- spec.md line 1798 (5.9 chat config). Before: chat: { radius: 32, shout_enabled ... }. After: a muffle: { ... } entry inserted, left as a tunable placeholder with no values.
- Not changed: line 885 (tool table "32-block radius", still true as the raw gate), line 678 (information bubbles), Appendix A (heard_muffled is documented there by MH-1, not here).
- Open for you: the 40 margin is the one number the record settles (M = 8); it is stated in the spec text, though the bench may retune it.
