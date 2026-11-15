/**
 * Scratch guard for the sheet driver step 0. The driver may only touch a throwaway shard whose name and
 * compose project both start with `scratch-`, and whose whole name is at most 32 characters.
 */
export const SCRATCH_PREFIX = 'scratch-';
/** `scratch-` then 1 to 24 lower-case letters, digits or hyphens: 32 characters at most in all. */
const SCRATCH_NAME = /^scratch-[a-z0-9][a-z0-9-]{0,23}$/;

export interface GuardVerdict {
  ok: boolean;
  reason: string;
}

/** Accepts only a scratch shard id and a scratch compose project name. Pure; never throws. */
export function checkScratch(shard: string, project: string): GuardVerdict {
  if (!SCRATCH_NAME.test(shard)) {
    return { ok: false, reason: `refusing: shard '${shard}' must be ${SCRATCH_PREFIX}<name>` };
  }
  if (!SCRATCH_NAME.test(project)) {
    return {
      ok: false,
      reason: `refusing: compose project '${project}' must be ${SCRATCH_PREFIX}<name>`,
    };
  }
  return { ok: true, reason: `ok: scratch shard '${shard}', compose project '${project}'` };
}
