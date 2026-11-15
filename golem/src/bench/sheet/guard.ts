/**
 * Scratch guard for the sheet driver step 0. The driver may only touch a throwaway shard whose name and
 * compose project both start with `scratch-`. The live shard names are refused by name as well, so a
 * typo that drops the prefix cannot reach a live stack.
 */
export const SCRATCH_PREFIX = 'scratch-';
const SCRATCH_NAME = /^scratch-[a-z0-9][a-z0-9-]{0,39}$/;
/** Live shard and project names, refused even if they matched the pattern. */
export const LIVE_NAMES: readonly string[] = ['geldar', 'geldar-colo', 'geldar-phase0', 'geldar-93'];

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
  if (LIVE_NAMES.includes(shard) || LIVE_NAMES.includes(project)) {
    return { ok: false, reason: 'refusing: a live shard or project name' };
  }
  return { ok: true, reason: `ok: scratch shard '${shard}', compose project '${project}'` };
}
