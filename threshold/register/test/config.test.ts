import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const env = {
  REGISTER_PUBLIC_URL: 'https://glass.example.invalid/',
  REGISTER_MS_CLIENT_ID: 'ms-id',
  REGISTER_MS_CLIENT_SECRET_FILE: 'm',
  REGISTER_SESSION_KEY_FILE: 's',
  REGISTER_PEPPER_FILE: 'p',
  REGISTER_TOKEN_PEPPER_FILE: 't',
  REGISTER_SHARD: 'test',
};
const read = (p: string) => (p === 'm' ? 'ms-secret\n' : 'x'.repeat(32));

describe('loadConfig', () => {
  it('defaults the kill switch on and the sign-in and owner limits to 10 and 6 a minute (R41)', () => {
    const c = loadConfig(env, read);
    expect(c.killSwitch).toBe(true);
    expect(c.signInPerMinute).toBe(10);
    expect(c.ownerPerMinute).toBe(6);
    expect(c.publicUrl).toBe('https://glass.example.invalid');
    expect(c.microsoft).toEqual({ clientId: 'ms-id', clientSecret: 'ms-secret' });
    expect(c.sessionKey).toHaveLength(32);
  });

  it('has no MCP address unless REGISTER_MCP_PUBLIC_URL is set; a set one drops its trailing slash', () => {
    expect(loadConfig(env, read).mcpPublicUrl).toBe('');
    const set = loadConfig(
      { ...env, REGISTER_MCP_PUBLIC_URL: 'https://mcp.example.invalid/' },
      read,
    );
    expect(set.mcpPublicUrl).toBe('https://mcp.example.invalid');
  });

  it('refuses a REGISTER_MCP_PUBLIC_URL that is not https', () => {
    expect(() => loadConfig({ ...env, REGISTER_MCP_PUBLIC_URL: 'http://x' }, read)).toThrow(
      /REGISTER_MCP_PUBLIC_URL must be https/,
    );
  });

  it('reads the limits from the environment', () => {
    const c = loadConfig(
      { ...env, REGISTER_SIGNIN_PER_MINUTE: '3', REGISTER_OWNER_PER_MINUTE: '2' },
      read,
    );
    expect(c.signInPerMinute).toBe(3);
    expect(c.ownerPerMinute).toBe(2);
    expect(() => loadConfig({ ...env, REGISTER_SIGNIN_PER_MINUTE: 'x' }, read)).toThrow(
      /non-negative/,
    );
  });

  it('turns the switch off only for the exact string false', () => {
    expect(loadConfig({ ...env, REGISTER_KILL_SWITCH: 'false' }, read).killSwitch).toBe(false);
    for (const v of ['0', 'no', 'FALSE', '']) {
      expect(loadConfig({ ...env, REGISTER_KILL_SWITCH: v }, read).killSwitch).toBe(true);
    }
  });

  it('refuses a short pepper or session key, a missing secret file and a non-https url', () => {
    expect(() => loadConfig(env, (p) => (p === 'p' ? 'short' : 'x'.repeat(32)))).toThrow(/PEPPER/);
    expect(() => loadConfig(env, (p) => (p === 's' ? 'short' : 'x'.repeat(32)))).toThrow(
      /SESSION_KEY/,
    );
    expect(() => loadConfig({ ...env, REGISTER_PEPPER_FILE: undefined }, read)).toThrow(/not set/);
    expect(() => loadConfig({ ...env, REGISTER_SESSION_KEY_FILE: undefined }, read)).toThrow(
      /not set/,
    );
    expect(() => loadConfig({ ...env, REGISTER_PUBLIC_URL: 'http://x' }, read)).toThrow(/https/);
  });
});
