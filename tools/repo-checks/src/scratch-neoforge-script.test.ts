/**
 * The scratch script under SCRATCH_PLATFORM=neoforge (deploy/scratch/scratch.sh under sh with the stubs from
 * scratch-harness.ts): the overlay order, the platform gate, the plugin jars each platform needs, down passing the same
 * overlay, and the RCON key of nf.env. Nothing here starts a container. These tests skip when no sh is on PATH.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JARS, OPEN, type RunOpts, runScript, SH, started } from './scratch-harness.js';

const NF = { SCRATCH_PLATFORM: 'neoforge' };
const callOf = (calls: string[], verb: string) => calls.find((c) => c.includes(verb)) ?? '';

/** A tree whose nf.env is the given text (the harness copies only telemetry.env into the tree). */
function nfEnv(text: string): RunOpts {
  return {
    ...JARS,
    prepare: (base) => {
      const dir = join(base, 'tree', 'deploy', 'scratch');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'nf.env'), text);
    },
  };
}

/** Only the velocity identity jar, as the NeoForge variant needs it. */
function velocityJarOnly(base: string) {
  const dir = join(base, 'tree', 'plugin', 'velocity-identity', 'build', 'libs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'geldar-velocity-identity.jar'), 'jar');
}

describe.skipIf(!SH)('scratch script with SCRATCH_PLATFORM', { timeout: 60_000 }, () => {
  it('neoforge adds the NeoForge overlay right after scratch.yml, before any NATS override', () => {
    const run = runScript(['up', 'nf'], { ...OPEN, ...NF }, JARS);
    const up = callOf(run.calls, ' up -d');
    expect(started(run)).toBe(true);
    expect(up).toContain('opt-in/scratch-neoforge.yml');
    expect(up.indexOf('opt-in/scratch.yml')).toBeLessThan(
      up.indexOf('opt-in/scratch-neoforge.yml'),
    );
    expect(up).toMatch(/opt-in\/scratch\.yml -f \S*opt-in\/scratch-neoforge\.yml /);
    expect(up).not.toContain('nats-auth');
  });

  it('unset and paper both leave the NeoForge overlay out of the compose call', () => {
    for (const platform of [undefined, 'paper']) {
      const run = runScript(['up', 'nf'], { ...OPEN, SCRATCH_PLATFORM: platform }, JARS);
      expect(started(run)).toBe(true);
      expect(callOf(run.calls, ' up -d')).not.toContain('scratch-neoforge');
    }
  });

  it('a bogus SCRATCH_PLATFORM exits 2 before any compose call, for up and for down', () => {
    const up = runScript(['up', 'nf'], { ...OPEN, SCRATCH_PLATFORM: 'bogus' }, JARS);
    expect(up.status).toBe(2);
    expect(up.stderr).toContain('SCRATCH_PLATFORM must be paper or neoforge');
    expect(up.calls).toEqual([]);
    const down = runScript(['down', 'nf'], { SCRATCH_PLATFORM: 'bogus' });
    expect(down.status).toBe(2);
    expect(down.calls).toEqual([]);
  });

  it('down and status with neoforge pass the same overlay, so down -v removes what up made', () => {
    const down = runScript(['down', 'nf'], NF);
    const status = runScript(['status', 'nf'], NF);
    expect(callOf(down.calls, ' down -v')).toContain('opt-in/scratch-neoforge.yml');
    expect(callOf(status.calls, ' ps')).toContain('opt-in/scratch-neoforge.yml');
  });

  it('neoforge needs the velocity identity jar but not geldar-core', () => {
    const run = runScript(
      ['up', 'nf'],
      { ...OPEN, ...NF },
      { tree: { jars: false }, prepare: velocityJarOnly },
    );
    expect(run.status).not.toBe(1);
    expect(started(run)).toBe(true);
  });

  it('neoforge with no plugin jar at all exits 1 naming the velocity jar, with no compose call', () => {
    const run = runScript(['up', 'nf'], { ...OPEN, ...NF }, { tree: { jars: false } });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('geldar-velocity-identity.jar');
    expect(started(run)).toBe(false);
  });

  it('paper still needs geldar-core: with only the velocity jar it exits 1 naming geldar-core', () => {
    const run = runScript(['up', 'nf'], OPEN, { tree: { jars: false }, prepare: velocityJarOnly });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('geldar-core.jar');
    expect(started(run)).toBe(false);
  });

  it('nf.env may carry SCRATCH_RCON_PORT: the run starts with it', () => {
    const run = runScript(['up', 'nf'], { ...OPEN, ...NF }, nfEnv('SCRATCH_RCON_PORT=55575\n'));
    expect(run.status).not.toBe(2);
    expect(started(run)).toBe(true);
  });

  it.each([
    ['0', '1 to 65535'],
    ['70000', '1 to 65535'],
    ['5x', 'digits only'],
    ['', 'digits only'],
  ])('SCRATCH_RCON_PORT=%s exits 2 with %s and starts nothing', (value, message) => {
    const run = runScript(['up', 'nf'], { ...OPEN, ...NF }, nfEnv(`SCRATCH_RCON_PORT=${value}\n`));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('SCRATCH_RCON_PORT');
    expect(run.stderr).toContain(message);
    expect(run.calls).toEqual([]);
  });

  it('a made-up key in the port file still exits 2 and starts nothing', () => {
    const run = runScript(['up', 'nf'], { ...OPEN, ...NF }, nfEnv('SCRATCH_FOO_PORT=1\n'));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('unknown key');
    expect(run.calls).toEqual([]);
  });
});
