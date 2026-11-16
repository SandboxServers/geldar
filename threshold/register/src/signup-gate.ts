/**
 * The sign-up gate (C7-11). Sign-up may open only when the terms version the sign-up records is in this list. The owner
 * adds a version here by committing it; the agent never adds one. An empty list, an unknown version or a version that
 * differs by case or spacing keeps sign-up closed (config.ts forces the kill switch on in that case).
 * Version 1 is approved by the owner on 2026-11-11 (decision 0155).
 */
export const APPROVED_TERMS_VERSIONS: readonly string[] = ['v1'];

/** True only when `version` is exactly one of the approved versions. Anything else (including an empty value) is false. */
export function termsApproved(
  version: string,
  approved: readonly string[] = APPROVED_TERMS_VERSIONS,
): boolean {
  if (typeof version !== 'string' || version === '') return false;
  return approved.some((v) => typeof v === 'string' && v === version);
}
