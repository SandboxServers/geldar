/**
 * The fields of each Phase 0 action verb, as the `Action` union in `contract/schemas/thought.schema.json`
 * states them. In every Phase 0 variant the required fields are exactly the allowed ones, `do` included.
 * The decode schema (`../prompts/decode-schema.ts`) and the corrective focus (`./action-focus.ts`) read
 * this table; `action-shapes.test.ts` checks it against the contract.
 */
export const ACTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  goto: ['do', 'target'],
  mine: ['do', 'block', 'count'],
  craft: ['do', 'item', 'count'],
  place: ['do', 'block', 'at'],
  eat: ['do'],
  sleep: ['do'],
  open: ['do', 'at'],
  deposit: ['do', 'at', 'item', 'count'],
  withdraw: ['do', 'at', 'item', 'count'],
  attack: ['do', 'target'],
  wait: ['do', 'seconds'],
  unstick: ['do'],
  give: ['do', 'to', 'item', 'count'],
  note: ['do', 'text'],
};
