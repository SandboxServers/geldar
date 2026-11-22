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
  write_sign: ['do', 'text'],
  till: ['do', 'at'],
  edit_sign: ['do', 'at', 'text'],
  use: ['do', 'item', 'at', 'entity'],
  break: ['do', 'at'],
  plan: ['do', 'op', 'plan_id', 'palette', 'steps', 'origin', 'order', 'final', 'seq'],
};

/**
 * The fields of `ACTION_FIELDS` a verb may leave out. Every other allowed field is required. `use`
 * (decision 0218) takes an optional item, and a block position or an entity; the Body refuses both
 * a position and an entity together, not the schema.
 */
export const ACTION_OPTIONAL: Readonly<Record<string, readonly string[]>> = {
  use: ['item', 'at', 'entity'],
  plan: ['origin', 'order', 'final', 'seq'],
};
