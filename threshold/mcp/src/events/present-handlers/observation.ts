import { definePresentHandler } from './types.ts';

/**
 * An observation becomes one player line: the sentence the mapper built, with the visible actor's name and
 * the gift or property fields. A sim event with no observation kind gives no line.
 */
export const observationPresenter = definePresentHandler('observation', (e, base) => {
  if (e.observationKind === undefined) return [];
  // The fight and take sentences are actor-free (decision 0391): no name rides on those lines.
  const anonymous = e.observationKind === 'fight_seen' || e.observationKind === 'container_taken';
  const actor = e.actor !== undefined && !anonymous ? { actor: { name: e.actor } } : {};
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
