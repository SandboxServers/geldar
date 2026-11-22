# BLD-07 worknote

- `REPLACEABLE` in `golem/src/actions/place.ts` now holds flowers, dead bush, vines, seagrass, glow lichen, short and tall plants, mushrooms and snow. Lava and solid blocks are not in it.
- `golem/src/actions/place-footprint.ts`: `footprintOf` (single, up for doors and tall plants, bed) and `upperCell`.
- Two-cell items: the cell above must be replaceable before the send; success needs both halves confirmed. A second pass where both halves already read as the block returns `completed` with `already: true` and sends nothing.
- Not verified live: the drop-pickup loop when a plant is replaced (no pickup code is involved in `place`; a live probe would be needed).
