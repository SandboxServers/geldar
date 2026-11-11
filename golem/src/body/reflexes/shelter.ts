import type { Reflex } from '../reflex.ts';
import { blockedPathReflex } from './blocked-path.ts';
import { panicBurrowReflex } from './panic-burrow.ts';
import { unstickReflex } from './unstick.ts';

/**
 * The reflexes of the shelter and path group, ready to hand to the `ReflexRunner`: the panic burrow
 * (night, no bed, no shelter) and the blocked-path reflex. Both keep their state per view, so one
 * array serves every Body in the process.
 */
export const shelterReflexes: Reflex[] = [panicBurrowReflex, blockedPathReflex, unstickReflex];
