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

/** The slots of a single chest, read one by one when the server folds the whole reply. */
const CHEST_SLOTS = 27;
/** A Minecraft username. */
export const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;
const RESOURCE_ID = /^[a-z0-9_]{1,64}$/;
const RULE_NAME = /^[a-z_]{1,64}$/;
/** One fill command changes at most this many blocks. */
const FILL_LIMIT = 32_768;
/** The world border's horizontal limit in blocks. */
export const HORIZONTAL_LIMIT = 30_000_000;
/** The lowest and highest block y of the overworld (a 384-block height). */
export const MIN_Y = -64;
export const MAX_Y = 319;

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

  /** Removes a player from the whitelist. Resolves with the server's reply. */
  whitelistRemove(name: string): Promise<string> {
    return this.source.command(`whitelist remove ${player(name)}`);
  }

  /** Sets the time of day: a tick count from 0 to 24,000, or a named time. */
  timeSet(value: number | 'day' | 'noon' | 'night' | 'midnight'): Promise<string> {
    const time = typeof value === 'number' ? String(integer(value, 0, 24_000, 'time')) : value;
    return this.source.command(`time set ${time}`);
  }

  /** Gives a player `count` of an item (1 to 6400). */
  give(name: string, item: string, count: number): Promise<string> {
    const cmd = `give ${player(name)} ${resource(item)} ${integer(count, 1, 6400, 'count')}`;
    return this.source.command(cmd);
  }

  /** Unlocks every recipe for a player. Test setup only; recipes otherwise unlock through play (decision 0048). */
  recipeGive(name: string): Promise<string> {
    return this.source.command(`recipe give ${player(name)} *`);
  }

  /** Takes every recipe back from a player's recipe book. */
  recipeTake(name: string): Promise<string> {
    return this.source.command(`recipe take ${player(name)} *`);
  }

  /** Revokes the player's recipe advancements, so vanilla unlocking can fire again. */
  advancementRevokeRecipes(name: string): Promise<string> {
    return this.source.command(`advancement revoke ${player(name)} from minecraft:recipes/root`);
  }

  /**
   * Puts a player back to a recipe book with nothing unlocked. Both steps are needed: `recipe take`
   * alone leaves the advancement progress earned, and then pickups unlock nothing (recipe unlock diagnosis).
   * Resolves with the two replies joined by a newline.
   */
  async recipeReset(name: string): Promise<string> {
    const revoked = await this.advancementRevokeRecipes(name);
    const taken = await this.recipeTake(name);
    return `${revoked}\n${taken}`;
  }

  /** Clears a player's inventory. */
  clear(name: string): Promise<string> {
    return this.source.command(`clear ${player(name)}`);
  }

  /** Teleports a player to a block position. */
  tp(name: string, x: number, y: number, z: number): Promise<string> {
    const at = coords({ x, y, z });
    return this.source.command(`tp ${player(name)} ${at.x} ${at.y} ${at.z}`);
  }

  /** Kills a player. */
  kill(name: string): Promise<string> {
    return this.source.command(`kill ${player(name)}`);
  }

  /** Gives a player a status effect for `seconds` at `amplifier` (0 to 255). */
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

  /** Removes all status effects from a player. */
  effectClear(name: string): Promise<string> {
    return this.source.command(`effect clear ${player(name)}`);
  }

  /** Places one block. */
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

  /** Force-loads the chunks under a horizontal box, so they stay loaded without a player near. */
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

  /** Sets the target tick rate (1 to 10,000 ticks per second). */
  tickRate(n: number): Promise<string> {
    return this.source.command(`tick rate ${integer(n, 1, 10_000, 'tick rate')}`);
  }

  /** Reads the server's tick status as the server prints it. */
  tickQuery(): Promise<string> {
    return this.source.command('tick query');
  }

  /** Reads the server version line. */
  version(): Promise<string> {
    return this.source.command('version');
  }

  /**
   * Reads a chest's `Items` and sums the stacks by item name (without `minecraft:`). The server
   * folds a long reply to `...` (many stacks, or a stack with components), so then each of the 27
   * slots of a single chest is read on its own, as `id` and `count`.
   */
  async chestItems(x: number, y: number, z: number): Promise<Map<string, number>> {
    const at = coords({ x, y, z });
    const base = `data get block ${at.x} ${at.y} ${at.z}`;
    const reply = await this.source.command(`${base} Items`);
    if (!reply.includes('...')) return parseItems(reply);
    const totals = new Map<string, number>();
    for (let slot = 0; slot < CHEST_SLOTS; slot++) {
      const path = `Items[{Slot:${slot}b}]`;
      const id = await this.source.command(`${base} ${path}.id`);
      if (id.includes('Found no elements')) continue;
      const count = await this.source.command(`${base} ${path}.count`);
      const entry = `{id: ${dataValue(id)}, count: ${dataValue(count)}}`;
      const one = parseItems(`has the following block data: [${entry}]`);
      for (const [name, n] of one) totals.set(name, (totals.get(name) ?? 0) + n);
    }
    return totals;
  }
}

/**
 * Sums the stacks in a `data get block ... Items` reply. "Found no elements" and an empty list
 * give an empty map. Any other reply (an unloaded chunk, a block with no block entity) throws,
 * so a broken setup cannot read as an empty chest.
 */
export function parseItems(reply: string): Map<string, number> {
  const totals = new Map<string, number>();
  if (reply.includes('Found no elements')) return totals;
  if (!reply.includes('has the following block data')) {
    throw new Error(`chest read failed: ${reply}`);
  }
  for (const entry of topLevelEntries(reply)) {
    const id = /\bid:\s*"(?:minecraft:)?([a-z0-9_]+)"/.exec(entry)?.[1];
    const count = /\bcount:\s*(\d+)/.exec(entry)?.[1];
    if (id === undefined || count === undefined) {
      throw new Error(`chest entry has no id or count: ${entry}`);
    }
    totals.set(id, (totals.get(id) ?? 0) + Number(count));
  }
  return totals;
}

/**
 * The `{...}` stack entries of a reply, with the text nested inside each entry (a `components`
 * compound, a list) blanked out. So `count` and `id` are read from the entry's own fields only.
 * Quoted strings are skipped, so a brace inside a name does not change the depth.
 */
function topLevelEntries(reply: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let entry = '';
  for (const ch of reply) {
    if (depth === 0) {
      if (ch === '{') {
        depth = 1;
        entry = '';
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
    if (depth === 0) {
      entries.push(entry);
    } else {
      entry += depth === 1 ? ch : ' ';
    }
  }
  // The server folds a long reply to `...`, which leaves an entry open: later stacks are lost.
  if (depth > 0) throw new Error(`chest reply is truncated: ${reply}`);
  return entries;
}

/** The value in a `data get` reply: the text after `has the following block data: `. */
function dataValue(reply: string): string {
  const marker = 'has the following block data:';
  const at = reply.indexOf(marker);
  if (at < 0) throw new Error(`chest read failed: ${reply}`);
  return reply.slice(at + marker.length).trim();
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
