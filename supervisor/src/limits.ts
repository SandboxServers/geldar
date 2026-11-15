// The Body (golem-body) budget in compose/colo.yml (decision 0082): 1 CPU, 2048m, swap equal to
// memory so a body cannot swap past its limit, and 256 pids (compose's pids_limit). The supervisor holds no
// container config: these numbers are the reference the tests check against the compose file.
const MIB = 1024 * 1024;
export const BODY_NANO_CPUS = 1_000_000_000;
export const BODY_MEMORY_BYTES = 2048 * MIB;
export const BODY_PIDS_LIMIT = 256;
