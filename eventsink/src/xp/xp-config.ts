// Interface scaffold from AN-S0. Owned by AN-10a; replace the body, keep the exported signatures unless the card owner records a change in the worknote.
// Placement: the card's deliver block lists these two under ledger.ts, but its may-edit line names this file. Scaffolded here; see the worknote conflict list.

export function xpEnabled(env: NodeJS.ProcessEnv): boolean {
  throw new Error('AN-10a not implemented');
}

export function xpThresholds(env: NodeJS.ProcessEnv): readonly [number, number, number] {
  throw new Error('AN-10a not implemented');
}
