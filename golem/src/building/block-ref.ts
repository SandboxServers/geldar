// A block reference as a plan writes it: a block name, then the state properties in brackets
// (`oak_stairs[facing=north,half=bottom]`). The cell executor compares a live block with the name
// and each listed property (BLD-38b2), so a stateful target is not matched by its bare name alone.

import type { Cardinal, PlaceState } from '../actions/place-state.ts';

/** A block name and the state properties the reference lists (none for a bare name). */
export interface BlockRef {
  name: string;
  props: Record<string, string>;
}

const REFERENCE = /^([a-z0-9_]+)(?:\[([^\]]*)\])?$/;
const PAIR = /^([a-z_]+)=([a-z0-9_]+)$/;

/** Parses `name` or `name[key=value,key=value]`. Throws `not a block reference` for anything else. */
export function parseBlockRef(text: string): BlockRef {
  const match = REFERENCE.exec(text);
  if (match === null || match[2] === '') throw new Error(`not a block reference: ${text}`);
  const props: Record<string, string> = {};
  if (match[2] !== undefined) {
    for (const pair of match[2].split(',')) {
      const parts = PAIR.exec(pair);
      if (parts === null) throw new Error(`not a block reference: ${text}`);
      props[parts[1] as string] = parts[2] as string;
    }
  }
  return { name: match[1] as string, props };
}

/** The reference in one spelling: the name, then the properties sorted by key. */
export function canonicalBlockRef(ref: BlockRef): string {
  const keys = Object.keys(ref.props).sort();
  if (keys.length === 0) return ref.name;
  return `${ref.name}[${keys.map((key) => `${key}=${ref.props[key]}`).join(',')}]`;
}

/** True when the live block holds every property the reference lists. `null` is a block with no read. */
export function propsHold(
  live: Record<string, string> | null,
  want: Record<string, string>,
): boolean {
  const keys = Object.keys(want);
  if (keys.length === 0) return true;
  if (live === null) return false;
  return keys.every((key) => live[key] === want[key]);
}

/** The block state the place action is asked for: the axis, facing and half the reference lists. Undefined when none. */
export function placeStateOf(ref: BlockRef): PlaceState | undefined {
  const { axis, facing, half } = ref.props;
  if (axis === undefined && facing === undefined && half === undefined) return undefined;
  const state: PlaceState = {};
  if (axis !== undefined) state.axis = axis as NonNullable<PlaceState['axis']>;
  if (facing !== undefined) state.facing = facing as Cardinal;
  if (half !== undefined) state.half = half as NonNullable<PlaceState['half']>;
  return state;
}
