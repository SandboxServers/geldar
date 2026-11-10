import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { run, selectInFile, upLine } from './cli.ts';

/**
 * The select keys of the committed strong life, written inline. The test never reads the live shard
 * file: `adam select` rewrites those keys in the working tree, and a run tree must not fail on that.
 */
const SHARD_TEXT = `shard: phase0
mind:
  agent:
    name: Adam
    username: ag_adam_03
    tier: strong
    personality_seed: "curious and patient; careful after dark"
  run_tier: strong
  lives: { strong: ag_adam_03, fast: ag_adam_04, smoke: ag_smoke_01 }
`;

/** A shard file in a temp dir, so the test never edits the checked-in one. */
function copyShard(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'adam-select-')), 'phase0.yaml');
  writeFileSync(file, SHARD_TEXT);
  return file;
}

describe('adam up prints the life the Mind selects', () => {
  it('names the username the shard selects, not the fast entry of mind.lives', () => {
    expect(upLine(SHARD_TEXT)).toBe('up: life ag_adam_03; see ./geldar.ps1 adam status');
  });

  it('names the fast life after adam select points the Mind at it', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = copyShard();
    selectInFile(file, 'fast');
    expect(upLine(readFileSync(file, 'utf8'))).toBe(
      'up: life ag_adam_04; see ./geldar.ps1 adam status',
    );
  });
});

describe('adam select', () => {
  it('rewrites the life, the tier and the run tier to the fast life and back', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = copyShard();
    const before = readFileSync(file, 'utf8');
    expect(selectInFile(file, 'fast')).toBe('ag_adam_04');
    const fast = parse(readFileSync(file, 'utf8'));
    expect(fast.mind.agent).toMatchObject({ username: 'ag_adam_04', tier: 'fast' });
    expect(fast.mind.run_tier).toBe('fast');
    expect(fast.mind.agent.personality_seed).toBe(parse(before).mind.agent.personality_seed);
    expect(selectInFile(file, 'strong')).toBe('ag_adam_03');
    const strong = parse(readFileSync(file, 'utf8'));
    expect(strong.mind).toEqual(parse(before).mind);
    vi.restoreAllMocks();
  });

  it('selects the smoke life on the fast tier, with run_tier fast and never run_tier smoke', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = copyShard();
    expect(selectInFile(file, 'smoke')).toBe('ag_smoke_01');
    const smoke = parse(readFileSync(file, 'utf8'));
    expect(smoke.mind.agent).toMatchObject({ username: 'ag_smoke_01', tier: 'fast' });
    expect(smoke.mind.run_tier).toBe('fast');
    vi.restoreAllMocks();
  });

  it('refuses a missing or unknown --model with exit code 1 and does not touch a file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await run(['select'])).toBe(1);
    expect(await run(['select', '--model', 'huge'])).toBe(1);
    vi.restoreAllMocks();
  });
});
