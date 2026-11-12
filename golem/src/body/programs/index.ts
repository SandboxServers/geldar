import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { ProgramRegistry } from '../program.ts';
import { ProgramError } from './args.ts';
import { BuildProgram } from './build.ts';
import { CraftProgram } from './craft.ts';
import { FleeProgram } from './flee.ts';
import { FollowProgram } from './follow.ts';
import { GatherProgram } from './gather.ts';
import { RestProgram } from './rest.ts';
import { TravelProgram } from './travel.ts';

export { ProgramError, type ProgramErrorReason } from './args.ts';
export { CraftProgram, FleeProgram, FollowProgram, GatherProgram, RestProgram, TravelProgram };

/** Programs in the contract's `program` list that the Body does not run in Phase 0. */
export const UNSUPPORTED_PROGRAMS = ['trade_wait'] as const;

/** A program the Body does not run: `start` and `resume` throw `ProgramError('unsupported')`. */
class UnsupportedProgram implements IntentProgram {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async start(_args: Intent['arguments'], _ctx: ProgramContext): Promise<void> {
    throw new ProgramError('unsupported', this.name, 'is not available in Phase 0');
  }

  async step(_ctx: ProgramContext): Promise<StepResult> {
    return { status: 'failed', message: `unsupported: ${this.name} is not available in Phase 0` };
  }

  checkpoint(): ProgramCheckpoint | null {
    return null;
  }

  async resume(_saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    throw new ProgramError('unsupported', this.name, 'is not available in Phase 0');
  }
}

/**
 * A registry with the six built-in programs, plus `build` and `trade_wait` which
 * refuse with `unsupported`. Skills register themselves later under their own names.
 */
export function createProgramRegistry(): ProgramRegistry {
  const registry = new ProgramRegistry();
  registry.register('travel', () => new TravelProgram());
  registry.register('gather', () => new GatherProgram());
  registry.register('craft', () => new CraftProgram());
  registry.register('build', () => new BuildProgram());
  registry.register('rest', () => new RestProgram());
  registry.register('flee', () => new FleeProgram());
  registry.register('follow', () => new FollowProgram());
  for (const name of UNSUPPORTED_PROGRAMS)
    registry.register(name, () => new UnsupportedProgram(name));
  return registry;
}
