# BLD-09 worknotes: standing-position solver

- `standFor(batch, world, from?)` in `golem/src/building/stand.ts` returns a stand `Cell` or `'none'`.
- Candidates: a 9 x 9 x 9 search box around the first target (reach bounds it). A candidate needs solid
  non-liquid floor, two empty non-liquid body cells, no sand, red sand, gravel or concrete powder
  directly overhead, no batch cell among its floor or body cells, and reach 4.5 plus a clear sight
  ray from the eye to every target.
- Sight: sampled every 0.05 block; a solid block or an unloaded cell blocks the ray.
- Fewest moves: Manhattan distance from `from` (default: the first target); ties go to lower y, x, z.
- Added beyond the spec text: the floor and the head cell must not be batch cells (the body stands on
  the floor, and the plan may break it).
- `index.test.ts` STUBS list: `standFor` removed, since it is no longer a stub.
