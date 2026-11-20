// CAP-4: the pure part of the anvil rename check. prismarine-item (pinned in golem) exposes `customName` as the raw value of the
// `custom_name` component (item-components era, `componentMap.get('custom_name').data`) or, before that, as `nbt.value.display.value.Name.value`.
// That value is an NBT tag, a JSON text component or a plain string, depending on the server version, so every shape is read
// here. The shard's shape is UNPROVEN until a run prints it: a failed check prints the slot dump with the raw value.
// The fixtures in capture-anvil.test.ts are hand-built to these shapes (no server).

/** The fields of a prismarine-item item this check reads. Items from the bot fit it structurally. */
export interface ItemLike {
  name?: string;
  count?: number;
  customName?: unknown;
  nbt?: unknown;
}

/** The text of an NBT string tag, a JSON text component or a plain string; null when there is no text. */
export function textOf(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
      try {
        return textOf(JSON.parse(trimmed), depth + 1) ?? value;
      } catch {
        return value;
      }
    }
    return value;
  }
  if (typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if ('value' in o) return textOf(o.value, depth + 1);
  if ('text' in o) {
    const own = textOf(o.text, depth + 1) ?? '';
    const extra = Array.isArray(o.extra)
      ? o.extra.map((part) => textOf(part, depth + 1) ?? '').join('')
      : '';
    return own + extra;
  }
  return null;
}

/** The custom name of an item, whatever shape the item carries it in; null when it has none. */
export function customNameOf(item: ItemLike): string | null {
  const fromGetter = textOf(item.customName);
  if (fromGetter !== null) return fromGetter;
  const legacy = (
    item.nbt as { value?: { display?: { value?: { Name?: unknown } } } } | null | undefined
  )?.value?.display?.value?.Name;
  return textOf(legacy);
}

/** The first item that is a stick whose custom name is exactly `name` (not a substring), or undefined. */
export function findRenamedStick(items: ReadonlyArray<ItemLike | null | undefined>, name: string) {
  return items.find(
    (item): item is ItemLike =>
      item != null && item.name === 'stick' && customNameOf(item) === name,
  );
}

function rawText(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ??
      'undefined'
    );
  } catch {
    return String(value);
  }
}

/** One line per slot: the item's name, count, read custom name and the raw custom name value (the shape proof). */
export function dumpSlots(
  label: string,
  items: ReadonlyArray<ItemLike | null | undefined>,
): string[] {
  const lines = [`${label}: ${items.length} slots`];
  items.forEach((item, i) => {
    if (item == null) return;
    lines.push(
      `  slot ${i}: ${item.name ?? '?'} x${item.count ?? '?'} customName=${JSON.stringify(customNameOf(item))} raw=${rawText(item.customName)}`,
    );
  });
  return lines;
}
