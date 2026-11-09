import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, readRconPassword, repoRoot } from './config.ts';

describe('loadConfig', () => {
  it('defaults to the loopback Velocity ingress and the RCON port', () => {
    const cfg = loadConfig({});
    expect(cfg.mcHost).toBe('127.0.0.1');
    expect(cfg.mcPort).toBe(25565);
    expect(cfg.rconHost).toBe('127.0.0.1');
    expect(cfg.rconPort).toBe(25575);
    expect(cfg.rconPasswordFile).toBe(join(repoRoot(), 'compose', 'secrets', 'rcon.txt'));
  });

  it('reads the overrides from the environment', () => {
    const cfg = loadConfig({
      GELDAR_MC_HOST: 'localhost',
      GELDAR_MC_PORT: '25570',
      GELDAR_RCON_PORT: '25576',
      GELDAR_RCON_PASSWORD_FILE: '/tmp/rcon.txt',
    });
    expect(cfg).toEqual({
      mcHost: 'localhost',
      mcPort: 25570,
      rconHost: '127.0.0.1',
      rconPort: 25576,
      rconPasswordFile: '/tmp/rcon.txt',
    });
  });

  it('throws for a host that is not loopback', () => {
    expect(() => loadConfig({ GELDAR_MC_HOST: '192.168.1.10' })).toThrow(
      /127\.0\.0\.1 or localhost/,
    );
    expect(() => loadConfig({ GELDAR_MC_HOST: '0.0.0.0' })).toThrow(/GELDAR_MC_HOST/);
  });

  it('throws for ports outside 1 to 65535', () => {
    expect(() => loadConfig({ GELDAR_MC_PORT: '0' })).toThrow(/GELDAR_MC_PORT/);
    expect(() => loadConfig({ GELDAR_MC_PORT: '70000' })).toThrow(/GELDAR_MC_PORT/);
    expect(() => loadConfig({ GELDAR_RCON_PORT: 'abc' })).toThrow(/GELDAR_RCON_PORT/);
  });
});

describe('readRconPassword', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('trims the trailing newline', async () => {
    const file = join(dir, 'rcon.txt');
    await writeFile(file, 'secret-value\n');
    const password = await readRconPassword({
      mcHost: '127.0.0.1',
      mcPort: 25565,
      rconHost: '127.0.0.1',
      rconPort: 25575,
      rconPasswordFile: file,
    });
    expect(password).toBe('secret-value');
  });

  it('names the file and the secrets command when the file is missing', async () => {
    const file = join(dir, 'missing.txt');
    await expect(
      readRconPassword({
        mcHost: '127.0.0.1',
        mcPort: 25565,
        rconHost: '127.0.0.1',
        rconPort: 25575,
        rconPasswordFile: file,
      }),
    ).rejects.toThrow(`${file} does not exist: run ./geldar.ps1 shard secrets phase0`);
  });
});
