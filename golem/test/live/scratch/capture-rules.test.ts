// CAP-fix-1: the rules the capture runner relies on, as pure functions (block ids, loopback and shard guards,
// the positive control, the stale folder). Each rule has a test that fails if its line is removed.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  blockIdProblem,
  CAPTURE_CASES,
  CASE_BLOCKS,
  type CaptureCase,
  doubleChestCommands,
  findCase,
  isLoopbackUrl,
  parseRunArgs,
  sessionRefusal,
  shardNameProblem,
  staleFolderAction,
  zeroIsEvidence,
} from './capture-cases.ts';

function pick(...ids: string[]): CaptureCase[] {
  return ids.map((id) => {
    const found = findCase(id);
    if (found === undefined) throw new Error(`no case ${id}`);
    return found;
  });
}

describe('block ids for TestControl.setblock', () => {
  it('every block id the cases place is a bare id (no namespace, no block state, lower case)', () => {
    for (const id of Object.values(CASE_BLOCKS)) {
      expect(blockIdProblem(id), id).toBeNull();
      expect(id).not.toMatch(/[:[A-Z]/);
    }
  });

  it('refuses the namespaced, state and upper-case forms that TestControl.setblock throws on', () => {
    expect(blockIdProblem('minecraft:chest')).not.toBeNull();
    expect(blockIdProblem('chest[facing=north,type=left]')).not.toBeNull();
    expect(blockIdProblem('Chest')).not.toBeNull();
  });

  it('no ctl.setblock call in the scratch scripts passes a namespaced literal', () => {
    for (const name of readdirSync(new URL('.', import.meta.url))) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const text = readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
      for (const line of text.split('\n')) {
        if (line.includes('setblock(')) expect(line, name).not.toContain('minecraft:');
      }
    }
  });

  it('the double chest is two raw setblock commands with block states, left then right', () => {
    const [left, right] = doubleChestCommands(10, 200, -3);
    expect(left).toBe('setblock 10 200 -3 chest[facing=north,type=left]');
    expect(right).toBe('setblock 11 200 -3 chest[facing=north,type=right]');
  });
});

describe('the loopback and shard guards', () => {
  it('accepts 127.0.0.1 and localhost', () => {
    expect(isLoopbackUrl('nats://127.0.0.1:4222')).toBe(true);
    expect(isLoopbackUrl('nats://localhost:4222')).toBe(true);
  });

  it('refuses a LAN, a public or a hostname URL, and text that is not a URL', () => {
    expect(isLoopbackUrl('nats://10.0.0.5:4222')).toBe(false);
    expect(isLoopbackUrl('nats://192.168.1.2:4222')).toBe(false);
    expect(isLoopbackUrl('nats://example.com:4222')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });

  it('parseRunArgs refuses a non-loopback --nats-url before anything runs', () => {
    expect(() => parseRunArgs(['--case', 'toss', '--nats-url', 'nats://10.0.0.5:4222'])).toThrow(
      /loopback/,
    );
  });

  it('shard names are lower-case letters, digits and dashes only', () => {
    expect(shardNameProblem('phase0')).toBeNull();
    expect(shardNameProblem('x y')).not.toBeNull();
    expect(shardNameProblem('a.b')).not.toBeNull();
    expect(shardNameProblem('Phase0')).not.toBeNull();
    expect(shardNameProblem('a*')).not.toBeNull();
  });

  it('parseRunArgs refuses a bad shard name, so the subjects are never built from it', () => {
    expect(() => parseRunArgs(['--case', 'toss', '--shard', 'x y'])).toThrow(/shard name/);
  });

  it('parseRunArgs reads --clean and defaults it to off', () => {
    expect(parseRunArgs(['--case', 'toss']).clean).toBe(false);
    expect(parseRunArgs(['--case', 'toss', '--clean']).clean).toBe(true);
  });
});

describe('the positive control', () => {
  it('a take=0 case with no chest-single before it in the session is refused up front', () => {
    expect(sessionRefusal(pick('crafting-table'))).toMatch(/chest-single/);
  });

  it('chest-single before the zero makes the session valid; the same zero after it does not count', () => {
    expect(sessionRefusal(pick('chest-single', 'crafting-table'))).toBeNull();
    expect(sessionRefusal(pick('crafting-table', 'chest-single'))).not.toBeNull();
  });

  it('the full case table is a valid session (chest-single comes before every zero)', () => {
    expect(sessionRefusal(CAPTURE_CASES)).toBeNull();
  });

  it('a zero counts only when the control passed in the same session; other cases are never refused', () => {
    const zero = findCase('anvil') as CaptureCase;
    expect(zeroIsEvidence(zero, false)).toMatch(/chest-single/);
    expect(zeroIsEvidence(zero, true)).toBeNull();
    expect(zeroIsEvidence(findCase('chest-single') as CaptureCase, false)).toBeNull();
  });
});

describe('the stale case folder', () => {
  it('an empty folder is used; a folder with files is refused unless --clean', () => {
    expect(staleFolderAction(0, false)).toBe('use');
    expect(staleFolderAction(3, false)).toBe('refuse');
    expect(staleFolderAction(3, true)).toBe('clean');
  });
});

describe('the kill and survived specs also assert the engaged message', () => {
  it('expects combat=1 next to combat_fact=1', () => {
    expect(findCase('kill')?.expect).toBe('combat_fact=1,combat=1');
    expect(findCase('survived')?.expect).toBe('combat_fact=1,combat=1');
  });
});
