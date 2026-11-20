#!/usr/bin/env node
// CAP-2: scratch-shard test tooling for the provenance capture. Runs one case at a time with two life-id bots,
// starts tools/capture nats-capture and waits for READY, performs the case, settles, stops the subscriber, then
// validates <out>/<case>/ with validate-captures. Run it on the phase0 scratch shard only, with the shard used
// exclusively. Never run it against a live or Colo shard (principle 1). Plan and flags: `--list`, `--dry-run`, and
// docs/runbooks/capture-real-payloads.md "OPS RUN SHEET". The pure parts are in capture-cases.ts (unit-tested);
// the subscriber in capture-subscriber.ts (unit-tested); the windows in capture-windows.ts. This file talks to a
// server and is NOT tested (no server in CAP-2). Not matched by the live lane (a .ts script, not *.live.test.ts) nor
// by the unit lane (not *.test.ts).
// Run: node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case <name|all>
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockownerQuerySubject } from '@geldar/contract';
import { connectNats } from '@geldar/contract/nats';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { bukkitWorldOf } from '../../../src/body/block-owners.ts';
import { type LiveContext, withLiveBot } from '../fixture.ts';
import {
  BOT_A,
  BOT_B,
  CASE_BLOCKS,
  type CaptureCase,
  CONTROL_MARKER,
  controlFromMarker,
  controlWarning,
  doubleChestCommands,
  nextControlState,
  POSITIVE_CONTROL,
  parseRunArgs,
  refuseShard,
  renderList,
  renderPlan,
  SLOT_A,
  SLOT_B,
  sessionRefusal,
  staleFolderAction,
  validatorArgs,
  zeroIsEvidence,
} from './capture-cases.ts';
import { hasExited, startSubscriber, stopSubscriber } from './capture-subscriber.ts';
import {
  type AnvilWindow,
  type EnchantWindow,
  expectWindow,
  heldItem,
  logIntoGrid,
  note,
  type OpenWindow,
  type PluginBot,
  placeTarget,
  slotHolding,
  takeFromBlock,
  takeOutput,
  verifyRenamedStick,
  within,
} from './capture-windows.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NATS_CAPTURE = join(REPO_ROOT, 'tools/capture/src/nats-capture.ts');
const VALIDATE = join(REPO_ROOT, 'tools/capture/src/validate-captures.ts');
const SETTLE_TICKS = 400;
/** The Body's owner-query window (AN-27a, runbook): the break must come within 30 s of the owner query. */
const OWNER_WINDOW_MS = 30_000;
/**
 * The owner query's own timeout for this script. The Body uses 300 ms (block-owners.ts), but the plugin's CoreProtect
 * lookup may take up to blockowner.lookup_timeout_ms (2000 ms per the review; default UNPROVEN here), so 300 ms can fail
 * the query for a reason that has nothing to do with the capture. Set in the script, not in production code.
 */
const QUERY_TIMEOUT_MS = 2500;
const ANVIL_NAME = 'capture';
/** The whole case (bots, action, settle) must end within this; a case with no answer at all is INVALID. */
const CASE_DEADLINE_MS = 5 * 60_000;

/** The bots of one case: `b` only for the two-life cases. `natsUrl` and `shard` are for the owner query. */
interface Scene {
  a: LiveContext;
  b?: LiveContext;
  natsUrl: string;
  shard: string;
}

/** Summons a helmeted zombie that cannot move or attack (`NoAI`): test setup only, the same carve-out as reflex-combat. */
async function summonZombie(s: Scene, x: number, z: number): Promise<void> {
  await s.a.ctl.command(
    `summon zombie ${x} 200 ${z} {NoAI:1b,equipment:{head:{id:"minecraft:iron_helmet",count:1}}}`,
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

function countOf(bot: Bot, name: string): number {
  return bot.inventory.items().reduce((n, i) => (i.name === name ? n + i.count : n), 0);
}

/** Waits until `name` in the bot's inventory rises above `before`; fails with a message after `ticks`. */
async function waitForPickup(bot: Bot, name: string, before: number, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    if (countOf(bot, name) > before) return;
    await bot.waitForTicks(1);
  }
  throw new Error(`bot B did not pick up the tossed ${name} within ${ticks} ticks (INVALID)`);
}

/** Waits until a non-air block is visible at `pos` to this bot (the chunk must arrive after its teleport). */
async function waitForBlock(bot: Bot, pos: Vec3, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    const block = bot.blockAt(pos);
    if (block !== null && block.name !== 'air') return block;
    await bot.waitForTicks(1);
  }
  throw new Error(`placed block at ${pos} not visible to bot B within ${ticks} ticks (INVALID)`);
}

/**
 * The owner query the Body sends before a break (golem/src/body/block-owners.ts): a NATS request to blockowner.query.
 * For the present case the reply must name an owner for this block; otherwise the case is INVALID (no marker).
 */
async function queryOwnerBeforeBreak(s: Scene, bot: Bot, pos: Vec3): Promise<number> {
  const world = bukkitWorldOf(bot);
  if (world === null) throw new Error('owner query: the bot reports no dimension (INVALID)');
  const query = { world, chunk_x: Math.floor(pos.x / 16), chunk_z: Math.floor(pos.z / 16) };
  const nc = await connectNats({ name: 'provenance-capture', servers: s.natsUrl }, () => undefined);
  try {
    const subject = blockownerQuerySubject(s.shard);
    const data = new TextEncoder().encode(JSON.stringify(query));
    const msg = await nc.request(subject, data, { timeout: QUERY_TIMEOUT_MS });
    const answeredAt = Date.now();
    const reply = JSON.parse(new TextDecoder().decode(msg.data)) as {
      blocks?: Array<{ x: number; y: number; z: number; owner?: unknown }>;
    };
    if (!Array.isArray(reply.blocks))
      throw new Error('owner query: the reply has no blocks array (INVALID)');
    const hit = reply.blocks.find((b) => b.x === pos.x && b.y === pos.y && b.z === pos.z);
    const owner = typeof hit?.owner === 'string' ? hit.owner : '';
    note(
      `owner query ${subject} for ${world} chunk ${query.chunk_x},${query.chunk_z} answered at ${answeredAt}; owner of ${pos.x},${pos.y},${pos.z}: ${owner || 'none'}`,
    );
    if (owner.length === 0) {
      throw new Error(
        `owner query: no owner for ${pos.x},${pos.y},${pos.z} in the reply: no CoreProtect marker, so the present case is INVALID`,
      );
    }
    return answeredAt;
  } finally {
    await nc.close().catch(() => undefined);
  }
}

/** The case actions. Each one performs the case on the shard; the subscriber is already running. */
const ACTIONS: Record<string, (s: Scene) => Promise<void>> = {
  async toss(s) {
    if (s.b === undefined) throw new Error('toss needs two bots');
    const { bot, ctl, arena } = s.a;
    const c = arena.center;
    await ctl.give(BOT_A, 'cobblestone', 4);
    await bot.waitForTicks(10);
    await ctl.tp(BOT_B, c.x + 2, c.y + 1, c.z);
    await s.b.bot.waitForTicks(20);
    await bot.lookAt(s.b.bot.entity.position.offset(0, 1.6, 0));
    await bot.waitForTicks(5);
    const before = countOf(s.b.bot, 'cobblestone');
    await bot.tossStack(heldItem(bot, 'cobblestone'));
    await waitForPickup(s.b.bot, 'cobblestone', before, 100);
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
    await s.a.ctl.give(BOT_A, 'iron_sword', 1);
    await s.a.bot.waitForTicks(10);
    await s.a.bot.equip(heldItem(s.a.bot, 'iron_sword'), 'hand');
    await summonZombie(s, c.x + 3, c.z);
    await s.a.bot.waitForTicks(20);
    await fightZombie(s.a.bot);
  },
  async survived(s) {
    // The zombie cannot attack (NoAI), so the bot is never hurt; the one hit starts the encounter, and 260 quiet
    // ticks (more than the 200 that close it) make the tracker emit fight_survived. No kill: the zombie stays alive.
    const c = s.a.arena.center;
    await summonZombie(s, c.x + 3, c.z);
    await s.a.bot.waitForTicks(20);
    const zombie = s.a.bot.nearestEntity((e) => e.name === 'zombie');
    if (zombie === null) throw new Error('survived: no zombie to hit');
    s.a.bot.attack(zombie);
    await s.a.bot.waitForTicks(260);
  },
  async 'chest-single'(s) {
    await takeFromBlock(
      s.a,
      CASE_BLOCKS.chest,
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]',
      [0, 0, 0],
    );
  },
  async 'chest-double'(s) {
    // Two chests on the x axis, facing north (block states: raw commands, see doubleChestCommands).
    const { bot, ctl, arena } = s.a;
    const x = arena.center.x + 2;
    const z = arena.center.z;
    for (const cmd of doubleChestCommands(x, 200, z)) {
      const reply = await ctl.command(cmd);
      if (!String(reply).includes('Changed the block'))
        throw new Error(`chest-double: "${cmd}" did not change a block: ${String(reply)}`);
    }
    // The stack goes in both halves, so window slot 0 holds it whichever half the pairing puts first (UNPROVEN here).
    for (const half of [x, x + 1]) {
      await ctl.command(
        `data merge block ${half} 200 ${z} {Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]}`,
      );
    }
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
    note(
      'chest-double: 54 container slots + 36 player slots: a double chest; the stack is in both halves',
    );
    await takeOutput(bot, win, 0, 'chest-double');
    bot.closeWindow(win);
  },
  async 'chest-shift-click'(s) {
    await takeFromBlock(
      s.a,
      CASE_BLOCKS.chest,
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]',
      [0, 0, 1],
    );
  },
  async 'chest-number-key'(s) {
    await takeFromBlock(
      s.a,
      CASE_BLOCKS.chest,
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]',
      [0, 0, 2],
    );
  },
  async furnace(s) {
    await takeFromBlock(
      s.a,
      CASE_BLOCKS.furnace,
      s.a.arena.center.x + 2,
      'Items:[{Slot:2b,id:"minecraft:iron_ingot",count:1b}]',
      [2, 0, 1],
    );
  },
  async 'brewing-stand'(s) {
    await takeFromBlock(
      s.a,
      CASE_BLOCKS.brewingStand,
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:potion",count:1b}]',
      [0, 0, 1],
    );
  },
  // The send-nothing cases: each opens its window (or its own inventory), fills the input, takes the output.
  async 'crafting-table'(s) {
    const { bot, ctl, arena } = s.a;
    await ctl.give(BOT_A, 'oak_log', 1);
    const target = await placeTarget(s.a, CASE_BLOCKS.craftingTable, arena.center.x + 2);
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
    const target = await placeTarget(s.a, CASE_BLOCKS.anvil, arena.center.x + 2);
    const plugin = bot as unknown as PluginBot;
    const win = expectWindow(
      await within('anvil', plugin.openAnvil(target)),
      'anvil',
      /anvil/,
    ) as AnvilWindow;
    // mineflayer's rename already takes the output out of slot 2 (lib/plugins/anvil.js putAway), so there is no
    // takeOutput here: the proof is the renamed stick in the inventory.
    await within('anvil: rename', win.rename(heldItem(bot, 'stick'), ANVIL_NAME), 20_000);
    bot.closeWindow(win);
    await verifyRenamedStick(bot, ANVIL_NAME);
  },
  async 'enchanting-table'(s) {
    const { bot, ctl, arena } = s.a;
    await ctl.give(BOT_A, 'stone_sword', 1);
    await ctl.give(BOT_A, 'lapis_lazuli', 3);
    await ctl.command(`experience add ${BOT_A} 10 levels`);
    const target = await placeTarget(s.a, CASE_BLOCKS.enchantingTable, arena.center.x + 2);
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
    await logIntoGrid(bot, bot.inventory as unknown as OpenWindow, 9, 'player-2x2');
    await takeOutput(bot, bot.inventory as unknown as OpenWindow, 0, 'player-2x2');
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
  await s.a.bot.equip(heldItem(s.a.bot, 'cobblestone'), 'hand');
  const floor = s.a.bot.blockAt(new Vec3(c.x + 1, 199, c.z));
  if (floor === null) throw new Error('no floor block under the placement');
  await s.a.bot.placeBlock(floor, new Vec3(0, 1, 0));
  await s.a.bot.waitForTicks(20);
  await s.b.ctl.tp(BOT_B, c.x + 2, 200, c.z);
  await s.b.bot.waitForTicks(20);
  const placed = await waitForBlock(s.b.bot, new Vec3(c.x + 1, 200, c.z), 100);
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

/** Runs the validator on one case folder; its table goes to stdout. Returns the exit code (0 pass, 1 fail). */
function validateFolder(dir: string, expect: string, extra: string[]): Promise<number> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [VALIDATE, dir, '--expect', expect, ...extra], {
      stdio: 'inherit',
    });
    child.once('error', fail);
    child.once('exit', (code) => ok(code ?? 2));
  });
}

interface RunOptions {
  url: string;
  outRoot: string;
  shard: string;
  clean: boolean;
}

/**
 * Runs one case: the folder check, the subscriber (READY), the case, settle, stop, validate. Returns the validator's
 * exit code. A dead subscriber, a stale folder or a missing window throws, so no zero is reported without its proof.
 */
async function runCase(c: CaptureCase, opts: RunOptions): Promise<number> {
  const folder = join(opts.outRoot, c.id);
  const entries = existsSync(folder) ? readdirSync(folder).length : 0;
  const action = staleFolderAction(entries, opts.clean);
  if (action === 'refuse') {
    throw new Error(
      `${folder} is not empty (${entries} entries): refused; pass --clean to clear it`,
    );
  }
  if (action === 'clean') rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const subjects = `geldar.${opts.shard}.provenance.>,geldar.${opts.shard}.combat_fact`;
  const sub = await startSubscriber(spawn, NATS_CAPTURE, { url: opts.url, subjects, out: folder });
  try {
    const body = ACTIONS[c.id];
    if (body === undefined) throw new Error(`no action for ${c.id}`);
    const run = async (scene: Scene) => {
      await body(scene);
      await scene.a.bot.waitForTicks(SETTLE_TICKS);
    };
    const shared = { natsUrl: opts.url, shard: opts.shard };
    const play =
      c.bots === 2
        ? withLiveBot({ name: BOT_A, slot: SLOT_A }, (a) =>
            withLiveBot({ name: BOT_B, slot: SLOT_B }, (b) => run({ a, b, ...shared })),
          )
        : withLiveBot({ name: BOT_A, slot: SLOT_A }, (a) => run({ a, ...shared }));
    // No answer at all (a window or a reply that never comes) makes the case INVALID after the deadline.
    await within(`case ${c.id} (INVALID if it times out)`, play, CASE_DEADLINE_MS);
    if (hasExited(sub))
      throw new Error('the subscriber died during the case: the capture is INVALID, not a zero');
  } finally {
    await stopSubscriber(sub);
  }
  return validateFolder(folder, c.expect, validatorArgs(c));
}

/** True when `<out>/positive-control.json` says chest-single passed in an earlier run of this session. */
function readControlMarker(outRoot: string): boolean {
  const path = join(outRoot, CONTROL_MARKER);
  if (!existsSync(path)) return false;
  try {
    return controlFromMarker(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return false;
  }
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
  const outRoot = resolve(args.out);
  if (args.mode === 'dry-run') {
    process.stdout.write(`${renderPlan(args.cases, args)}\n`);
    const warning = controlWarning(args.cases, readControlMarker(outRoot));
    if (warning !== null) process.stdout.write(`${warning}\n`);
    return 0;
  }
  const session = sessionRefusal(args.cases, readControlMarker(outRoot));
  if (session !== null) {
    process.stderr.write(`${session}\n`);
    return 2;
  }
  let worst = 0;
  let controlPassed = readControlMarker(outRoot);
  for (const c of args.cases) {
    process.stdout.write(`== case ${c.id}\n`);
    const notEvidence = zeroIsEvidence(c, controlPassed);
    if (notEvidence !== null) {
      process.stderr.write(`${notEvidence}\n`);
      worst = 2;
      continue;
    }
    // A re-run of the control starts unproven: the marker goes until this run passes again.
    if (c.id === POSITIVE_CONTROL) rmSync(join(outRoot, CONTROL_MARKER), { force: true });
    const code = await runCase(c, {
      url: args.natsUrl,
      outRoot,
      shard: args.shard,
      clean: args.clean,
    }).catch((error: unknown) => {
      process.stderr.write(`case ${c.id}: ${String(error)}\n`);
      return 2;
    });
    controlPassed = nextControlState(c, code, controlPassed);
    if (c.id === POSITIVE_CONTROL && code === 0) {
      const marker = {
        case: c.id,
        expect: c.expect,
        session: randomUUID(),
        validatedAt: new Date().toISOString(),
      };
      writeFileSync(join(outRoot, CONTROL_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
    }
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
