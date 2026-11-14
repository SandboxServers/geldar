import type { ContainerConfig } from './ports.ts';

// The Body (golem-body) budget in compose/colo.yml (decision 0082): 1 CPU, 2048m, swap equal to
// memory so a body cannot swap past its limit, and 256 pids (compose's pids_limit). C7-03b wires the real
// Docker client to this config.
const MIB = 1024 * 1024;
export const BODY_NANO_CPUS = 1_000_000_000;
export const BODY_MEMORY_BYTES = 2048 * MIB;
export const BODY_PIDS_LIMIT = 256;

export function bodyContainerConfig(): ContainerConfig {
  return {
    NanoCpus: BODY_NANO_CPUS,
    Memory: BODY_MEMORY_BYTES,
    MemorySwap: BODY_MEMORY_BYTES,
    PidsLimit: BODY_PIDS_LIMIT,
  };
}
