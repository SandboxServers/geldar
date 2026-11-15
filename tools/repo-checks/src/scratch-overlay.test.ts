/**
 * The scratch stack overlay (compose/opt-in/scratch.yml) and its script (deploy/scratch/scratch.sh) are text, so this test
 * reads both files and checks the rules the runbook promises: loopback-only ports, hard caps on every service, no fixed
 * container names, restart "no", a script that only ever touches scratch-* projects, and the 10 GB and 20 GB gates.
 * It never runs docker or the script.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY = readFileSync(`${ROOT}compose/opt-in/scratch.yml`, 'utf8');
const SCRIPT = readFileSync(`${ROOT}deploy/scratch/scratch.sh`, 'utf8');
const SERVICES = ['postgres', 'nats', 'paper', 'velocity', 'eventsink'];

/** The overlay text of one service: from its `  name:` line to the next service or top-level key. */
function serviceBlock(name: string): string {
  const lines = OVERLAY.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`no service ${name} in the overlay`);
  let end = start + 1;
  while (
    end < lines.length &&
    !/^\S/.test(lines[end] as string) &&
    !/^ {2}\w[\w-]*:$/.test(lines[end] as string)
  ) {
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

describe('scratch overlay', () => {
  it('publishes ports on loopback only, and no other address', () => {
    const mappings = OVERLAY.split('\n').filter((line) => /^ {6}- "/.test(line));
    expect(mappings).toHaveLength(4);
    for (const line of mappings) {
      expect(line).toMatch(/^ {6}- "127\.0\.0\.1:\$\{SCRATCH_[A-Z_]+:-\d+\}:\d+"$/);
    }
    expect(OVERLAY).not.toContain('0.0.0.0');
  });

  it('has no IPv4 address other than 127.0.0.1', () => {
    const addresses = OVERLAY.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    expect(addresses.filter((address) => address !== '127.0.0.1')).toEqual([]);
  });

  it('sets no container_name', () => {
    expect(OVERLAY).not.toMatch(/container_name/);
  });

  it.each(SERVICES)('gives %s memory and cpus limits', (name) => {
    const block = serviceBlock(name);
    expect(block).toMatch(/ {10}memory: \d+m\n/);
    expect(block).toMatch(/ {10}cpus: "?[\d.]+"?\n/);
  });

  it.each(SERVICES)('sets restart "no" on %s', (name) => {
    expect(serviceBlock(name)).toContain('    restart: "no"');
  });

  it('keeps the paper heap default at 2G and the paper cap at 3072m', () => {
    expect(OVERLAY).toContain(`MEMORY: \${PAPER_MEMORY:-2G}`);
    expect(serviceBlock('paper')).toContain('memory: 3072m');
  });

  it('takes its secret files from the script directory, never from compose/secrets', () => {
    expect(OVERLAY).not.toContain('./secrets/');
    for (const file of ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt']) {
      expect(OVERLAY).toContain(
        `\${SCRATCH_SECRETS_DIR:?set by deploy/scratch/scratch.sh}/${file}`,
      );
    }
  });
});

describe('scratch script', () => {
  it('refuses a project name that does not start with scratch-', () => {
    expect(SCRIPT).toMatch(/PROJECT="scratch-\$suffix"/);
    expect(SCRIPT).toMatch(/case "\$PROJECT" in\n {2}scratch-\*\)/);
  });

  it('contains the down -v teardown', () => {
    expect(SCRIPT).toContain('down -v --remove-orphans');
  });

  it('gates on 10 GB free RAM and 20 GB free disk', () => {
    expect(SCRIPT).toContain('10 GB');
    expect(SCRIPT).toContain('20 GB');
    expect(SCRIPT).toContain('RAM_MIN_KB=10485760');
    expect(SCRIPT).toContain('DISK_MIN_KB=20971520');
  });
});
