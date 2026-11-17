import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// geldar-nf (compose/nf-live.yml) must lose CPU contention to the autonomous shard: every service carries a cpu_shares
// weight below the colo default of 1024 (colo leaves CpuShares unset, which is 1024). Parsed from the file's text.
const TEXT = readFileSync(
  resolve(import.meta.dirname, '..', '..', '..', 'compose', 'nf-live.yml'),
  'utf8',
);

function serviceBlocks(): Map<string, string> {
  const body = /^services:\n([\s\S]*?)^networks:/m.exec(TEXT)?.[1] ?? '';
  const blocks = new Map<string, string>();
  let name = '';
  for (const line of body.split('\n')) {
    const head = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (head) {
      name = head[1] ?? '';
      blocks.set(name, '');
    } else if (name) {
      blocks.set(name, `${blocks.get(name)}${line}\n`);
    }
  }
  return blocks;
}

describe('compose/nf-live.yml cpu_shares', () => {
  const blocks = serviceBlocks();

  it('names all six services', () => {
    expect([...blocks.keys()].sort()).toEqual(
      ['eventsink', 'identity-seed', 'nats', 'neoforge', 'postgres', 'velocity'].sort(),
    );
  });

  it('gives every service a cpu_shares below 1024', () => {
    for (const [name, block] of blocks) {
      const shares = /^ {4}cpu_shares: (\d+)\b/m.exec(block)?.[1];
      expect(shares, `${name} has no cpu_shares`).toBeDefined();
      expect(Number(shares), `${name} cpu_shares`).toBeLessThan(1024);
      expect(Number(shares), `${name} cpu_shares`).toBeGreaterThan(0);
    }
  });
});
