import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const env = {
  REGISTER_PUBLIC_URL: 'https://register.example.invalid/',
  REGISTER_GITHUB_SECRET_FILE: 'g',
  REGISTER_DISCORD_SECRET_FILE: 'd',
  REGISTER_PEPPER_FILE: 'p',
  REGISTER_TOKEN_PEPPER_FILE: 't',
  REGISTER_SHARD: 'test',
  REGISTER_START_CREDITS: '240',
};
const read = (p: string) => (p === 'p' ? 'x'.repeat(32) : `s-${p}\n`);

describe('loadConfig', () => {
  it('defaults the kill switch on, the age floor to 30 and the daily cap to 10', () => {
    const c = loadConfig(env, read);
    expect(c.killSwitch).toBe(true);
    expect(c.minAccountAgeDays).toBe(30);
    expect(c.maxNewOwnersPerDay).toBe(10);
    expect(c.publicUrl).toBe('https://register.example.invalid');
    expect(c.github.clientSecret).toBe('s-g');
  });

  it('requires the start credits and reads them as a whole number', () => {
    const { REGISTER_START_CREDITS: _unset, ...without } = env;
    expect(() => loadConfig(without, read)).toThrow('REGISTER_START_CREDITS is not set');
    expect(() => loadConfig({ ...env, REGISTER_START_CREDITS: '-1' }, read)).toThrow();
    expect(loadConfig(env, read).startCredits).toBe(240);
  });

  it('turns the switch off only for the exact string false', () => {
    expect(loadConfig({ ...env, REGISTER_KILL_SWITCH: 'false' }, read).killSwitch).toBe(false);
    for (const v of ['0', 'no', 'FALSE', '']) {
      expect(loadConfig({ ...env, REGISTER_KILL_SWITCH: v }, read).killSwitch).toBe(true);
    }
  });

  it('refuses a short pepper, a missing secret file and a non-https url', () => {
    expect(() => loadConfig(env, (p) => (p === 'p' ? 'short' : 'x'))).toThrow(/PEPPER/);
    expect(() => loadConfig({ ...env, REGISTER_PEPPER_FILE: undefined }, read)).toThrow(/not set/);
    expect(() => loadConfig({ ...env, REGISTER_PUBLIC_URL: 'http://x' }, read)).toThrow(/https/);
  });
});
