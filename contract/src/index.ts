/**
 * Public surface of @geldar/contract: the generated types and one typed validator
 * per schema. Each packet fills only its own marked block below.
 */

export { MARKER_WORD, markedWords } from './agent-text.ts';
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
  ProgramBlock,
  ProgramChunk,
  Snapshot,
} from './generated/types.ts';
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
export type { ValidationResult } from './validation.ts';

export * from './core-records.ts';
export * from './perception-events.ts';
export * from './world-tool-inputs.ts';
// --- SC-30a mcp ---
export * from './mcp.ts';

export * from './thinker.ts';
export * from './mind-channel.ts';
export * from './sovereign.ts';
export * from './character.ts';
export * from './proficiency.ts';
export * from './turn-record.ts';
