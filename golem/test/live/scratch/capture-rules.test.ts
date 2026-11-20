// CAP-fix-1: the rules the capture runner relies on, as pure functions (block ids, loopback and shard guards,
// the positive control, the stale folder). Each rule has a test that fails if its line is removed.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_CASE_OFFSET,
  blockIdProblem,
  CAPTURE_CASES,
  CASE_BLOCKS,
  type CaptureCase,
  controlFromMarker,
  controlWarning,
  doubleChestCommands,
  findCase,
  isLoopbackUrl,
  nextControlState,
  parseRunArgs,
  sessionRefusal,
  shardNameProblem,
  staleFolderAction,
  validatorArgs,
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
    // RFC 5737 documentation addresses: not loopback, and not private literals for the repo IP check.
    expect(isLoopbackUrl('nats://203.0.113.9:4222')).toBe(false);
    expect(isLoopbackUrl('nats://198.51.100.7:4222')).toBe(false);
    expect(isLoopbackUrl('nats://example.com:4222')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });

  it('parseRunArgs refuses a non-loopback --nats-url before anything runs', () => {
    expect(() => parseRunArgs(['--case', 'toss', '--nats-url', 'nats://203.0.113.9:4222'])).toThrow(
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

describe('the session marker: the positive control across runs', () => {
  it('a lone zero is refused unless a passed control is on disk', () => {
    expect(sessionRefusal(pick('crafting-table'), false)).toMatch(/chest-single/);
    expect(sessionRefusal(pick('crafting-table'), true)).toBeNull();
  });

  it('the marker counts only for chest-single with take=1 and a session id', () => {
    const good = { case: 'chest-single', expect: 'take=1', session: 'abc' };
    expect(controlFromMarker(good)).toBe(true);
    expect(controlFromMarker({ ...good, case: 'anvil' })).toBe(false);
    expect(controlFromMarker({ ...good, expect: 'take=0' })).toBe(false);
    expect(controlFromMarker({ ...good, session: '' })).toBe(false);
    expect(controlFromMarker({ ...good, session: undefined })).toBe(false);
    expect(controlFromMarker(null)).toBe(false);
    expect(controlFromMarker('chest-single')).toBe(false);
  });

  it('only chest-single changes the control, and only its exit 0 sets it; a failed control clears it', () => {
    const control = findCase('chest-single') as CaptureCase;
    const zero = findCase('anvil') as CaptureCase;
    expect(nextControlState(control, 0, false)).toBe(true);
    expect(nextControlState(control, 1, true)).toBe(false);
    expect(nextControlState(zero, 0, false)).toBe(false);
    expect(nextControlState(zero, 1, true)).toBe(true);
  });

  it('the dry-run warns about a lone zero and not about a valid session', () => {
    expect(controlWarning(pick('anvil'), false)).toMatch(/warning/);
    expect(controlWarning(pick('anvil'), true)).toBeNull();
    expect(controlWarning(pick('chest-single', 'anvil'), false)).toBeNull();
  });
});

describe('the validator arguments of each case', () => {
  it('only the present case passes --expect-prior-owner', () => {
    for (const c of CAPTURE_CASES) {
      const want = c.id === 'break-coreprotect-present' ? ['--expect-prior-owner'] : [];
      expect(validatorArgs(c), c.id).toEqual(want);
    }
  });
});

describe('the runner wiring (source scans: the runner talks to a server and is not unit-tested)', () => {
  const runner = readFileSync(new URL('./provenance-capture.ts', import.meta.url), 'utf8');

  it('the stale folder action comes from the folder entries and --clean', () => {
    expect(runner).toContain('staleFolderAction(entries, opts.clean)');
  });

  it('a dead subscriber makes the case INVALID before its zero can count', () => {
    expect(runner).toContain('if (hasExited(sub))');
  });

  it('the validator gets its flags from validatorArgs', () => {
    expect(runner).toContain('validateFolder(folder, c.expect, validatorArgs(c))');
  });

  it('the control state after each case comes from nextControlState', () => {
    expect(runner).toContain('controlPassed = nextControlState(c, code, controlPassed);');
  });

  it('every takeFromBlock and placeTarget call passes a CASE_BLOCKS id, so no namespaced id reaches setblock', () => {
    const calls = [...runner.matchAll(/(takeFromBlock|placeTarget)\(\s*s\.a,\s*([^,\n]+),/g)];
    const sites = runner.match(/(takeFromBlock|placeTarget)\(/g) ?? [];
    expect(calls).toHaveLength(8);
    expect(sites).toHaveLength(8);
    for (const m of calls) expect(m[2]?.trim(), m[0]).toMatch(/^CASE_BLOCKS\.[a-zA-Z]+$/);
  });

  it('the anvil action closes the window before its proof (renameAndVerify)', () => {
    expect(runner).toContain('renameAndVerify(bot, win, ANVIL_NAME');
    expect(runner).not.toContain('verifyRenamedStick(bot, win, ANVIL_NAME)');
  });

  it('each block-placing action passes its own id to caseBlockPosition, and no other id', () => {
    // An action starts at a two-space indented `name(s) {` line and runs to the next one.
    const headers = [...runner.matchAll(/^ {2}(?:async )?'?([a-z0-9-]+)'?\(s\) \{$/gm)];
    for (const id of Object.keys(BLOCK_CASE_OFFSET)) {
      const at = headers.findIndex((h) => h[1] === id);
      expect(at, `${id} has an action`).toBeGreaterThanOrEqual(0);
      const from = headers[at]?.index ?? 0;
      const body = runner.slice(from, headers[at + 1]?.index ?? runner.length);
      expect(body, `${id} action`).toContain(`caseBlockPosition('${id}'`);
      const others = [...body.matchAll(/caseBlockPosition\('([a-z-]+)'/g)]
        .map((m) => m[1])
        .filter((other) => other !== id);
      expect(others, `${id} action passes another id`).toEqual([]);
    }
  });
});

describe('the kill and survived specs also assert the engaged message', () => {
  it('expects combat=1 next to combat_fact=1', () => {
    expect(findCase('kill')?.expect).toBe('combat_fact=1,combat=1');
    expect(findCase('survived')?.expect).toBe('combat_fact=1,combat=1');
  });
});
