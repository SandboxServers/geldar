# BLD-10 worknotes

- Branch `phase1/bld-10-scaffold` from `building/integration` (eedba681). The packet named `phase1/bld-10-scaffold-hazards`; the brief's branch name is used.
- BLD-04 and BLD-09 are not merged on `building/integration` (`standFor` and the plan library are still stubs). `scaffoldFor` takes the stand answer as an input (`stand: Cell | 'none'`), so it does not import the solver.
- `scaffold.ts`: no stand gives a pillar up the agent's own column (feet rise to the target's level) or a bridge across the non-solid floor cells between agent and target. The agent's cheapest held block is used (`CHEAP_FIRST` order). Too few blocks gives `missing_materials` and places nothing. Scaffold cells that sit on a plan cell are listed in `remove`.
- `hazards.ts`: `hazardAt` reports falling blocks (in or contiguous above the cell), lava or source water on the six faces, and a retaining block when fluid touches and one is held. It has no refusal variant. `orderCells` puts falling cells bottom-up to place and top-down to break; other cells keep their slots.
- `digSafetyRefusal` is not imported.
- `index.test.ts`: `scaffoldFor` and `hazardAt` removed from the BLD-S3a stub list, because they are now implemented.
