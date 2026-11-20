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
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
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

/** The bots of one case: `b` only for the two-life cases. */
interface Scene {
  a: LiveContext;
  b?: LiveContext;
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

/** The send-nothing cases: the output slot must hold an item before the click, or the zero result proves nothing. */
async function sendNothingGuard(what: string): Promise<never> {
  throw new Error(
    `${what}: the ingredient setup is not implemented in CAP-2 (no output to take): the case is INVALID, not a zero`,
  );
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
    await breakPair(s);
  },
  async 'break-coreprotect-present'(s) {
    // The owner query (the Body's goto dig, or blockowner.query) must run within 30 s of the break; not scripted yet.
    await breakPair(s);
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
    await takeFromBlock(
      s,
      'minecraft:chest',
      s.a.arena.center.x + 2,
      'Items:[{Slot:0b,id:"minecraft:cobblestone",count:8b}]',
      [0, 0, 0],
    );
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
  async 'crafting-table'() {
    await sendNothingGuard('crafting-table');
  },
  async anvil() {
    await sendNothingGuard('anvil');
  },
  async 'enchanting-table'() {
    await sendNothingGuard('enchanting-table');
  },
  async 'player-2x2'() {
    await sendNothingGuard('player-2x2');
  },
};

/** Bot A places cobblestone on the arena floor; bot B breaks it. Both steps are bot actions, so A owns the block. */
async function breakPair(s: Scene): Promise<void> {
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
  await s.b.bot.dig(placed);
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
    if (c.bots === 2) {
      await withLiveBot({ name: BOT_A, slot: SLOT_A }, (a) =>
        withLiveBot({ name: BOT_B, slot: SLOT_B }, (b) => run({ a, b })),
      );
    } else {
      await withLiveBot({ name: BOT_A, slot: SLOT_A }, (a) => run({ a }));
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
