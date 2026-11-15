import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli.ts';

const dirs: string[] = [];

async function tempFile(name: string, text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sheet-cli-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, text, 'utf8');
  return path;
}

function missingFile(): string {
  return join(tmpdir(), `sheet-cli-missing-${Date.now()}`, 'nope.csv');
}

describe('sheet cli dispatch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('exits 2 for an unknown command and for a guard call with the wrong count', async () => {
    expect(await main([])).toBe(2);
    expect(await main(['nonsense'])).toBe(2);
    expect(await main(['guard', 'scratch-sheet0'])).toBe(2);
  });

  it('exits 0 for a scratch guard and 1 for a live name', async () => {
    expect(await main(['guard', 'scratch-sheet0', 'scratch-sheet0'])).toBe(0);
    expect(await main(['guard', 'colo', 'colo'])).toBe(1);
  });

  it('exits 2 for a leak call without the sheet stat list, so no default stat is used', async () => {
    const path = await tempFile('capture.txt', 'sheet value 3');
    expect(await main(['leak', path])).toBe(2);
  });

  it('exits 1 when a standalone stat is in the capture and 0 when it is not', async () => {
    const hit = await tempFile('hit.txt', 'sheet value 3 here');
    const clean = await tempFile('clean.txt', 'nothing with a digit');
    expect(await main(['leak', hit, '3'])).toBe(1);
    expect(await main(['leak', clean, '3'])).toBe(0);
  });

  it('exits 2 and prints the error when the leak capture file cannot be read', async () => {
    expect(await main(['leak', missingFile(), '3'])).toBe(2);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining('sheet cli failed'),
    );
  });

  it('exits 2 for a report section without a title, and 2 for an unreadable section file', async () => {
    expect(await main(['report', 'no-equals-sign'])).toBe(2);
    expect(await main(['report', `rolls=${missingFile()}`])).toBe(2);
  });

  it('exits 0 for a readable report section', async () => {
    const csv = await tempFile('rolls.csv', 'world_tick,fx\n10,threat\n');
    expect(await main(['report', `rolls=${csv}`])).toBe(0);
  });
});
