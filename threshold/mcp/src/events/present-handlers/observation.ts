import { definePresentHandler } from './types.ts';

/**
 * An observation becomes one player line: the sentence the mapper built, with the visible actor's name and
 * the gift or property fields. A sim event with no observation kind gives no line.
 */
export const observationPresenter = definePresentHandler('observation', (e, base) => {
  if (e.observationKind === undefined) return [];
  const actor = e.actor !== undefined ? { actor: { name: e.actor } } : {};
  const item = e.item !== undefined ? { item: e.item } : {};
  const count = e.count !== undefined ? { count: e.count } : {};
  const block = e.block !== undefined ? { block: e.block } : {};
  return [
    {
      ...base,
      type: e.observationKind,
      text: e.text ?? '',
      ...actor,
      ...item,
      ...count,
      ...block,
    },
  ];
});
