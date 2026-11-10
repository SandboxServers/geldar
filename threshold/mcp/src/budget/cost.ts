/**
 * What each sovereign tool charges (spec 5.15.3, "Budget and fairness"): each action inside `act`,
 * each `say` and each intent costs one credit; `wait`, `look`, `read_book` and `status` are free.
 * Every state-changing tool costs the same whichever door it arrives through, so there is no side
 * door around the budget.
 */

/** The kinds of item a plan can carry. Each one costs `CREDITS_PER_ITEM`. */
export type ChargedItem = 'say' | 'action' | 'intent';

/** The credits one accepted item costs. */
export const CREDITS_PER_ITEM = 1;

/** The credits one accepted item of this kind costs. */
export function itemCost(_kind: ChargedItem): number {
  return CREDITS_PER_ITEM;
}

/** The credits a batch of accepted items costs: the sum of their costs. */
export function batchCost(kinds: readonly ChargedItem[]): number {
  return kinds.reduce((sum, kind) => sum + itemCost(kind), 0);
}

/** The tools that change the world and so cost credits. Every other tool is free. */
const CHARGED_TOOLS = new Set([
  'act',
  'say',
  'use_skill',
  'offer',
  'write_book',
  'define_skill',
  'propose',
  'vote',
]);

/** True for the tools whose accepted items are charged; `wait`, `look`, `read_book` and `status` are not. */
export function toolCharges(tool: string): boolean {
  return CHARGED_TOOLS.has(tool);
}
