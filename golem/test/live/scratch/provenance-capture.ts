#!/usr/bin/env node
// CAP-2: scratch-shard test tooling for the provenance capture. Runs one case at a time with two life-id bots,
// starts tools/capture nats-capture and waits for READY, performs the case, settles, stops the subscriber, then
// validates <out>/<case>/ with validate-captures. Run it on the phase0 scratch shard only, with the shard used
// exclusively. Never run it against a live or Colo shard (principle 1). Plan and flags: `--list`, `--dry-run`, and
// docs/runbooks/capture-real-payloads.md "OPS RUN SHEET". The pure parts are in capture-cases.ts (unit-tested);
// this file talks to a server and is NOT tested (no server in CAP-2). Not matched by the live lane (a .ts script,
// not *.live.test.ts) nor by the unit lane (not *.test.ts).
// Run: node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case <name|all>
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockownerQuerySubject } from '@geldar/contract';
import { connectNats } from '@geldar/contract/nats';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { bukkitWorldOf, OWNER_REQUEST_TIMEOUT_MS } from '../../../src/body/block-owners.ts';
import { type LiveContext, withLiveBot } from '../fixture.ts';
import {
  BOT_A,
  BOT_B,
  type CaptureCase,
  parseRunArgs,
  refuseShard,
  renderList,
  renderPlan,
  SLOT_A,
  SLOT_B,
} from './capture-cases.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NATS_CAPTURE = join(REPO_ROOT, 'tools/capture/src/nats-capture.ts');
const VALIDATE = join(REPO_ROOT, 'tools/capture/src/validate-captures.ts');
const READY_TIMEOUT_MS = 30_000;
const SETTLE_TICKS = 400;
/** The Body's owner-query window (AN-27a, runbook): the break must come within 30 s of the owner query. */
const OWNER_WINDOW_MS = 30_000;
/** How long a window or an enchant reply may take before the case fails instead of hanging. */
const OPEN_TIMEOUT_MS = 10_000;

/** The bots of one case: `b` only for the two-life cases. `natsUrl` and `shard` are for the owner query. */
interface Scene {
  a: LiveContext;
  b?: LiveContext;
  natsUrl: string;
  shard: string;
}

type Block = NonNullable<ReturnType<Bot['blockAt']>>;
type OpenWindow = NonNullable<Bot['currentWindow']>;
type Slot = OpenWindow['slots'][number];
/** Plugin methods mineflayer adds at runtime (lib/plugins/anvil.js, enchantment_table.js); typed here by hand. */
interface AnvilWindow extends OpenWindow {
  rename(item: unknown, name: string): Promise<void>;
}
interface EnchantWindow extends OpenWindow {
  enchant(choice: number): Promise<unknown>;
}
interface PluginBot {
  openAnvil(block: Block): Promise<AnvilWindow>;
  openEnchantmentTable(block: Block): Promise<EnchantWindow>;
}

/** Starts nats-capture and resolves when it prints READY; rejects if it exits or stays silent. */
function startSubscriber(url: string, subjects: string, out: string): Promise<ChildProcess> {
  return new Promise((ok, fail) => {
    const child = spawn(
      process.execPath,
      [NATS_CAPTURE, '--url', url, '--subjects', subjects, '--out', out],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const timer = setTimeout(
      () => fail(new Error('subscriber did not print READY')),
      READY_TIMEOUT_MS,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('READY')) {
        clearTimeout(timer);
        ok(child);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`subscriber exited (${String(code)}) before READY`));
    });
  });
}

/** Stops the subscriber and waits for it to exit (on Windows `kill` terminates the process; see the worknote). */
function stopSubscriber(child: ChildProcess): Promise<void> {
  return new Promise((ok) => {
    child.once('exit', () => ok());
    child.kill();
  });
}

/** Runs the validator on one case folder; its table goes to stdout. Returns the exit code (0 pass, 1 fail). */
function validateFolder(dir: string, expect: string): Promise<number> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [VALIDATE, dir, '--expect', expect], {
      stdio: 'inherit',
    });
    child.once('error', fail);
    child.once('exit', (code) => ok(code ?? 2));
  });
}

/** Takes the item named `name` out of the bot's inventory; throws when the bot has none. */
function heldItem(bot: Bot, name: string) {
  const item = bot.inventory.items().find((i) => i.name === name);
  if (item === undefined) throw new Error(`bot holds no ${name}`);
  return item;
}

/** Summons a helmeted zombie (test setup only, the same carve-out as reflex-combat's summonZombie). */
async function summonZombie(s: Scene, x: number, z: number): Promise<void> {
  await s.a.ctl.command(
    `summon zombie ${x} 200 ${z} {equipment:{head:{id:"minecraft:iron_helmet",count:1}}}`,
  );
}

/** Hits the nearest zombie until it is gone, or throws after 600 ticks. */
async function fightZombie(bot: Bot): Promise<void> {
  for (let i = 0; i < 600; i++) {
    const zombie = bot.nearestEntity((e) => e.name === 'zombie');
    if (zombie === null) return;
    bot.attack(zombie);
    await bot.waitForTicks(10);
  }
  throw new Error('zombie did not die in 600 ticks');
}

/** A chest-like container at the arena's row, with stacks set by data merge; then the bot opens and clicks it. */
async function takeFromBlock(
  s: Scene,
  block: string,
  x: number,
  items: string,
  click: [slot: number, button: number, mode: number],
): Promise<void> {
  const { bot, ctl } = s.a;
  await ctl.setblock(x, 200, s.a.arena.center.z, block);
  await ctl.command(`data merge block ${x} 200 ${s.a.arena.center.z} {${items}}`);
  await bot.waitForTicks(10);
  const target = bot.blockAt(new Vec3(x, 200, s.a.arena.center.z));
  if (target === null) throw new Error(`no ${block} at ${x},200`);
  await bot.openBlock(target);
  await bot.clickWindow(click[0], click[1], click[2]);
  if (bot.currentWindow !== null) bot.closeWindow(bot.currentWindow);
}

function note(line: string): void {
  process.stdout.write(`   ${line}\n`);
}

/** Resolves with `p`, or fails with a clear message after `ms`: a window or reply that never comes fails the case. */
function within<T>(what: string, p: Promise<T>, ms = OPEN_TIMEOUT_MS): Promise<T> {
  const giveUp = new Promise<never>((_, fail) => {
    setTimeout(() => fail(new Error(`${what}: no answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, giveUp]);
}

/** Places `block` at x on the arena row and returns the block the bot can open. */
async function placeTarget(s: Scene, block: string, x: number): Promise<Block> {
  const { bot, ctl, arena } = s.a;
  await ctl.setblock(x, 200, arena.center.z, block);
  await bot.waitForTicks(10);
  const target = bot.blockAt(new Vec3(x, 200, arena.center.z));
  if (target === null) throw new Error(`no ${block} at ${x},200`);
  return target;
}

/** The window must exist and be the expected kind; a window that did not open fails the case with the reason. */
function expectWindow(win: OpenWindow, what: string, kind: RegExp): OpenWindow {
  const type = String(win.type);
  if (!kind.test(type)) throw new Error(`${what}: the open window is ${type}, not ${kind.source}`);
  note(`${what}: window ${type} is open with ${win.slots.length} slots`);
  return win;
}

/** The first slot at or after `from` that holds `name`; throws when the window has none. */
function slotHolding(win: OpenWindow, name: string, from: number): number {
  const index = win.slots.findIndex((item, i) => i >= from && item?.name === name);
  if (index < 0) throw new Error(`no ${name} in the window from slot ${from}`);
  return index;
}

/** The craft that makes planks: one oak log in grid slot 1 (planks from logs is shapeless, one ingredient). */
async function logIntoGrid(bot: Bot, win: OpenWindow, from: number, what: string): Promise<void> {
  const slot = slotHolding(win, 'oak_log', from);
  await bot.clickWindow(slot, 0, 0);
  await bot.clickWindow(1, 0, 0);
  await bot.waitForTicks(10);
  note(`${what}: moved the oak_log from slot ${slot} into grid slot 1`);
}

/** Takes the output in `slot`. Throws first if no output appeared: a zero from an empty output proves nothing. */
async function takeOutput(bot: Bot, win: OpenWindow, slot: number, what: string): Promise<void> {
  let item: Slot = null;
  for (let i = 0; i < 40 && item === null; i++) {
    item = win.slots[slot] ?? null;
    if (item === null) await bot.waitForTicks(1);
  }
  if (item === null) {
    throw new Error(
      `${what}: output slot ${slot} is empty, so the case produced no output (INVALID, not a zero)`,
    );
  }
  note(`${what}: output slot ${slot} holds ${item.count} ${item.name}`);
  await bot.clickWindow(slot, 0, 0);
  await bot.waitForTicks(10);
  const left = win.slots[slot] ?? null;
  if (left !== null)
    throw new Error(`${what}: output slot ${slot} still holds ${left.name} after the click`);
  note(
    `${what}: clicked output slot ${slot}; ${item.name} x${item.count} picked up, slot now empty`,
  );
}

/** The owner query the Body sends before a break (golem/src/body/block-owners.ts): a NATS request to blockowner.query. */
async function queryOwnerBeforeBreak(s: Scene, bot: Bot, pos: Vec3): Promise<number> {
  const world = bukkitWorldOf(bot);
  if (world === null) throw new Error('owner query: the bot reports no dimension');
  const query = { world, chunk_x: Math.floor(pos.x / 16), chunk_z: Math.floor(pos.z / 16) };
  const nc = await connectNats({ name: 'provenance-capture', servers: s.natsUrl }, () => undefined);
  try {
    const subject = blockownerQuerySubject(s.shard);
    const data = new TextEncoder().encode(JSON.stringify(query));
    const msg = await nc.request(subject, data, { timeout: OWNER_REQUEST_TIMEOUT_MS });
    const answeredAt = Date.now();
    const reply = JSON.parse(new TextDecoder().decode(msg.data)) as {
      blocks?: Array<{ x: number; y: number; z: number; owner: string }>;
    };
    const hit = (reply.blocks ?? []).find((b) => b.x === pos.x && b.y === pos.y && b.z === pos.z);
    note(
      `owner query ${subject} for ${world} chunk ${query.chunk_x},${query.chunk_z} answered at ${answeredAt}; owner of ${pos.x},${pos.y},${pos.z}: ${hit?.owner ?? 'not in the reply'}`,
    );
    return answeredAt;
  } catch (error) {
    throw new Error(`owner query failed, so prior_owner would be null: ${String(error)}`);
  } finally {
    await nc.close().catch(() => undefined);
  }
}

/** The case actions. Each one performs the case on the shard; the subscriber is already running. */
const ACTIONS: Record<string, (s: Scene) => Promise<void>> = {
  async toss(s) {
    const { bot, ctl, arena } = s.a;
    const c = arena.center;
    await ctl.give(BOT_A, 'cobblestone', 4);
    await bot.waitForTicks(10);
    await ctl.tp(BOT_B, c.x + 1, c.y + 1, c.z);
    await bot.tossStack(heldItem(bot, 'cobblestone'));
    await s.b?.bot.waitForTicks(100);
  },
  async 'break-coreprotect-absent'(s) {
    await breakPair(s, false);
  },
  async 'break-coreprotect-present'(s) {
    // The owner query runs right before the break, by the Body's route (blockowner.query), inside the 30 s window.
    await breakPair(s, true);
  },
  async kill(s) {
    const c = s.a.arena.center;
    await summonZombie(s, c.x + 3, c.z);
    await s.a.bot.waitForTicks(20);
    await fightZombie(s.a.bot);
  },
  async survived(s) {
    const c = s.a.arena.center;
    await summonZombie(s, c.x + 3, c.z);
    await s.a.bot.waitForTicks(20);
    const zombie = s.a.bot.nearestEntity((e) => e.name === 'zombie');
    if (zombie === null) throw new Error('survived: no zombie to hit');
    s.a.bot.attack(zombie);
    await s.a.bot.waitForTicks(300);
    await s.a.ctl.command(`kill @e[type=zombie,distance<20]`);
  },
  async 'chest-single'(s) {
    await takeFromBlock(
      s,
      'minecraft:chest',
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]',
      [0, 0, 0],
    );
  },
  async 'chest-double'(s) {
    // Two chests on the x axis, facing north: the left one's partner is east (getClockWise), so x+3 is `right`.
    const { bot, ctl, arena } = s.a;
    const x = arena.center.x + 2;
    const z = arena.center.z;
    await ctl.setblock(x, 200, z, 'minecraft:chest[facing=north,type=left]');
    await ctl.setblock(x + 1, 200, z, 'minecraft:chest[facing=north,type=right]');
    await ctl.command(
      `data merge block ${x} 200 ${z} {Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]}`,
    );
    await bot.waitForTicks(10);
    const target = bot.blockAt(new Vec3(x, 200, z));
    if (target === null) throw new Error(`no chest at ${x},200`);
    const win = expectWindow(
      await within('chest-double', bot.openBlock(target)),
      'chest-double',
      /generic_9x6|chest/,
    );
    // A double chest is 54 container slots plus the 36 player slots: 90 in all. A single chest is 63.
    if (win.slots.length !== 90) {
      throw new Error(
        `chest-double: the window has ${win.slots.length} slots, not 90 (54 + 36): not a double chest`,
      );
    }
    note('chest-double: 54 container slots + 36 player slots: a double chest');
    await takeOutput(bot, win, 0, 'chest-double');
    bot.closeWindow(win);
  },
  async 'chest-shift-click'(s) {
    await takeFromBlock(
      s,
      'minecraft:chest',
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]',
      [0, 0, 1],
    );
  },
  async 'chest-number-key'(s) {
    await takeFromBlock(
      s,
      'minecraft:chest',
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]',
      [0, 0, 2],
    );
  },
  async furnace(s) {
    await takeFromBlock(
      s,
      'minecraft:furnace',
      s.a.arena.center.x + 2,
      'Items:[{Slot:2b,id:"minecraft:iron_ingot",count:1b}]',
      [2, 0, 1],
    );
  },
  async 'brewing-stand'(s) {
    await takeFromBlock(
      s,
      'minecraft:brewing_stand',
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:potion",count:1b}]',
      [0, 0, 1],
    );
  },
  // The send-nothing cases: each opens its window (or its own inventory), fills the input, takes the output.
  async 'crafting-table'(s) {
    const { bot, ctl, arena } = s.a;
    await ctl.give(BOT_A, 'oak_log', 1);
    const target = await placeTarget(s, 'minecraft:crafting_table', arena.center.x + 2);
    const win = expectWindow(
      await within('crafting-table', bot.openBlock(target)),
      'crafting-table',
      /crafting/,
    );
    await logIntoGrid(bot, win, 10, 'crafting-table');
    await takeOutput(bot, win, 0, 'crafting-table');
    bot.closeWindow(win);
  },
  async anvil(s) {
    const { bot, ctl, arena } = s.a;
    await ctl.give(BOT_A, 'stick', 1);
    await ctl.command(`experience add ${BOT_A} 10 levels`);
    const target = await placeTarget(s, 'minecraft:anvil', arena.center.x + 2);
    const plugin = bot as unknown as PluginBot;
    const win = expectWindow(
      await within('anvil', plugin.openAnvil(target)),
      'anvil',
      /anvil/,
    ) as AnvilWindow;
    // mineflayer's rename puts the stick into input slot 0 and sends the name; the output then fills slot 2.
    await win.rename(heldItem(bot, 'stick'), 'capture');
    await takeOutput(bot, win, 2, 'anvil');
    bot.closeWindow(win);
  },
  async 'enchanting-table'(s) {
    const { bot, ctl, arena } = s.a;
    await ctl.give(BOT_A, 'stone_sword', 1);
    await ctl.give(BOT_A, 'lapis_lazuli', 3);
    await ctl.command(`experience add ${BOT_A} 10 levels`);
    const target = await placeTarget(s, 'minecraft:enchanting_table', arena.center.x + 2);
    const plugin = bot as unknown as PluginBot;
    const win = expectWindow(
      await within('enchanting-table', plugin.openEnchantmentTable(target)),
      'enchanting-table',
      /enchant/,
    ) as EnchantWindow;
    await bot.clickWindow(slotHolding(win, 'stone_sword', 2), 0, 0);
    await bot.clickWindow(0, 0, 0);
    await bot.clickWindow(slotHolding(win, 'lapis_lazuli', 2), 0, 0);
    await bot.clickWindow(1, 0, 0);
    const result = await within('enchanting-table: enchant option 0', win.enchant(0));
    if (result === null || result === undefined)
      throw new Error('enchanting-table: enchant returned no item');
    note('enchanting-table: enchant option 0 applied');
    await takeOutput(bot, win, 0, 'enchanting-table');
    bot.closeWindow(win);
  },
  async 'player-2x2'(s) {
    const { bot, ctl } = s.a;
    await ctl.give(BOT_A, 'oak_log', 1);
    await bot.waitForTicks(10);
    if (bot.currentWindow !== null)
      throw new Error('player-2x2: a window is open; only the own inventory may be used');
    if (bot.inventory.slots.length !== 46) {
      throw new Error(`player-2x2: the inventory has ${bot.inventory.slots.length} slots, not 46`);
    }
    note('player-2x2: the own inventory window (no container open) has 46 slots');
    await logIntoGrid(bot, bot.inventory, 9, 'player-2x2');
    await takeOutput(bot, bot.inventory, 0, 'player-2x2');
  },
};

/**
 * Bot A places cobblestone on the arena floor; bot B breaks it. Both steps are bot actions, so A owns the block.
 * With `ownerQuery`, B sends the owner query right before the break and the case fails if the break is 30 s or more later.
 */
async function breakPair(s: Scene, ownerQuery: boolean): Promise<void> {
  if (s.b === undefined) throw new Error('break cases need two bots');
  const c = s.a.arena.center;
  await s.a.ctl.give(BOT_A, 'cobblestone', 1);
  await s.a.bot.waitForTicks(10);
  const item = heldItem(s.a.bot, 'cobblestone');
  await s.a.bot.equip(item, 'hand');
  const floor = s.a.bot.blockAt(new Vec3(c.x + 1, 199, c.z));
  if (floor === null) throw new Error('no floor block under the placement');
  await s.a.bot.placeBlock(floor, new Vec3(0, 1, 0));
  await s.a.bot.waitForTicks(20);
  await s.b.ctl.tp(BOT_B, c.x + 2, 200, c.z);
  const placed = s.b.bot.blockAt(new Vec3(c.x + 1, 200, c.z));
  if (placed === null) throw new Error('placed block not visible to bot B');
  const answeredAt = ownerQuery ? await queryOwnerBeforeBreak(s, s.b.bot, placed.position) : null;
  await s.b.bot.dig(placed);
  if (answeredAt !== null) {
    const gap = Date.now() - answeredAt;
    note(`break ${gap} ms after the owner query (window ${OWNER_WINDOW_MS} ms)`);
    if (gap >= OWNER_WINDOW_MS)
      throw new Error(`break came ${gap} ms after the owner query: outside the 30 s window`);
  }
  await s.b.bot.waitForTicks(20);
}

/** Runs one case: subscriber first (READY), then the case, settle, stop, validate. Returns the validator exit code. */
async function runCase(
  c: CaptureCase,
  url: string,
  outRoot: string,
  shard: string,
): Promise<number> {
  const folder = join(outRoot, c.id);
  mkdirSync(folder, { recursive: true });
  const subjects = `geldar.${shard}.provenance.>,geldar.${shard}.combat_fact`;
  const sub = await startSubscriber(url, subjects, folder);
  try {
    const body = ACTIONS[c.id];
    if (body === undefined) throw new Error(`no action for ${c.id}`);
    const run = async (scene: Scene) => {
      await body(scene);
      await scene.a.bot.waitForTicks(SETTLE_TICKS);
    };
    const shared = { natsUrl: url, shard };
    if (c.bots === 2) {
      await withLiveBot({ name: BOT_A, slot: SLOT_A }, (a) =>
        withLiveBot({ name: BOT_B, slot: SLOT_B }, (b) => run({ a, b, ...shared })),
      );
    } else {
      await withLiveBot({ name: BOT_A, slot: SLOT_A }, (a) => run({ a, ...shared }));
    }
  } finally {
    await stopSubscriber(sub);
  }
  return validateFolder(folder, c.expect);
}

async function main(): Promise<number> {
  const args = parseRunArgs(process.argv.slice(2));
  if (args.mode === 'list') {
    process.stdout.write(`${renderList()}\n`);
    return 0;
  }
  const refusal = refuseShard(args.shard, args.knowingScratch);
  if (refusal !== null) {
    process.stderr.write(`${refusal}\n`);
    return 2;
  }
  if (args.mode === 'dry-run') {
    process.stdout.write(`${renderPlan(args.cases, args)}\n`);
    return 0;
  }
  const outRoot = resolve(args.out);
  let worst = 0;
  for (const c of args.cases) {
    process.stdout.write(`== case ${c.id}\n`);
    const code = await runCase(c, args.natsUrl, outRoot, args.shard).catch((error: unknown) => {
      process.stderr.write(`case ${c.id}: ${String(error)}\n`);
      return 2;
    });
    worst = Math.max(worst, code);
  }
  return worst;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`provenance-capture: ${String(error)}\n`);
    process.exitCode = 2;
  },
);
