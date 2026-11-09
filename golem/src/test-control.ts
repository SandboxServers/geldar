/** A block position. */
export interface Pos {
  x: number;
  y: number;
  z: number;
}

/** Anything that runs one server command and returns its reply (RconClient, or a fake in tests). */
export interface CommandSource {
  command(cmd: string): Promise<string>;
}

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;
const RESOURCE_ID = /^[a-z0-9_]{1,64}$/;
const RULE_NAME = /^[a-z_]{1,64}$/;
/** One fill command changes at most this many blocks. */
const FILL_LIMIT = 32_768;
const HORIZONTAL_LIMIT = 30_000_000;
const MIN_Y = -64;
const MAX_Y = 320;

/**
 * Test and ops control over server commands. Every method checks its arguments before it builds
 * the command string, because these strings are command injection if a caller ever feeds them
 * text from a model. Bad arguments throw RangeError.
 */
export class TestControl {
  private readonly source: CommandSource;

  constructor(source: CommandSource) {
    this.source = source;
  }

  /** Raw command, for one-offs. Not validated. */
  command(cmd: string): Promise<string> {
    return this.source.command(cmd);
  }

  /** Adds a player to the whitelist. Resolves for "Added" and for "already whitelisted". */
  async whitelistAdd(name: string): Promise<void> {
    const reply = await this.source.command(`whitelist add ${player(name)}`);
    if (!/Added|already whitelisted/i.test(reply)) {
      throw new Error(`whitelist add ${name} got an unexpected reply: ${reply}`);
    }
  }

  whitelistRemove(name: string): Promise<string> {
    return this.source.command(`whitelist remove ${player(name)}`);
  }

  timeSet(value: number | 'day' | 'noon' | 'night' | 'midnight'): Promise<string> {
    const time = typeof value === 'number' ? String(integer(value, 0, 24_000, 'time')) : value;
    return this.source.command(`time set ${time}`);
  }

  give(name: string, item: string, count: number): Promise<string> {
    const cmd = `give ${player(name)} ${resource(item)} ${integer(count, 1, 6400, 'count')}`;
    return this.source.command(cmd);
  }

  clear(name: string): Promise<string> {
    return this.source.command(`clear ${player(name)}`);
  }

  tp(name: string, x: number, y: number, z: number): Promise<string> {
    const at = coords({ x, y, z });
    return this.source.command(`tp ${player(name)} ${at.x} ${at.y} ${at.z}`);
  }

  kill(name: string): Promise<string> {
    return this.source.command(`kill ${player(name)}`);
  }

  effect(name: string, effectId: string, seconds: number, amplifier: number): Promise<string> {
    const cmd = [
      'effect give',
      player(name),
      resource(effectId),
      integer(seconds, 0, 1_000_000, 'seconds'),
      integer(amplifier, 0, 255, 'amplifier'),
    ].join(' ');
    return this.source.command(cmd);
  }

  effectClear(name: string): Promise<string> {
    return this.source.command(`effect clear ${player(name)}`);
  }

  setblock(x: number, y: number, z: number, block: string): Promise<string> {
    const at = coords({ x, y, z });
    return this.source.command(`setblock ${at.x} ${at.y} ${at.z} ${resource(block)}`);
  }

  /**
   * Fills the box between two corners. A box over 32,768 blocks is split into y-slabs, one
   * command each. Resolves with the replies joined by newlines.
   */
  async fill(from: Pos, to: Pos, block: string): Promise<string> {
    const a = coords(from);
    const b = coords(to);
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
    const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
    const layer = (hi.x - lo.x + 1) * (hi.z - lo.z + 1);
    if (layer > FILL_LIMIT) {
      throw new RangeError('fill layer is over 32,768 blocks: split the box in x or z first');
    }
    const id = resource(block);
    const slab = Math.floor(FILL_LIMIT / layer);
    const replies: string[] = [];
    for (let y = lo.y; y <= hi.y; y += slab) {
      const top = Math.min(hi.y, y + slab - 1);
      const cmd = `fill ${lo.x} ${y} ${lo.z} ${hi.x} ${top} ${hi.z} ${id}`;
      replies.push(await this.source.command(cmd));
    }
    return replies.join('\n');
  }

  forceload(x1: number, z1: number, x2: number, z2: number): Promise<string> {
    const cmd = `forceload add ${horizontal(x1)} ${horizontal(z1)} ${horizontal(x2)} ${horizontal(z2)}`;
    return this.source.command(cmd);
  }

  /** With no value this queries the rule; with a value it sets it. */
  gamerule(name: string, value?: boolean | number): Promise<string> {
    if (!RULE_NAME.test(name)) throw new RangeError(`invalid gamerule name '${name}'`);
    let arg = '';
    if (typeof value === 'boolean') arg = ` ${value}`;
    else if (value !== undefined)
      arg = ` ${integer(value, -2_147_483_648, 2_147_483_647, 'value')}`;
    return this.source.command(`gamerule ${name}${arg}`);
  }

  tickRate(n: number): Promise<string> {
    return this.source.command(`tick rate ${integer(n, 1, 10_000, 'tick rate')}`);
  }

  tickQuery(): Promise<string> {
    return this.source.command('tick query');
  }

  version(): Promise<string> {
    return this.source.command('version');
  }

  /** Reads a chest's `Items` and sums the stacks by item name (without `minecraft:`). */
  async chestItems(x: number, y: number, z: number): Promise<Map<string, number>> {
    const at = coords({ x, y, z });
    const reply = await this.source.command(`data get block ${at.x} ${at.y} ${at.z} Items`);
    return parseItems(reply);
  }
}

/** Sums the stacks in a `data get block ... Items` reply. "Found no elements" gives an empty map. */
export function parseItems(reply: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [entry] of reply.matchAll(/\{[^{}]*\}/g)) {
    const id = /\bid:\s*"(?:minecraft:)?([a-z0-9_]+)"/.exec(entry)?.[1];
    const count = /\bcount:\s*(\d+)/.exec(entry)?.[1];
    if (id === undefined || count === undefined) continue;
    totals.set(id, (totals.get(id) ?? 0) + Number(count));
  }
  return totals;
}

function player(name: string): string {
  if (!PLAYER_NAME.test(name)) throw new RangeError(`invalid player name '${name}'`);
  return name;
}

function resource(id: string): string {
  if (!RESOURCE_ID.test(id)) throw new RangeError(`invalid item or block id '${id}'`);
  return id;
}

function horizontal(value: number): number {
  return integer(value, -HORIZONTAL_LIMIT, HORIZONTAL_LIMIT, 'x or z');
}

function coords(pos: Pos): Pos {
  return {
    x: horizontal(pos.x),
    y: integer(pos.y, MIN_Y, MAX_Y, 'y'),
    z: horizontal(pos.z),
  };
}

function integer(value: number, min: number, max: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} must be an integer from ${min} to ${max}, got ${value}`);
  }
  return value;
}
