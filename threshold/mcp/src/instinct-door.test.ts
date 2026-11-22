import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOL_NAMES, type McpToolName, mcpToolSchemas } from '@geldar/contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACT_ARGS,
  AUTH,
  closeRigs,
  connectWith,
  HEADER,
  KEY,
  postInitialize,
  replyOf,
  startRig,
  textOf,
  WRONG_KEY,
} from './instinct-door-rig.fixture.ts';
import { ConfigRejected, instinctKeyOf } from './main.ts';

// The instinct class through the real front door on loopback, with the world and every store faked.
// The rig is in instinct-door-rig.fixture.ts; the GX-08 peek tests are in instinct-peek-door.test.ts.

afterEach(closeRigs);

const INSTINCT = { ...AUTH, [HEADER]: KEY };

/** Tools the runtime scan never calls, with the reason. The registry walk still covers them. */
const NOT_CALLED: Partial<Record<McpToolName, string>> = {
  wait: 'blocks until the world moves (max_seconds 1 ran past 60 s in the fake world)',
  sleep: 'starts a sleep plan on the Body; the door rig has no quick fixture for it',
  survey: 'the door rig has no Body survey fixture, and the world does not wire the tool yet',
  plan_check:
    'the door rig has no Body read fixture for the pack and seen map, and the world does not wire the tool yet',
};

/** Valid minimal inputs (from each tool's own tests), so the scan runs the success path of these tools. */
const QUICK_INPUTS: Partial<Record<McpToolName, Record<string, unknown>>> = {
  act: ACT_ARGS,
  journal: { text: 'Dusk.' },
  look: {},
  see: {},
  status: {},
  view: {},
};

/** Tools with no quick valid input in this rig: called with {} only, so their validation error is scanned. */
const NO_QUICK_INPUT: Partial<Record<McpToolName, string>> = {
  read_book: 'a success needs a book the player holds; the door rig holds none',
  say: 'a say waits for the Body to take the line; the door rig does not answer it',
  define_skill: 'a success needs a skill fixture',
  use_skill: 'a success needs a defined skill and a body',
  offer: 'a success needs a shrine fixture',
  propose: 'a success needs a law-making fixture',
  vote: 'a success needs an open proposal fixture',
  write_book: 'a success needs a book fixture',
};

/** A reply's text, parsed or raw, carrying the key, the header name, or the word instinct. */
function leaksInText(text: string): string[] {
  const found: string[] = [];
  if (text.includes(KEY)) found.push('the key');
  if (text.toLowerCase().includes(HEADER.toLowerCase())) found.push('the header name');
  // Anchored on the quoted value: the fixture's agent id (ag_instinct_01) is not an actor.
  if (/"(instinct|operator)"/.test(text)) found.push('instinct or operator as a quoted value');
  try {
    leaksInJson(JSON.parse(text), found);
  } catch {
    // Not JSON: the raw checks above are the whole scan.
  }
  return found;
}

/** Every key and value of a parsed reply: a `source` key, or instinct or operator as a value, is a leak. */
function leaksInJson(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) leaksInJson(item, out);
    return;
  }
  if (typeof node === 'string') {
    if (node === 'instinct' || node === 'operator') out.push('instinct as an actor value');
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'source') out.push('a source field');
    leaksInJson(value, out);
  }
}

/** A result schema, every level: a property or key named source, or an enum with the class, is a leak. */
function schemaLeaks(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) schemaLeaks(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'source') out.push('a property or key named source');
    if (
      key === 'enum' &&
      Array.isArray(value) &&
      value.some((v) => v === 'instinct' || v === 'operator')
    ) {
      out.push('an enum with the instinct or operator class');
    }
    schemaLeaks(value, out);
  }
}

describe('the instinct class at the front door', () => {
  it('a right key on an authenticated connection gives the instinct class', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const status = await postInitialize(rig, { ...AUTH, [HEADER]: KEY });
    expect(status).toBe(200);
    expect(rig.sources).toEqual(['instinct']);
  });

  it.each([
    ['a wrong key of the same length', WRONG_KEY],
    ['an empty key', ''],
    ['a key one byte short', 'k'.repeat(39)],
    ['a key one byte long', 'k'.repeat(41)],
  ])('%s is the model class', async (_label, presented) => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: presented })).toBe(200);
    expect(rig.sources).toEqual(['model']);
  });

  it('a repeated header is the model class even when both copies are the key', async () => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: [KEY, KEY] })).toBe(200);
    expect(rig.sources).toEqual(['model']);
  });

  it('with no key loaded (the variable unset) the header counts for nothing', async () => {
    const rig = await startRig(undefined);
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: KEY })).toBe(200);
    expect(rig.sources).toEqual(['model']);
  });

  it('a connection that does not authenticate is refused, with or without the key', async () => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { [HEADER]: KEY })).toBe(401);
    expect(
      await postInitialize(rig, { Authorization: `Bearer gmcp-${'dd'.repeat(32)}`, [HEADER]: KEY }),
    ).toBe(401);
    expect(rig.sources).toEqual([]);
  });

  it('an act on the instinct connection records source instinct; a model act records none', async () => {
    const instinct = await startRig(Buffer.from(KEY));
    const client = await connectWith(instinct, INSTINCT);
    const reply = await textOf(client, 'act', ACT_ARGS);
    expect(reply).not.toContain('"isError":true');
    const last = instinct.fx.recorder.calls.at(-1);
    expect(last?.source).toBe('instinct');

    const model = await startRig(Buffer.from(KEY));
    const modelClient = await connectWith(model, AUTH);
    await textOf(modelClient, 'act', ACT_ARGS);
    const modelLast = model.fx.recorder.calls.at(-1);
    expect(modelLast).toBeDefined();
    expect(modelLast).not.toHaveProperty('source');
  });

  it('no tool reply carries the key, the header name, a source field, or instinct as an actor', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const client = await connectWith(rig, INSTINCT);
    const problems: string[] = [];
    const called: string[] = [];
    for (const name of MCP_TOOL_NAMES) {
      if (name in NOT_CALLED) continue;
      const quick = QUICK_INPUTS[name];
      if (quick === undefined && !(name in NO_QUICK_INPUT)) {
        problems.push(`${name}: neither a quick input nor a reason in the allowlist`);
      }
      const reply = await replyOf(client, name, quick ?? {});
      called.push(name);
      if (quick !== undefined && reply.isError) {
        problems.push(`${name}: the success path did not run: ${reply.text.slice(0, 120)}`);
      }
      for (const found of leaksInText(reply.text)) problems.push(`${name}: ${found}`);
    }
    expect(called.length).toBe(MCP_TOOL_NAMES.length - Object.keys(NOT_CALLED).length);
    expect(problems).toEqual([]);
    expect(rig.fx.recorder.calls.every((c) => c.source !== 'operator')).toBe(true);
  });

  it('the scan sees a source field, an actor value and the key when they are in a reply', () => {
    const planted = JSON.stringify({ ok: true, source: 'instinct', nested: { actor: 'instinct' } });
    const found = leaksInText(planted);
    expect(found).toContain('instinct or operator as a quoted value');
    expect(found).toContain('a source field');
    expect(found).toContain('instinct as an actor value');
    expect(leaksInText(`{"echo":"${KEY}"}`)).toContain('the key');
    expect(leaksInText(`{"echo":"${HEADER.toLowerCase()}"}`)).toContain('the header name');
  });

  it('the registry result schemas declare no source property, no class enum, and no key or header text', () => {
    const problems: string[] = [];
    for (const name of MCP_TOOL_NAMES) {
      const found: string[] = [];
      schemaLeaks(mcpToolSchemas[name].result, found);
      const raw = JSON.stringify(mcpToolSchemas[name].result);
      if (raw.includes(KEY)) found.push('the key');
      if (raw.toLowerCase().includes(HEADER.toLowerCase())) found.push('the header name');
      if (/instinct|operator/i.test(raw)) found.push('the word instinct or operator');
      for (const reason of found) problems.push(`${name}: ${reason}`);
    }
    expect(problems).toEqual([]);
    const walked: string[] = [];
    schemaLeaks({ properties: { source: { enum: ['model', 'instinct', 'operator'] } } }, walked);
    expect(walked).toEqual([
      'a property or key named source',
      'an enum with the instinct or operator class',
    ]);
  });

  it('an instinct initialize then a model initialize on the same door is the model class, and the reverse', async () => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: KEY })).toBe(200);
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: WRONG_KEY })).toBe(200);
    expect(await postInitialize(rig, AUTH)).toBe(200);
    expect(rig.sources).toEqual(['instinct', 'model', 'model']);
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: KEY })).toBe(200);
    expect(rig.sources).toEqual(['instinct', 'model', 'model', 'instinct']);
  });

  it('the log never carries the key or the header value, not even on a wrong key', async () => {
    const rig = await startRig(Buffer.from(KEY));
    await postInitialize(rig, { ...AUTH, [HEADER]: WRONG_KEY });
    await postInitialize(rig, { ...AUTH, [HEADER]: KEY });
    await postInitialize(rig, { [HEADER]: KEY });
    const logged = JSON.stringify(rig.logs);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(WRONG_KEY);
  });

  it('the start-up key read loads a usable key, and refuses a set file that is not one with one constant line', async () => {
    const key = 'k'.repeat(40);
    expect(await instinctKeyOf(undefined, async () => key)).toBeUndefined();
    expect(await instinctKeyOf('/run/secrets/k', async () => `${key}\n`)).toEqual(Buffer.from(key));
    const unusable: (() => Promise<string>)[] = [
      async () => '',
      async () => 'k'.repeat(5),
      async () => ` ${key}`,
      async () => `${key}\n\n`,
      async () => `﻿${key}`,
      async () => 'é'.repeat(40),
      async () => {
        throw new Error('ENOENT: /run/secrets/k');
      },
    ];
    for (const read of unusable) {
      const error: unknown = await instinctKeyOf('/run/secrets/k', read).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ConfigRejected);
      const message = (error as Error).message;
      expect(message).toMatch(/^GELDAR_MCP_INSTINCT_KEY_FILE names a file that is /);
      expect(message).not.toContain('\n');
      expect(message).not.toContain('/run/secrets');
      expect(message).not.toContain('kkkkk');
    }
  });

  it('no source file under threshold/mcp/src assigns the operator class', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const assigning = files.filter((f) =>
      /source\s*[:=]\s*['"]operator['"]/.test(readFileSync(join(dir, f), 'utf8')),
    );
    expect(assigning).toEqual([]);
  });
});
