/**
 * The Minecraft Java gate for NEW sign-ups (REGISTER_REQUIRE_MC_OWNERSHIP). Existing owners never reach it, and
 * admins hold an owner row, so they never reach it either. Every outcome that is not a pass is a refusal: a missing
 * check, a throw, or a record that did not land. Logs carry the outcome and the failure code only.
 */
import { FAILURE_MESSAGES, type OwnershipResult } from './mc-ownership.ts';
import type { Store } from './store.ts';

/** Runs the Xbox and Mojang chain once for the access token held in this closure. */
export type OwnershipCheck = () => Promise<OwnershipResult>;

/** A sign-up the check did not admit: a failure or a Bedrock-only account. */
export type OwnershipRefusal = Extract<OwnershipResult, { status: 'failed' | 'not_owned' }>;

/** The refusal for any check that could not give an answer, and for an answer that could not be stored. */
export const UNRECORDED_REFUSAL: OwnershipRefusal = {
  status: 'failed',
  code: 'unknown',
  message: FAILURE_MESSAGES.unknown,
};
const UNKNOWN: OwnershipRefusal = UNRECORDED_REFUSAL;

/** The verdict for one sign-up. No check or a throwing check is a failure, so nothing is admitted without an answer. */
export async function decideOwnership(
  verify: OwnershipCheck | undefined,
  provider: string,
  log: (line: string) => void,
): Promise<OwnershipResult> {
  let result: OwnershipResult;
  try {
    result = verify ? await verify() : UNKNOWN;
  } catch {
    result = UNKNOWN;
  }
  const code = result.status === 'failed' ? ` code=${result.code}` : '';
  log(`sign-up ownership outcome=${result.status}${code} provider=${provider}`);
  return result;
}

export function isRefusal(result: OwnershipResult): result is OwnershipRefusal {
  return result.status === 'failed' || result.status === 'not_owned';
}

/**
 * Records the one-time answer for the new account. A false or a throw removes the account, so the next sign-in
 * cannot skip the check. If the removal fails too, that is logged (the account then needs an operator).
 */
export async function recordOwnership(
  store: Store,
  identityHash: string,
  log: (line: string) => void,
): Promise<boolean> {
  try {
    if (store.recordMcOwnership && (await store.recordMcOwnership(identityHash, true))) return true;
  } catch {
    log('sign-up ownership record threw');
  }
  log('sign-up ownership record not stored; undoing the sign-up');
  try {
    if (!store.eraseAccount || !(await store.eraseAccount(identityHash)))
      log('sign-up undo did not remove the account');
  } catch {
    log('sign-up undo threw');
  }
  return false;
}
