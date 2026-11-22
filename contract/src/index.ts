/**
 * Public surface of @geldar/contract: the generated types and one typed validator
 * per schema. Re-exports each domain file; a card adds its exports to its own domain
 * file (or a new domain file) and adds at most one `export * from` line here.
 */

export { MARKER_WORD, markedWords } from './agent-text.ts';
export * from './character.ts';
export * from './core-records.ts';
export type {
  ExploreArguments,
  ExploreCheckpoint,
  ExploreDetail,
  FarmArguments,
  FarmCell,
  FarmCheckpoint,
  FarmDetail,
  MaintenanceNotice,
  PatrolArguments,
  PatrolCheckpoint,
  PatrolDetail,
  PlanProgressPayload,
  ProgramBlock,
  ProgramChunk,
  Snapshot,
} from './generated/types.ts';
export { validatePlanProgressPayload } from './generated/validators.js';
export * from './mcp.ts';
export * from './mind-channel.ts';
export * from './perception-events.ts';
export * from './proficiency.ts';
export {
  validateExploreArguments,
  validateExploreCheckpoint,
  validateExploreDetail,
  validateFarmArguments,
  validateFarmCheckpoint,
  validateFarmDetail,
  validatePatrolArguments,
  validatePatrolCheckpoint,
  validatePatrolDetail,
} from './programs.ts';
export * from './sovereign.ts';
export * from './thinker.ts';
export * from './turn-record.ts';
export type { ValidationResult } from './validation.ts';
export * from './world-tool-inputs.ts';
