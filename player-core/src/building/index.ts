/** The pure building library (BLD-04): plan expansion, shape helpers, ordering and tallies. */
export {
  type ExpandCursor,
  expandPlan,
  type PlanCell,
  type PlanSpec,
  type PlanStep,
} from './expand.ts';
export {
  boxCells,
  type Cell,
  circleCells,
  lineCells,
  sphereCells,
  wallCells,
} from './geometry.ts';
export { type CellOrder, type OrderCell, orderCells, orderPlanCells } from './order.ts';
export { type MaterialCounts, tallyMaterials } from './tally.ts';
