import type { TestControl } from '../test-control.ts';

/** The only `ctl` methods a scenario may call while it runs. */
const RUN_PHASE_CONTROL = new Set(['effect', 'effectClear', 'timeSet', 'fill', 'chestItems']);

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;
const BLOCK_ID = /^[a-z0-9_:]{1,64}$/;
const HORIZONTAL_LIMIT = 30_000_000;
const MIN_Y = -64;
const MAX_Y = 320;

/** Server-side reads a scenario may make while it runs. Both are strictly read-only. */
export interface RunReads {
  /** True when the block at the position is `block` (`execute if block`). */
  blockIs(x: number, y: number, z: number, block: string): Promise<boolean>;
  /** True when the online player is asleep (`data get entity <name> sleeping_pos`). */
  isSleeping(name: string): Promise<boolean>;
}

/** What a scenario's `run` sees as `ctl`: the allowed control methods plus the read-only queries. */
export type RunControl = TestControl & RunReads;

function coordinate(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

async function blockIs(
  ctl: TestControl,
  x: number,
  y: number,
  z: number,
  block: string,
): Promise<boolean> {
  const at = [
    coordinate(x, -HORIZONTAL_LIMIT, HORIZONTAL_LIMIT, 'x'),
    coordinate(y, MIN_Y, MAX_Y, 'y'),
    coordinate(z, -HORIZONTAL_LIMIT, HORIZONTAL_LIMIT, 'z'),
  ];
  if (typeof block !== 'string' || !BLOCK_ID.test(block)) {
    throw new RangeError('block must match [a-z0-9_:]{1,64}');
  }
  const reply = (await ctl.command(`execute if block ${at.join(' ')} ${block}`)).trim();
  if (/^Test passed$/.test(reply)) return true;
  if (/^Test failed$/.test(reply)) return false;
  throw new Error(`execute if block got an unexpected reply: ${reply}`);
}

async function isSleeping(ctl: TestControl, name: string): Promise<boolean> {
  if (typeof name !== 'string' || !PLAYER_NAME.test(name)) {
    throw new RangeError('name must be a Minecraft username');
  }
  const reply = (await ctl.command(`data get entity ${name} sleeping_pos`)).trim();
  // A sleeping player has the tag; an awake one answers that the tag does not exist.
  // The name lookup ignores case and the reply echoes the server's display name, which a team can decorate.
  const asleep = new RegExp(`^.*\\b${name}\\b[^:]* has the following entity data: \\[.*\\]$`, 'i');
  if (asleep.test(reply)) return true;
  if (reply === 'Found no elements matching sleeping_pos') return false;
  throw new Error(`data get entity sleeping_pos got an unexpected reply: ${reply}`);
}

/**
 * A view of `ctl` for a scenario's `run`: effect, effectClear, timeSet, fill, chestItems and
 * gamerule queries (no value), plus the read-only `blockIs` and `isSleeping`. Anything else
 * throws, so a scenario cannot give itself items.
 */
export function limitedControl(ctl: TestControl): RunControl {
  return new Proxy(ctl, {
    get(target, prop, receiver) {
      if (prop === 'gamerule') {
        return (name: string, value?: boolean | number) => {
          if (value !== undefined)
            throw new Error('ctl.gamerule can only query while a scenario runs');
          return target.gamerule(name);
        };
      }
      if (prop === 'blockIs') {
        return (x: number, y: number, z: number, block: string) => blockIs(target, x, y, z, block);
      }
      if (prop === 'isSleeping') return (name: string) => isSleeping(target, name);
      if (typeof prop === 'string' && !RUN_PHASE_CONTROL.has(prop)) {
        throw new Error(`ctl.${prop} is not available while a scenario runs`);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as RunControl;
}
